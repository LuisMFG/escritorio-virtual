import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { spotifyCallback, spotifyConnect, spotifySettings } from '../http/spotify.js';
import { createServices } from './index.js';
import { SpotifyPoller } from './SpotifyPoller.js';
import { SpotifyService } from './SpotifyService.js';

const cfg = {
  clientId: 'cliente-teste',
  redirectUri: 'http://127.0.0.1:2567/api/spotify/callback',
  returnUrl: 'http://localhost:5173/',
};

/** Spotify de mentira: confere o PKCE e responde como a API real. */
function fakeSpotify() {
  const state = {
    challenge: '',
    playing: {
      is_playing: true,
      item: {
        name: 'Garota de Ipanema',
        artists: [{ name: 'Tom Jobim' }],
        external_urls: { spotify: 'https://open.spotify.com/track/x' },
      },
    } as unknown,
    status: 200,
    refreshes: 0,
    revoked: false,
    validToken: 'acesso-1',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/token')) {
      const p = new URLSearchParams(String(init?.body));
      if (p.get('grant_type') === 'authorization_code') {
        const ok =
          createHash('sha256').update(p.get('code_verifier')!).digest('base64url') ===
            state.challenge && p.get('code') === 'codigo-bom';
        return ok
          ? json({ access_token: 'acesso-1', refresh_token: 'refresh-1', expires_in: 3600 })
          : json({ error: 'invalid_grant' }, 400);
      }
      if (state.revoked) return json({ error: 'invalid_grant' }, 400);
      state.refreshes++;
      state.validToken = `acesso-${state.refreshes + 1}`;
      return json({ access_token: state.validToken, expires_in: 3600 });
    }
    if (url.endsWith('/me')) return json({ display_name: 'Ana Spotify' });
    if (url.endsWith('/me/player/currently-playing')) {
      const auth = new Headers(init?.headers).get('authorization');
      if (auth !== `Bearer ${state.validToken}`) return json({ error: 'expired' }, 401);
      if (state.status === 204) return new Response(null, { status: 204 });
      return json(state.playing, state.status);
    }
    return json({}, 404);
  }) as typeof fetch;
  return { state, http };
}

function setup() {
  const svc = createServices(openDatabase(':memory:'));
  const fake = fakeSpotify();
  let now = 1_000_000;
  const spotify = new SpotifyService(svc.db, cfg, fake.http, () => now);
  const user = svc.users.create('Ana', 'hd-180-1.ch-210-66.lg-270-82').user;
  /** Faz o "vai e volta" do Spotify e devolve o redirect final. */
  const connect = async (code = 'codigo-bom') => {
    const url = new URL(spotify.authorizeUrl(user.id));
    fake.state.challenge = url.searchParams.get('code_challenge')!;
    return spotify.finishAuthorization(code, url.searchParams.get('state')!);
  };
  return { svc, fake, spotify, user, connect, advance: (ms: number) => (now += ms) };
}

describe('SpotifyService', () => {
  it('autoriza com PKCE (S256) e guarda a conta', async () => {
    const { spotify, user, connect } = setup();
    const url = new URL(spotify.authorizeUrl(user.id));
    expect(url.origin).toBe('https://accounts.spotify.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cliente-teste',
      response_type: 'code',
      scope: 'user-read-currently-playing',
      code_challenge_method: 'S256',
      redirect_uri: cfg.redirectUri,
    });
    expect(await connect()).toBe(user.id);
    expect(spotify.status(user.id)).toEqual({
      configured: true,
      linked: true,
      hidden: false,
      displayName: 'Ana Spotify',
    });
  });

  it('código errado ou state desconhecido não liga nada', async () => {
    const { spotify, user, connect } = setup();
    await expect(connect('codigo-ruim')).rejects.toThrow();
    await expect(spotify.finishAuthorization('codigo-bom', 'inventado')).rejects.toThrow(
      /expirado/,
    );
    expect(spotify.status(user.id).linked).toBe(false);
  });

  it('música atual; renova o token vencido; pausado e nada tocando viram null', async () => {
    const { spotify, user, connect, fake, advance } = setup();
    await connect();
    expect(await spotify.nowPlaying(user.id)).toEqual({
      track: 'Garota de Ipanema',
      artists: 'Tom Jobim',
      url: 'https://open.spotify.com/track/x',
    });
    advance(3600_000);
    await spotify.nowPlaying(user.id);
    expect(fake.state.refreshes).toBe(1);
    fake.state.playing = { is_playing: false, item: { name: 'X' } };
    expect(await spotify.nowPlaying(user.id)).toBeNull();
    fake.state.status = 204;
    expect(await spotify.nowPlaying(user.id)).toBeNull();
  });

  it('conta desautorizada no Spotify: o vínculo some', async () => {
    const { spotify, user, connect, fake, advance } = setup();
    await connect();
    fake.state.revoked = true;
    advance(3600_000);
    await expect(spotify.nowPlaying(user.id)).rejects.toThrow();
    expect(spotify.status(user.id).linked).toBe(false);
  });

  it('poller põe a música na atividade de quem está online; esconder tira', async () => {
    const { svc, spotify, user, connect } = setup();
    await connect();
    const poller = new SpotifyPoller(spotify, svc.presence, svc.activity);
    await poller.tick();
    expect(svc.activity.text(user.id)).toBe(''); // offline: não consulta
    svc.presence.add({ sessionId: 's1', userId: user.id, name: 'Ana', roomId: 'reception' });
    await poller.tick();
    expect(svc.activity.text(user.id)).toBe('🎵 Garota de Ipanema – Tom Jobim');
    expect(svc.activity.url(user.id)).toBe('https://open.spotify.com/track/x');
    svc.activity.editor(user.id, { state: 'active', language: 'sql' });
    expect(svc.activity.text(user.id)).toBe(
      '💻 Codando em SQL no VS Code\n🎵 Garota de Ipanema – Tom Jobim',
    );

    const deps = { spotify, spotifyPoller: poller, activity: svc.activity };
    const caller = { user: svc.users.findById(user.id)!, token: 't' };
    spotifySettings(caller, { hidden: true }, deps);
    expect(svc.activity.text(user.id)).toBe('💻 Codando em SQL no VS Code');
    await poller.tick();
    expect(svc.activity.url(user.id)).toBe('');
  });

  it('rotas: sem Client ID fica desligado; a volta do Spotify redireciona com o resultado', async () => {
    const { svc, spotify, user, fake } = setup();
    const caller = { user: svc.users.findById(user.id)!, token: 't' };
    const off = { spotify: svc.spotify, spotifyPoller: svc.spotifyPoller, activity: svc.activity };
    expect(spotifyConnect(caller, off).ok).toBe(false);

    const deps = {
      spotify,
      spotifyPoller: new SpotifyPoller(spotify, svc.presence, svc.activity),
      activity: svc.activity,
    };
    const start = spotifyConnect(caller, deps);
    if (!start.ok) throw new Error('esperava url');
    const url = new URL(start.body.url);
    fake.state.challenge = url.searchParams.get('code_challenge')!;
    const back = await spotifyCallback(
      { code: 'codigo-bom', state: url.searchParams.get('state') },
      deps,
    );
    expect(back).toBe('http://localhost:5173/?spotify=ok');
    expect(await spotifyCallback({ error: 'access_denied' }, deps)).toBe(
      'http://localhost:5173/?spotify=cancelado',
    );
  });
});
