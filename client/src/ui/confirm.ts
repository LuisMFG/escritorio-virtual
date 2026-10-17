/**
 * Pergunta de confirmação no estilo do app (no lugar do `confirm()` do navegador).
 * Resolve `true` em "confirmar"; Esc, clique fora ou "Cancelar" resolvem `false`.
 */
export function confirmDialog(
  message: string,
  opts: { confirmLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop confirm-backdrop';
    const box = document.createElement('div');
    box.className = 'sheet confirm-box';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const text = Object.assign(document.createElement('p'), { textContent: message });
    const actions = Object.assign(document.createElement('div'), { className: 'confirm-actions' });
    const cancel = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-secondary',
      textContent: 'Cancelar',
    });
    const ok = Object.assign(document.createElement('button'), {
      type: 'button',
      className: opts.danger ? 'btn-primary btn-danger' : 'btn-primary',
      textContent: opts.confirmLabel ?? 'Confirmar',
    });
    actions.append(cancel, ok);
    box.append(text, actions);
    backdrop.append(box);
    document.body.append(backdrop);
    ok.focus();

    const finish = (value: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) finish(false);
    });
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
  });
}
