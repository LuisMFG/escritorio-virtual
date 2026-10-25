/**
 * A conta entrou por outra aba ou aparelho e esta saiu do escritório: cobre a tela com o aviso e
 * o botão "Usar aqui" (recarrega a página, que entra de novo e tira a outra aba).
 */
export function showReplaced(message: string): void {
  if (document.querySelector('.replaced-backdrop')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop replaced-backdrop';
  const box = document.createElement('div');
  box.className = 'sheet confirm-box replaced-box';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'replaced-title');
  const title = Object.assign(document.createElement('h2'), {
    id: 'replaced-title',
    textContent: message,
  });
  const text = Object.assign(document.createElement('p'), {
    textContent: 'Você continua no escritório por lá. Para voltar a usar esta aba, a outra sai.',
  });
  const actions = Object.assign(document.createElement('div'), { className: 'confirm-actions' });
  const here = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'btn-primary',
    textContent: 'Usar aqui',
  });
  here.addEventListener('click', () => location.reload());
  actions.append(here);
  box.append(title, text, actions);
  backdrop.append(box);
  document.body.append(backdrop);
  here.focus();
}
