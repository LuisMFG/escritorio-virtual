/**
 * Acessibilidade das janelas (Fase 48), para todas de uma vez: ao abrir uma `.modal-backdrop`
 * o foco entra nela, Tab e Shift+Tab ficam rodando dentro dela, e ao fechar o foco volta para
 * o botão que a abriu.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[hidden]') && el.getClientRects().length > 0,
  );
}

function topModal(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('.modal-backdrop');
  return all.length ? all[all.length - 1]! : null;
}

export function installModalFocus(): void {
  const openers = new WeakMap<HTMLElement, HTMLElement | null>();
  // Último foco fora das janelas (a janela costuma puxar o foco antes de a gente ver que abriu).
  let lastOutside: HTMLElement | null = null;
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.modal-backdrop')) lastOutside = t;
  });

  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement) || !n.classList.contains('modal-backdrop')) continue;
        openers.set(n, lastOutside);
        // Deixa a própria janela escolher o foco; se não escolher, vai no primeiro item.
        requestAnimationFrame(() => {
          if (n.isConnected && !n.contains(document.activeElement)) focusables(n)[0]?.focus();
        });
      }
      for (const n of r.removedNodes) {
        if (!(n instanceof HTMLElement) || !n.classList.contains('modal-backdrop')) continue;
        const opener = openers.get(n);
        const lost = !document.activeElement || document.activeElement === document.body;
        if (opener?.isConnected && lost && !topModal()) opener.focus();
      }
    }
  }).observe(document.body, { childList: true });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const modal = topModal();
    if (!modal) return;
    const items = focusables(modal);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !modal.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
