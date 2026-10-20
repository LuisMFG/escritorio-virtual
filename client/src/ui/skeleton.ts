/**
 * Esqueleto de carregamento (Fase 45): barrinhas cintilando no lugar do conteúdo, com
 * "Carregando…" para leitores de tela.
 */
export function skeletonHtml(lines = 3): string {
  const bars = Array.from(
    { length: lines },
    (_, i) => `<span class="skeleton-bar" style="width:${[92, 76, 84, 64, 88][i % 5]}%"></span>`,
  ).join('');
  return `<div class="skeleton" role="status" aria-busy="true"><span class="sr-only">Carregando…</span>${bars}</div>`;
}

export function skeleton(lines = 3): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = skeletonHtml(lines);
  return tpl.content.firstElementChild as HTMLElement;
}
