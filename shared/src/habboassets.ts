import { HABBO_HOTEL_ID } from './constants.js';

/** Base da API REST (endpoints JSON; mobis exigem token). */
export const HABBOASSETS_API = 'https://www.habboassets.com/api/v2';
/** CDN com os arquivos originais do Habbo (SWFs das bibliotecas de roupa). */
export const HABBOASSETS_CDN = 'https://cdn.habboassets.com';

/** Folha de sprites (`png`) ou dados (`json`) de uma biblioteca de roupa, convertida pelo servidor. */
export function figureSheetUrl(lib: string, revision: number, ext: 'png' | 'json'): string {
  return `/hh/figure/${encodeURIComponent(lib)}.${ext}?revision=${revision}&v=${SHEET_FORMAT}`;
}

/** Folha de um efeito do Habbo (`png`) ou imagens + animação (`json`). */
export function effectSheetUrl(lib: string, revision: number, ext: 'png' | 'json'): string {
  return `/hh/effect/${encodeURIComponent(lib)}.${ext}?revision=${revision}&v=${SHEET_FORMAT}`;
}

/**
 * Versão do formato das folhas convertidas pelo servidor. Vai na URL: o navegador guarda as
 * folhas para sempre, então mudar a conversão precisa mudar o endereço.
 */
export const SHEET_FORMAT = 2;

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

/** URL da miniatura de uma peça de roupa (no boneco cinza "fantasma"), pelo id do set. */
export function clothingSetImageUrl(
  setId: number,
  opts: { direction?: number } = {},
  base = HABBOASSETS_IMAGER,
): string {
  const qs = query({ direction: opts.direction });
  return `${base}/clothing/set/${setId}.png${qs ? `?${qs}` : ''}`;
}
