/**
 * Tema da interface (Fase 40; "do sistema" na Fase 43): escuro (padrão), claro ou seguindo o
 * sistema. A escolha fica salva no navegador e o tema efetivo vira `data-theme` no <html>,
 * onde o CSS troca os tokens de cor.
 */
export type Theme = 'dark' | 'light';
export type ThemePref = Theme | 'system';

const KEY = 'ev-theme';
/** Cor de fundo da cena (Pixi) e da barra do navegador em cada tema. */
export const THEME_BACKGROUND: Record<Theme, number> = { dark: 0x1b1d24, light: 0xe9edf3 };

const listeners = new Set<(t: Theme) => void>();
const systemQuery = () => window.matchMedia?.('(prefers-color-scheme: light)');

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

/** Tema efetivo de uma preferência (o "do sistema" pergunta ao navegador). */
export function resolveTheme(pref: ThemePref): Theme {
  if (pref !== 'system') return pref;
  return systemQuery()?.matches ? 'light' : 'dark';
}

/** Tema salvo, já resolvido. */
export function loadTheme(): Theme {
  return resolveTheme(loadThemePref());
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

/** Troca e salva a preferência de tema. */
export function setTheme(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // navegador sem armazenamento: vale só para esta visita
  }
  applyTheme(resolveTheme(pref));
}

export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// "Do sistema": acompanha quando o sistema troca de claro para escuro.
systemQuery()?.addEventListener?.('change', () => {
  if (loadThemePref() === 'system') applyTheme(loadTheme());
});
