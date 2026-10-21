import { z } from 'zod';

/**
 * TV com YouTube (Fase 51), no estilo do Watch2Gether: cada TV da sala tem uma fila de vídeos
 * que toca igual para todo mundo que abre a TV. Qualquer um adiciona, pausa e arrasta a barra;
 * pular o vídeo é por votação (maioria de quem está assistindo; quem adicionou pula na hora).
 */

/** Vídeos na fila de uma TV (no máximo). */
export const TV_QUEUE_MAX = 50;
/** Vídeos de uma mesma pessoa esperando na fila (no máximo). */
export const TV_PER_PERSON_MAX = 15;
/** Vídeos de uma playlist que entram de uma vez (no máximo). */
export const TV_PLAYLIST_MAX = 25;
/** Diferença (s) entre o seu player e o da sala que faz pular para o ponto certo. */
export const TV_SYNC_TOLERANCE_S = 2;

export const TvMessage = {
  /** Cliente → servidor: abri / fechei a TV (entra ou sai de quem assiste). */
  Open: 'tv.open',
  Close: 'tv.close',
  Add: 'tv.add',
  Remove: 'tv.remove',
  /** Tocar, pausar ou ir para um ponto do vídeo (vale para todos). */
  Control: 'tv.control',
  /** Voto para pular o vídeo atual. */
  Skip: 'tv.skip',
  /** O player descobriu a duração do vídeo. */
  Duration: 'tv.duration',
  /** O vídeo acabou neste player. */
  Ended: 'tv.ended',
  /** Servidor → quem assiste: estado completo da TV. */
  State: 'tv.state',
  /** Servidor → sala toda: o que passa em cada TV (capa na tela do móvel). */
  Screens: 'tv.screens',
  /** Servidor → quem pediu: não deu para adicionar (vídeo bloqueado, fila cheia…). */
  Error: 'tv.error',
} as const;

export interface TvItem {
  /** Id do item na fila (o mesmo vídeo pode entrar duas vezes). */
  id: string;
  videoId: string;
  title: string;
  author: string;
  addedBy: string;
  addedByName: string;
  /** Duração em segundos (vem do primeiro player que carregar o vídeo). */
  duration: number | null;
}

export interface TvPlayback {
  item: TvItem;
  /** Hora do servidor (ms) em que o vídeo estaria no segundo 0, tocando sem parar. */
  startedAt: number;
  /** Pausado neste ponto (s), ou `null` tocando. */
  pausedAt: number | null;
}

export interface TvViewer {
  userId: string;
  name: string;
}

export interface TvState {
  furniId: string;
  /** Hora do servidor (ms) quando o estado saiu: o cliente acerta o relógio por ela. */
  now: number;
  playing: TvPlayback | null;
  queue: TvItem[];
  viewers: TvViewer[];
  /** Quem já votou para pular o vídeo atual. */
  skipVotes: string[];
  skipNeeded: number;
}

/** O que cada TV da sala mostra na tela (`null` = desligada). */
export type TvScreens = Record<string, string | null>;

export type TvErrorCode = 'blocked' | 'not_found' | 'queue_full' | 'too_many' | 'invalid';

export const TV_ERRORS: Record<TvErrorCode, string> = {
  blocked: 'Esse vídeo não pode ser assistido fora do YouTube.',
  not_found: 'Não achei esse vídeo (link errado ou vídeo privado).',
  queue_full: `A fila está cheia (até ${TV_QUEUE_MAX} vídeos).`,
  too_many: `Você já tem ${TV_PER_PERSON_MAX} vídeos esperando na fila.`,
  invalid: 'Cole um link de vídeo ou playlist do YouTube.',
};

const furniId = z.string().min(1).max(64);
const videoId = z.string().regex(/^[\w-]{11}$/);

export const tvRefSchema = z.object({ furniId });
export const tvAddSchema = z.object({
  furniId,
  videoIds: z.array(videoId).min(1).max(TV_PLAYLIST_MAX),
});
export const tvRemoveSchema = z.object({ furniId, id: z.string().min(1).max(64) });
export const tvControlSchema = z.object({
  furniId,
  action: z.enum(['play', 'pause', 'seek']),
  position: z.number().min(0).max(86_400),
});
export const tvDurationSchema = z.object({
  furniId,
  itemId: z.string().min(1).max(64),
  duration: z.number().min(1).max(86_400),
});
export const tvEndedSchema = z.object({ furniId, itemId: z.string().min(1).max(64) });

/** Ponto do vídeo (s) agora, pela hora do servidor. */
export function tvPosition(p: TvPlayback, serverNow: number): number {
  if (p.pausedAt !== null) return p.pausedAt;
  const pos = Math.max(0, (serverNow - p.startedAt) / 1000);
  return p.item.duration ? Math.min(pos, p.item.duration) : pos;
}

/** Votos para pular: mais da metade de quem assiste (pelo menos 1). */
export function tvSkipNeeded(viewers: number): number {
  return Math.floor(Math.max(viewers, 1) / 2) + 1;
}

/**
 * Lê um link do YouTube (ou só o id): vídeo e/ou playlist. Aceita youtube.com/watch,
 * youtu.be, shorts, embed, live e music.youtube.com.
 */
export function parseYouTubeLink(text: string): { videoId: string | null; listId: string | null } {
  const raw = text.trim();
  if (/^[\w-]{11}$/.test(raw)) return { videoId: raw, listId: null };
  // (sem `URL`: o pacote compartilhado não depende do navegador nem do Node)
  const m = /^(?:https?:\/\/)?([^/?#\s]+)(\/[^?#\s]*)?(?:\?([^#\s]*))?/i.exec(raw);
  if (!m) return { videoId: null, listId: null };
  const host = m[1]!.toLowerCase().replace(/^(www|m|music)\./, '');
  const path = (m[2] ?? '/').split('/');
  const params = new Map(
    (m[3] ?? '')
      .split('&')
      .map((kv) => kv.split('=') as [string, string?])
      .map(([k, v]) => [k, safeDecode(v ?? '')] as const),
  );
  const valid = (id: string | undefined) => (id && /^[\w-]{11}$/.test(id) ? id : null);
  const list = params.get('list');
  const listId = list && /^[\w-]{10,64}$/.test(list) ? list : null;
  if (host === 'youtu.be') return { videoId: valid(path[1]), listId };
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') {
    return { videoId: null, listId: null };
  }
  const kind = path[1] ?? '';
  const id =
    kind === 'watch'
      ? valid(params.get('v'))
      : ['shorts', 'embed', 'live', 'v'].includes(kind)
        ? valid(path[2])
        : null;
  return { videoId: id, listId };
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** "1:05:09" / "4:07". */
export function formatTvTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
