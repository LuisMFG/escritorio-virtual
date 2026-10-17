import { z } from 'zod';
import { OFFICE_TIME_ZONE } from './accounts.js';

// ---------- Som ambiente ----------

export const AMBIENTS = ['none', 'office', 'cafe', 'rain'] as const;
export type Ambient = (typeof AMBIENTS)[number];
export const AMBIENT_LABELS: Record<Ambient, string> = {
  none: 'Silêncio',
  office: 'Escritório',
  cafe: 'Cafeteria',
  rain: 'Chuva',
};
export const ambientSchema = z.enum(AMBIENTS);

// ---------- Dia e noite ----------

/** Hora (com fração) no fuso do escritório. */
export function officeHour(now = new Date(), timeZone = OFFICE_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') + get('minute') / 60;
}

export interface DayLight {
  /** 0 = dia claro, 1 = noite fechada. */
  darkness: number;
  /** Cor do "filtro" de luz (multiplica a cena). */
  tint: number;
  label: 'madrugada' | 'manhã' | 'tarde' | 'entardecer' | 'noite';
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

function mixColor(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(lerp(ch(a, s), ch(b, s), t)) << s;
  return m(16) | m(8) | m(0);
}

const DAY = 0xffffff;
const DUSK = 0xffc9a0;
const NIGHT = 0x6f7fb8;

/**
 * Luz do ambiente pela hora: dia claro das 8h às 17h, entardecer até as 19h, noite até as 5h
 * e amanhecer até as 8h, com transições suaves.
 */
export function dayLight(hour: number): DayLight {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 8 && h < 17) return { darkness: 0, tint: DAY, label: h < 12 ? 'manhã' : 'tarde' };
  if (h >= 17 && h < 19) {
    const t = (h - 17) / 2;
    return {
      darkness: lerp(0, 0.75, t),
      tint: t < 0.5 ? mixColor(DAY, DUSK, t * 2) : mixColor(DUSK, NIGHT, (t - 0.5) * 2),
      label: 'entardecer',
    };
  }
  if (h >= 5 && h < 8) {
    const t = (h - 5) / 3;
    return {
      darkness: lerp(0.75, 0, t),
      tint: t < 0.5 ? mixColor(NIGHT, DUSK, t * 2) : mixColor(DUSK, DAY, (t - 0.5) * 2),
      label: 'manhã',
    };
  }
  return { darkness: 0.75, tint: NIGHT, label: h >= 19 ? 'noite' : 'madrugada' };
}

// ---------- Mural de recados ----------

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const NOTE_MAX = 140;
export const NOTES_PER_BOARD = 30;

export const boardRefSchema = z.object({ furniId: z.string().min(1).max(40) });
export const boardAddSchema = z.object({
  furniId: z.string().min(1).max(40),
  text: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, 'Recado vazio.').max(NOTE_MAX, `No máximo ${NOTE_MAX} caracteres.`)),
  color: z.enum(NOTE_COLORS).default('yellow'),
});
export const boardRemoveSchema = z.object({ noteId: z.number().int().positive() });

export interface BoardNote {
  id: number;
  userId: string;
  name: string;
  text: string;
  color: NoteColor;
  /** Epoch ms. */
  ts: number;
}
