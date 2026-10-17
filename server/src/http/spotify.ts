import { ErrorCode, spotifySettingsSchema, type SpotifyStatus } from '@office/shared';
import type { ActivityService } from '../services/ActivityService.js';
import type { SpotifyPoller } from '../services/SpotifyPoller.js';
import type { SpotifyService } from '../services/SpotifyService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface SpotifyDeps {
  spotify: SpotifyService;
  spotifyPoller: SpotifyPoller;
  activity: ActivityService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });
const notConfigured = () =>
  fail(400, ErrorCode.InvalidPayload, {
    message: 'O Spotify não está configurado neste escritório (falta SPOTIFY_CLIENT_ID).',
  });

export function spotifyStatus(caller: Caller, deps: SpotifyDeps): Result<SpotifyStatus> {
  return ok(deps.spotify.status(caller.user.id));
}

/** Começa a conexão: o navegador vai para este endereço do Spotify. */
export function spotifyConnect(caller: Caller, deps: SpotifyDeps): Result<{ url: string }> {
  if (!deps.spotify.configured) return notConfigured();
  return ok({ url: deps.spotify.authorizeUrl(caller.user.id) });
}

/**
 * Volta do Spotify (`?code&state` ou `?error`). Liga a conta e devolve para onde o navegador
 * deve voltar, com `?spotify=ok` ou `?spotify=erro`.
 */
export async function spotifyCallback(
  query: { code?: unknown; state?: unknown; error?: unknown },
  deps: SpotifyDeps,
): Promise<string> {
  const back = (result: 'ok' | 'erro' | 'cancelado') => {
    const base = deps.spotify.config?.returnUrl ?? '/';
    return `${base}${base.includes('?') ? '&' : '?'}spotify=${result}`;
  };
  if (!deps.spotify.configured) return back('erro');
  if (query.error) return back(query.error === 'access_denied' ? 'cancelado' : 'erro');
  if (typeof query.code !== 'string' || typeof query.state !== 'string') return back('erro');
  try {
    const userId = await deps.spotify.finishAuthorization(query.code, query.state);
    void deps.spotifyPoller.refresh(userId);
    return back('ok');
  } catch (err) {
    console.warn(`[spotify] conexão falhou: ${(err as Error).message}`);
    return back('erro');
  }
}

export function spotifySettings(
  caller: Caller,
  input: unknown,
  deps: SpotifyDeps,
): Result<SpotifyStatus> {
  const p = spotifySettingsSchema.safeParse(input);
  if (!p.success) return fail(400, ErrorCode.InvalidPayload);
  if (!deps.spotify.setHidden(caller.user.id, p.data.hidden)) return fail(404, ErrorCode.NotFound);
  if (p.data.hidden) deps.activity.setMusic(caller.user.id, null);
  else void deps.spotifyPoller.refresh(caller.user.id);
  return ok(deps.spotify.status(caller.user.id));
}

export function spotifyDisconnect(caller: Caller, deps: SpotifyDeps): Result<SpotifyStatus> {
  deps.spotify.unlink(caller.user.id);
  deps.activity.setMusic(caller.user.id, null);
  return ok(deps.spotify.status(caller.user.id));
}
