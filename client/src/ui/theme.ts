/**
 * Tema da interface (Fase 40): escuro (padrão) ou claro. A escolha fica salva no navegador e
 * vira `data-theme` no <html>, onde o CSS troca os tokens de cor.
 */
export type Theme = 'dark' | 'light';

const KEY = 'ev-theme';
/** Cor de fundo da cena (Pixi) e da barra do navegador em cada tema. */
export const THEME_BACKGROUND: Record<Theme, number> = { dark: 0x1b1d24, light: 0xe9edf3 };

const listeners = new Set<(t: Theme) => void>();

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Aplica o tema na página (sem salvar). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = `#${THEME_BACKGROUND[theme].toString(16).padStart(6, '0')}`;
  for (const fn of listeners) fn(theme);
}

/** Troca e salva o tema escolhido. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // navegador sem armazenamento: vale só para esta visita
  }
  applyTheme(theme);
}

export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
