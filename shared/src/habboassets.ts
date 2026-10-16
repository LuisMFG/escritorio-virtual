import { HABBO_HOTEL_ID } from './constants.js';

/** Base da API REST (endpoints JSON; mobis exigem token). */
export const HABBOASSETS_API = 'https://www.habboassets.com/api/v2';
/** Base do imager público (PNGs por URL, sem token). */
export const HABBOASSETS_IMAGER = 'https://www.habboassets.com/imaging';

/** Cabeçalhos padrão para a API REST. O token só deve ser usado no servidor. */
export function habboApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Hotel-ID': String(HABBO_HOTEL_ID),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export interface AvatarImageOptions {
  direction?: number;
  headDirection?: number;
  /** `n` = 64×110 (padrão), `l` = 128×220. */
  size?: 'n' | 'l';
}

/** URL do render de avatar a partir de uma figure string (pose em pé). */
export function avatarImageUrl(
  figure: string,
  opts: AvatarImageOptions = {},
  base = HABBOASSETS_IMAGER,
): string {
  const qs = query({
    figure,
    direction: opts.direction,
    head_direction: opts.headDirection,
    size: opts.size === 'l' ? 'l' : undefined,
  });
  return `${base}/avatar.png?${qs}`;
}

export interface FurniImageOptions {
  direction?: number;
  color?: number;
  state?: number;
  size?: 32 | 64;
  revision?: number;
}

/** URL do render de um móvel por classname. */
export function furniImageUrl(
  classname: string,
  opts: FurniImageOptions = {},
  base = HABBOASSETS_IMAGER,
): string {
  const qs = query({
    direction: opts.direction,
    color: opts.color,
    state: opts.state,
    size: opts.size === 32 ? 32 : undefined,
    revision: opts.revision,
  });
  return `${base}/furniture/${encodeURIComponent(classname)}.png${qs ? `?${qs}` : ''}`;
}

/** Monta uma query string ignorando valores `undefined` (sem depender de APIs do DOM/Node). */
function query(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}
