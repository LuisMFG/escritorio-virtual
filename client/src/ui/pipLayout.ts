/** Contas da janela flutuante sem DOM (testáveis): tamanho lembrado, resolução e o que vai junto. */

/** Tamanho da janela ao abrir pela primeira vez. */
export const PIP_DEFAULT_SIZE = { width: 480, height: 380 };
const SIZE_KEY = 'escritorio.pip.tamanho';

/** Tamanho em que a janela foi fechada da última vez (ou o padrão). */
export function loadPipSize(): { width: number; height: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as {
      width?: unknown;
      height?: unknown;
    } | null;
    const ok = (n: unknown): n is number => typeof n === 'number' && n >= 200 && n <= 4000;
    if (s && ok(s.width) && ok(s.height)) return { width: s.width, height: s.height };
  } catch {
    // Sem armazenamento (aba anônima, bloqueado): fica o padrão.
  }
  return { ...PIP_DEFAULT_SIZE };
}

export function savePipSize(width: number, height: number): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ width, height }));
  } catch {
    // Sem armazenamento: só não lembra.
  }
}

/** Teto de pixels desenhados por quadro na janela (≈ uma tela 1440×900 sem ampliação). */
const PIP_MAX_PIXELS = 1440 * 900;

/**
 * Resolução do desenho na janela: em janela pequena desenha 2× a 3,5× maior e o navegador
 * reduz (rostos e roupas ficam nítidos); em janela grande cai até caber no teto de pixels,
 * mas nunca abaixo da densidade da tela.
 */
export function pipResolution(width: number, height: number, dpr: number): number {
  let res = Math.min(3, Math.max(dpr, 2));
  if (width < 360 || height < 280) res = Math.min(3.5, Math.max(dpr * 2, 2.75));
  else if (width < 480 || height < 360) res = Math.min(3, Math.max(dpr * 1.5, 2.25));
  const budget = Math.sqrt(PIP_MAX_PIXELS / Math.max(1, width * height));
  return Math.max(Math.min(res, budget), Math.min(dpr, 2), 1);
}

/** Painéis abertos no document.body que vão junto para a janela (menus, diálogos e jogos). */
export function isPipForwardable(node: Node): node is HTMLElement {
  if (typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) return false;
  return [
    'modal-backdrop',
    'confirm-backdrop',
    'person-menu',
    'tv-panel',
    'ttt-panel',
    'arcade-panel',
    'reaction-picker',
    'desk-chip',
  ].some((c) => node.classList.contains(c));
}
