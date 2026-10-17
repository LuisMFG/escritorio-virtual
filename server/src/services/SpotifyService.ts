import type { NowPlaying, SpotifyStatus } from '@office/shared';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { SpotifyConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { spotifyLinks } from '../db/schema.js';

export const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';
export const SPOTIFY_API = 'https://api.spotify.com/v1';
const SCOPE = 'user-read-currently-playing';
/** Pedido de conexão vale por 10 min (tempo de a pessoa autorizar no Spotify). */
const STATE_TTL_MS = 10 * 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** A conta não serve mais (desautorizada no Spotify): o vínculo é apagado. */
export class SpotifyRevokedError extends Error {}

/** Spotify pediu para esperar (429). */
export class SpotifyRateLimitError extends Error {
  constructor(readonly retryAfterSec: number) {
    super('Spotify pediu para esperar');
  }
}

const base64url = (b: Buffer) => b.toString('base64url');

/**
 * Integração com o Spotify: autorização com PKCE (sem segredo de cliente, só o Client ID),
 * guarda do refresh token e leitura da música que a pessoa está ouvindo.
 */
export class SpotifyService {
  private readonly pending = new Map<string, { userId: string; verifier: string; exp: number }>();

  constructor(
    private readonly db: Db,
    readonly config: SpotifyConfig | undefined,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get configured(): boolean {
    return this.config !== undefined;
  }

  status(userId: string): SpotifyStatus {
    const link = this.link(userId);
    return {
      configured: this.configured,
      linked: Boolean(link),
      hidden: link?.hidden ?? false,
      displayName: link?.displayName ?? null,
    };
  }

  /** Endereço de autorização no Spotify para esta pessoa. */
  authorizeUrl(userId: string): string {
    const cfg = this.requireConfig();
    for (const [k, v] of this.pending) if (v.exp < this.now()) this.pending.delete(k);
    const state = base64url(randomBytes(18));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    this.pending.set(state, { userId, verifier, exp: this.now() + STATE_TTL_MS });
    const qs = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      redirect_uri: cfg.redirectUri,
      scope: SCOPE,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    });
    return `${SPOTIFY_ACCOUNTS}/authorize?${qs}`;
  }

  /** Volta do Spotify: troca o código pelos tokens e liga a conta. Devolve o id da pessoa. */
  async finishAuthorization(code: string, state: string): Promise<string> {
    const cfg = this.requireConfig();
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.exp < this.now()) throw new Error('Pedido de conexão expirado.');
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      code_verifier: pending.verifier,
    });
    if (!tokens.refresh_token) throw new Error('O Spotify não devolveu o refresh token.');
    let displayName: string | null = null;
    try {
      const me = await this.http(`${SPOTIFY_API}/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (me.ok)
        displayName = ((await me.json()) as { display_name?: string }).display_name ?? null;
    } catch {
      // o nome é só enfeite
    }
    const row = {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: this.now() + tokens.expires_in * 1000,
      displayName,
      hidden: false,
    };
    this.db
      .insert(spotifyLinks)
      .values({ userId: pending.userId, ...row, createdAt: new Date(this.now()) })
      .onConflictDoUpdate({ target: spotifyLinks.userId, set: row })
      .run();
    return pending.userId;
  }

  setHidden(userId: string, hidden: boolean): boolean {
    const res = this.db
      .update(spotifyLinks)
      .set({ hidden })
      .where(eq(spotifyLinks.userId, userId))
      .run();
    return res.changes > 0;
  }

  unlink(userId: string): void {
    this.db.delete(spotifyLinks).where(eq(spotifyLinks.userId, userId)).run();
  }

  /** Quem ligou a conta e não está escondendo a música. */
  activeUserIds(): string[] {
    return this.db
      .select({ userId: spotifyLinks.userId })
      .from(spotifyLinks)
      .where(eq(spotifyLinks.hidden, false))
      .all()
      .map((r) => r.userId);
  }

  /** Música tocando agora (`null` = nada tocando, pausado ou propaganda). */
  async nowPlaying(userId: string): Promise<NowPlaying | null> {
    const token = await this.accessToken(userId);
    if (!token) return null;
    let res = await this.http(`${SPOTIFY_API}/me/player/currently-playing`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Token venceu antes da hora: renova uma vez.
      const fresh = await this.accessToken(userId, true);
      if (!fresh) return null;
      res = await this.http(`${SPOTIFY_API}/me/player/currently-playing`, {
        headers: { Authorization: `Bearer ${fresh}` },
      });
    }
    if (res.status === 429) {
      throw new SpotifyRateLimitError(Number(res.headers.get('retry-after') ?? 30));
    }
    if (res.status === 204 || !res.ok) return null;
    const body = (await res.json()) as {
      is_playing?: boolean;
      currently_playing_type?: string;
      item?: {
        name?: string;
        artists?: { name: string }[];
        show?: { name: string };
        external_urls?: { spotify?: string };
      } | null;
    };
    const item = body.item;
    if (!body.is_playing || !item?.name) return null;
    const artists = item.artists?.map((a) => a.name).join(', ') || item.show?.name || 'Spotify';
    return { track: item.name, artists, url: item.external_urls?.spotify ?? '' };
  }

  private link(userId: string) {
    return this.db.select().from(spotifyLinks).where(eq(spotifyLinks.userId, userId)).get();
  }

  /** Access token válido (renova com o refresh token quando faltar menos de 1 min). */
  private async accessToken(userId: string, force = false): Promise<string | null> {
    const link = this.link(userId);
    if (!link || !this.config) return null;
    if (!force && link.expiresAt - this.now() > 60_000) return link.accessToken;
    let tokens: TokenResponse;
    try {
      tokens = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: link.refreshToken,
        client_id: this.config.clientId,
      });
    } catch (err) {
      if (err instanceof SpotifyRevokedError) this.unlink(userId);
      throw err;
    }
    this.db
      .update(spotifyLinks)
      .set({
        accessToken: tokens.access_token,
        // O Spotify pode girar o refresh token.
        refreshToken: tokens.refresh_token ?? link.refreshToken,
        expiresAt: this.now() + tokens.expires_in * 1000,
      })
      .where(eq(spotifyLinks.userId, userId))
      .run();
    return tokens.access_token;
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const res = await this.http(`${SPOTIFY_ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    if (res.status === 400 || res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'invalid_grant') throw new SpotifyRevokedError('Conta desautorizada.');
      throw new Error(`Spotify recusou: ${body.error ?? res.status}`);
    }
    if (!res.ok) throw new Error(`Spotify: HTTP ${res.status}`);
    return (await res.json()) as TokenResponse;
  }

  private requireConfig(): SpotifyConfig {
    if (!this.config) throw new Error('Spotify não configurado neste escritório.');
    return this.config;
  }
}
