import { z } from 'zod';

/** Modo foco / Pomodoro (Fase 27). */
export const FOCUS_DEFAULT_MIN = 25;
export const BREAK_DEFAULT_MIN = 5;
export const FOCUS_PRESETS: readonly [number, number][] = [
  [25, 5],
  [50, 10],
  [90, 15],
];

export const focusStartSchema = z.object({
  minutes: z.number().int().min(1).max(120),
  breakMinutes: z.number().int().min(0).max(30),
});
export type FocusStart = z.infer<typeof focusStartSchema>;

export type FocusKind = 'focus' | 'break';

/** Servidor → a própria pessoa: mudou de fase (foco acabou e começou a pausa, etc.). */
export interface FocusPhase {
  /** `null` = acabou tudo (ou parou). */
  kind: FocusKind | null;
  /** Epoch ms do fim da fase atual (0 quando acabou). */
  until: number;
  /** A fase anterior terminou sozinha (e não porque a pessoa parou). */
  finished: boolean;
}

/** "12m", "45s" — quanto falta. */
export function focusLeft(until: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((until - now) / 1000));
  return s >= 60 ? `${Math.ceil(s / 60)}m` : `${s}s`;
}
