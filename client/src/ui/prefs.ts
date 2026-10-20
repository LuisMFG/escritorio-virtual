/**
 * Preferências de leitura (Fase 43): tamanho do texto e "reduzir movimento". Ficam salvas no
 * navegador e viram `--font-scale` e `data-motion` no <html> (o CSS usa os dois).
 */
export const FONT_SCALES = [
  { value: 1, label: 'Normal' },
  { value: 1.15, label: 'Grande' },
  { value: 1.3, label: 'Maior' },
] as const;

export type MotionPref = 'system' | 'reduce' | 'full';

const FONT_KEY = 'ev-font-scale';
const MOTION_KEY = 'ev-motion';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sem armazenamento: vale só para esta visita
  }
}

export function loadFontScale(): number {
  const v = Number(read(FONT_KEY));
  return FONT_SCALES.some((s) => s.value === v) ? v : 1;
}

export function loadMotion(): MotionPref {
  const v = read(MOTION_KEY);
  return v === 'reduce' || v === 'full' ? v : 'system';
}

/** Movimento reduzido de fato (a escolha, ou o sistema quando "do sistema"). */
export function motionReduced(pref = loadMotion()): boolean {
  if (pref !== 'system') return pref === 'reduce';
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Aplica as preferências salvas na página. */
export function applyPrefs(): void {
  const root = document.documentElement;
  root.style.setProperty('--font-scale', String(loadFontScale()));
  root.dataset.motion = motionReduced() ? 'reduce' : 'full';
}

export function setFontScale(scale: number): void {
  write(FONT_KEY, String(scale));
  applyPrefs();
}

export function setMotion(pref: MotionPref): void {
  write(MOTION_KEY, pref);
  applyPrefs();
}

const DAYLIGHT_KEY = 'ev-dia-noite';

/** Luz do dia e noite na sala (pelo horário de Brasília); desligada por padrão. */
export function loadDayLight(): boolean {
  return read(DAYLIGHT_KEY) === '1';
}

export function setDayLightPref(on: boolean): void {
  write(DAYLIGHT_KEY, on ? '1' : '0');
}
