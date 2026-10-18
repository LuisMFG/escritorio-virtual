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

export interface EmoteDef {
  emoji: string;
  label: string;
  /** Comando no chat, sem a barra e sem acento (`/acenar`). */
  command: string;
  durationMs: number;
}

export const EMOTES = {
  wave: { emoji: '👋', label: 'Acenar', command: 'acenar', durationMs: 2200 },
  laugh: { emoji: '😂', label: 'Rir', command: 'rir', durationMs: 2200 },
  thumbs: { emoji: '👍', label: 'Joinha', command: 'joinha', durationMs: 2000 },
  heart: { emoji: '❤️', label: 'Coração', command: 'coracao', durationMs: 2200 },
  coffee: { emoji: '☕', label: 'Café', command: 'cafe', durationMs: 2500 },
  dance: { emoji: '💃', label: 'Dançar', command: 'dancar', durationMs: 6000 },
  // Fase 32: expressões do rosto e mão levantada (com o avatar montado, o rosto muda de verdade).
  hand: { emoji: '✋', label: 'Levantar a mão', command: 'mao', durationMs: 3000 },
  smile: { emoji: '😊', label: 'Sorrir', command: 'sorrir', durationMs: 3000 },
  sad: { emoji: '😢', label: 'Triste', command: 'triste', durationMs: 3000 },
  angry: { emoji: '😠', label: 'Bravo', command: 'bravo', durationMs: 3000 },
  surprised: { emoji: '😮', label: 'Surpreso', command: 'surpreso', durationMs: 3000 },
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

/**
 * Reconhece um comando de emote digitado no chat: `/acenar`, `/Coração`, `/dancar`…
 * (sem diferenciar maiúsculas e acentos). Devolve `null` se não for um comando conhecido.
 */
export function parseEmoteCommand(text: string): EmoteId | null {
  const m = /^\s*\/(\S+)\s*$/.exec(text);
  if (!m) return null;
  const cmd = nameKey(m[1]!);
  return EMOTE_IDS.find((id) => EMOTES[id].command === cmd) ?? null;
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
