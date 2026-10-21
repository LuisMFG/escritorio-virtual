import { z } from 'zod';
import { nameKey } from './protocol.js';

// ---------- Status ----------

export const STATUSES = ['available', 'busy', 'away'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  available: 'Disponível',
  busy: 'Ocupado',
  away: 'Ausente',
};

/** Minutos sem mexer no mouse/teclado até virar "Ausente" sozinho. */
export const AUTO_AWAY_MINUTES = 5;

export const statusSchema = z.object({ status: z.enum(STATUSES) });
export type StatusMessage = z.infer<typeof statusSchema>;

// ---------- Emotes ----------

/** Em que postura um emote vale (Fase 54). */
export type EmotePosture = 'stand' | 'sit' | 'lay';
const ANY: readonly EmotePosture[] = ['stand', 'sit', 'lay'];
/** Gestos de braço: em pé ou sentado (deitado não há desenho de braço). */
const ARMS: readonly EmotePosture[] = ['stand', 'sit'];
/** O corpo inteiro se mexe: só em pé. */
const BODY: readonly EmotePosture[] = ['stand'];

export interface EmoteDef {
  emoji: string;
  label: string;
  /** Comando no chat, sem a barra e sem acento (`/acenar`). */
  command: string;
  durationMs: number;
  /** Posturas em que o emote faz sentido (padrão: todas). */
  postures?: readonly EmotePosture[];
  /** Verbo do aviso "Levante para …" (sem ele, o rótulo). */
  verb?: string;
  /** Precisa de outra pessoa (o toca aqui): não vale sozinho pelo menu nem pelo comando simples. */
  needsTarget?: boolean;
}

export const EMOTES = {
  wave: { emoji: '👋', label: 'Acenar', command: 'acenar', durationMs: 2200, postures: ARMS },
  laugh: { emoji: '😂', label: 'Rir', command: 'rir', durationMs: 2200 },
  thumbs: { emoji: '👍', label: 'Joinha', command: 'joinha', durationMs: 2000, postures: ARMS },
  heart: { emoji: '❤️', label: 'Coração', command: 'coracao', durationMs: 2200, postures: ARMS },
  coffee: { emoji: '☕', label: 'Café', command: 'cafe', durationMs: 2500, postures: ARMS },
  dance: {
    emoji: '💃',
    label: 'Dançar',
    command: 'dancar',
    durationMs: 6000,
    postures: BODY,
    verb: 'dançar',
  },
  // Fase 32: expressões do rosto e mão levantada (com o avatar montado, o rosto muda de verdade).
  hand: { emoji: '✋', label: 'Levantar a mão', command: 'mao', durationMs: 3000, postures: ARMS },
  smile: { emoji: '😊', label: 'Sorrir', command: 'sorrir', durationMs: 3000 },
  sad: { emoji: '😢', label: 'Triste', command: 'triste', durationMs: 3000 },
  angry: { emoji: '😠', label: 'Bravo', command: 'bravo', durationMs: 3000 },
  surprised: { emoji: '😮', label: 'Surpreso', command: 'surpreso', durationMs: 3000 },
  // Fase 54: montados parte por parte com os desenhos que o Habbo tem.
  clap: { emoji: '👏', label: 'Palmas', command: 'palmas', durationMs: 2400, postures: ARMS },
  facepalm: {
    emoji: '🤦',
    label: 'Facepalm',
    command: 'facepalm',
    durationMs: 2600,
    postures: ARMS,
  },
  point: { emoji: '👉', label: 'Apontar', command: 'apontar', durationMs: 2400, postures: ARMS },
  bow: {
    emoji: '🙇',
    label: 'Reverência',
    command: 'reverencia',
    durationMs: 2200,
    postures: BODY,
    verb: 'fazer a reverência',
  },
  jump: {
    emoji: '🦘',
    label: 'Pular',
    command: 'pular',
    durationMs: 2100,
    postures: BODY,
    verb: 'pular',
  },
  cry: { emoji: '😭', label: 'Chorar', command: 'chorar', durationMs: 3200, postures: ANY },
  sleep: { emoji: '💤', label: 'Dormir', command: 'dormir', durationMs: 4800, postures: ANY },
  think: { emoji: '🤔', label: 'Pensar', command: 'pensar', durationMs: 3000, postures: ARMS },
  celebrate: {
    emoji: '🎉',
    label: 'Comemorar',
    command: 'comemorar',
    durationMs: 2400,
    postures: ARMS,
  },
  highfive: {
    emoji: '🤚',
    label: 'Toca aqui',
    command: 'tocaaqui',
    durationMs: 1600,
    postures: BODY,
    verb: 'tocar aqui',
    needsTarget: true,
  },
} as const satisfies Record<string, EmoteDef>;

export type EmoteId = keyof typeof EMOTES;
export const EMOTE_IDS = Object.keys(EMOTES) as EmoteId[];

export const emoteSchema = z.object({ emote: z.enum(EMOTE_IDS as [EmoteId, ...EmoteId[]]) });
export type EmoteRequest = z.infer<typeof emoteSchema>;

