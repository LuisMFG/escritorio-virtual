import { REACTIONS, type Reaction, type ReactionSummary, type ReplyPreview } from '@office/shared';

/** Fichas de reação ("👍 2"); clicar põe/tira a sua. Os nomes aparecem no title. */
export function reactionChips(
  reactions: readonly ReactionSummary[],
  myUserId: string,
  onToggle: (emoji: Reaction) => void,
): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'reactions';
  box.hidden = reactions.length === 0;
  for (const r of reactions) {
    const mine = r.users.some((u) => u.userId === myUserId);
    const chip = Object.assign(document.createElement('button'), {
      type: 'button',
      className: mine ? 'reaction-chip mine' : 'reaction-chip',
      textContent: `${r.emoji} ${r.users.length}`,
      title: r.users.map((u) => u.name).join(', '),
    });
    chip.setAttribute(
      'aria-label',
      `${r.emoji} de ${r.users.map((u) => u.name).join(', ')}${mine ? ' (clique para tirar a sua)' : ''}`,
    );
    chip.setAttribute('aria-pressed', String(mine));
    chip.addEventListener('click', () => onToggle(r.emoji));
    box.append(chip);
  }
  return box;
}

let openPicker: HTMLElement | null = null;

/** Menuzinho com as reações permitidas, perto do botão que abriu. */
export function openReactionPicker(anchor: HTMLElement, onPick: (emoji: Reaction) => void): void {
  openPicker?.remove();
  const menu = document.createElement('div');
  menu.className = 'reaction-picker';
  menu.setAttribute('role', 'menu');
  const close = () => {
    menu.remove();
    if (openPicker === menu) openPicker = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
  };
  const outside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  for (const emoji of REACTIONS) {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      textContent: emoji,
    });
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-label', `Reagir com ${emoji}`);
    b.addEventListener('click', () => {
      onPick(emoji);
      close();
    });
    menu.append(b);
  }
  document.body.append(menu);
  openPicker = menu;
  const a = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, a.left + a.width / 2 - m.width / 2), innerWidth - m.width - 8);
  const top = a.top - m.height - 6 > 8 ? a.top - m.height - 6 : a.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  (menu.firstElementChild as HTMLElement).focus();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', esc, true);
}

/** Citação da mensagem respondida (clicar leva até ela, se estiver na lista). */
export function replyQuote(reply: ReplyPreview, onClick?: () => void): HTMLElement {
  const q = document.createElement(onClick ? 'button' : 'div');
  q.className = 'reply-quote';
  if (q instanceof HTMLButtonElement) {
    q.type = 'button';
    q.title = 'Ir para a mensagem';
    q.addEventListener('click', () => onClick?.());
  }
  q.append(
    Object.assign(document.createElement('strong'), { textContent: `↩ ${reply.name}` }),
    ' ',
    Object.assign(document.createElement('span'), { textContent: reply.text }),
  );
  return q;
}

/** Faixa "Respondendo a Fulano: …" em cima do campo, com ✕ para cancelar. */
export class ReplyBar {
  readonly el = document.createElement('div');
  private readonly text = document.createElement('span');
  current: ReplyPreview | null = null;

  constructor(onCancel?: () => void) {
    this.el.className = 'reply-bar';
    this.el.hidden = true;
    const cancel = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'reply-cancel',
      textContent: '✕',
    });
    cancel.setAttribute('aria-label', 'Cancelar resposta');
    cancel.addEventListener('click', () => {
      this.set(null);
      onCancel?.();
    });
    this.el.append(this.text, cancel);
  }

  set(reply: ReplyPreview | null): void {
    this.current = reply;
    this.el.hidden = !reply;
    this.text.replaceChildren();
    if (reply) {
      this.text.append(
        'Respondendo a ',
        Object.assign(document.createElement('strong'), { textContent: reply.name }),
        `: ${reply.text}`,
      );
    }
  }
}

/** Rola até a mensagem e pisca para chamar atenção. */
export function flashMessage(el: Element | null): void {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('flash');
}