/** Emote tocado por alguém na sala (broadcast). */
export interface EmoteMessage {
  sessionId: string;
  emote: EmoteId;
}

/** Postura do avatar para os emotes (andando ou parado conta como em pé). */
export function emotePosture(action: string): EmotePosture {
  return action === 'sit' ? 'sit' : action === 'lay' ? 'lay' : 'stand';
}

/** Por que o emote não vale nesta postura (`null` = vale). Servidor e cliente usam o mesmo. */
export function emoteRefusal(id: EmoteId, posture: EmotePosture): string | null {
  const def: EmoteDef = EMOTES[id];
  if ((def.postures ?? ANY).includes(posture)) return null;
  if (posture === 'lay') return 'Deitado, só dá para emotes de rosto (dormir, chorar, sorrir…).';
  return `Levante para ${def.verb ?? def.label.toLowerCase()}.`;
}

/**
 * Reconhece um comando de emote digitado no chat: `/acenar`, `/Coração`, `/dancar`…
 * (sem diferenciar maiúsculas e acentos). Devolve `null` se não for um comando conhecido.
 * O toca aqui precisa do nome da pessoa: é o `parseHighFiveCommand`.
 */
export function parseEmoteCommand(text: string): EmoteId | null {
  const m = /^\s*\/(\S+)\s*$/.exec(text);
  if (!m) return null;
  const cmd = nameKey(m[1]!);
  const def = EMOTE_IDS.find((id) => EMOTES[id].command === cmd);
  return def && !(EMOTES[def] as EmoteDef).needsTarget ? def : null;
}

// ---------- Toca aqui (Fase 54) ----------

/** Até onde o toca aqui vai andando até a pessoa (tiles); mais longe, avisa. */
export const HIGH_FIVE_RANGE = 6;

export const highFiveSchema = z.object({ target: z.string().min(1).max(40) });
export type HighFiveRequest = z.infer<typeof highFiveSchema>;

/** Os dois que bateram as mãos (broadcast): todos na sala veem. */
export interface HighFiveMessage {
  a: string;
  b: string;
}

/**
 * `/tocaaqui nome` (ou `/toca aqui nome`): devolve o nome digitado (vazio sem nome), ou `null`
 * se não for o comando.
 */
export function parseHighFiveCommand(text: string): string | null {
  const m = /^\s*\/toca\s*aqui(?:\s+(.*))?$/i.exec(text);
  return m ? (m[1] ?? '').trim() : null;
}

/**
 * Acha a pessoa pelo nome digitado: o nome inteiro (sem diferenciar maiúsculas e acentos) ou,
 * se só uma servir, o começo dele (`/tocaaqui ana` acha "Ana Paula").
 */
export function findPersonByName<T extends { name: string }>(
  typed: string,
  people: readonly T[],
): { person: T } | { ambiguous: T[] } | null {
  const key = nameKey(typed);
  if (!key) return null;
  const exact = people.filter((p) => nameKey(p.name) === key);
  if (exact.length === 1) return { person: exact[0]! };
  const prefix = exact.length ? exact : people.filter((p) => nameKey(p.name).startsWith(key));
  if (prefix.length === 1) return { person: prefix[0]! };
  return prefix.length ? { ambiguous: prefix } : null;
}

// ---------- Digitando ----------

export const typingSchema = z.object({ on: z.boolean() });
export type TypingMessage = z.infer<typeof typingSchema>;

/** Sem novas teclas por este tempo, o "digitando…" some sozinho. */
export const TYPING_IDLE_MS = 4000;

// ---------- Menções ----------

export interface MentionRange {
  /** Índice do `@`. */
  start: number;
  /** Índice logo após o nome. */
  end: number;
  /** Nome como está na lista de pessoas. */
  name: string;
}

const BOUNDARY = /[\s.,;:!?)\]}'"…-]/;

/**
 * Acha menções `@Nome` no texto, comparando com os nomes de quem está na sala (sem
 * diferenciar maiúsculas/acentos). Nomes com espaço funcionam (`@Ana Paula`); quando dois
 * nomes servem, vale o mais longo.
 */
export function findMentions(text: string, names: readonly string[]): MentionRange[] {
  const candidates = [...new Set(names)].sort((a, b) => b.length - a.length);
  const out: MentionRange[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    if (i > 0 && !/\s|\(/.test(text[i - 1]!)) continue;
    for (const name of candidates) {
      const slice = text.slice(i + 1, i + 1 + name.length);
      const after = text[i + 1 + name.length];
      if (
        slice.length === name.length &&
        nameKey(slice) === nameKey(name) &&
        (after === undefined || BOUNDARY.test(after))
      ) {
        out.push({ start: i, end: i + 1 + name.length, name });
        i += name.length;
        break;
      }
    }
  }
  return out;
}

/** A mensagem menciona esta pessoa? */
export function mentions(text: string, name: string, names: readonly string[]): boolean {
  const key = nameKey(name);
  return findMentions(text, names).some((m) => nameKey(m.name) === key);
}
