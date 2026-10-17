import { avatarImageUrl, STATUS_LABELS, type Status } from '@office/shared';

export interface AvatarCardInfo {
  sessionId: string;
  name: string;
  status: string;
  isLocal: boolean;
  figure: string;
  roomName: string;
}

export interface AvatarCardHandlers {
  goTo(sessionId: string): void;
  mention(name: string): void;
  editAvatar(): void;
}

/** Cartão que aparece ao clicar num avatar: nome, status, sala e ações rápidas. */
export class AvatarCard {
  private readonly root = document.createElement('div');

  constructor(private readonly on: AvatarCardHandlers) {
    this.root.className = 'avatar-card';
    this.root.setAttribute('role', 'dialog');
    this.root.hidden = true;
    document.body.append(this.root);
    document.addEventListener('pointerdown', (e) => {
      if (!this.root.hidden && !this.root.contains(e.target as Node)) this.hide();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
  }

  show(info: AvatarCardInfo, at: { x: number; y: number }): void {
    this.root.setAttribute('aria-label', `Cartão de ${info.name}`);

    const img = Object.assign(document.createElement('img'), { alt: '', width: 64, height: 110 });
    const sources = [
      avatarImageUrl(info.figure, { direction: 3 }, '/hh'),
      avatarImageUrl(info.figure, { direction: 3 }),
    ];
    img.onerror = () => {
      const next = sources.shift();
      if (next) img.src = next;
      else img.hidden = true;
    };
    img.src = sources.shift()!;

    const name = Object.assign(document.createElement('h3'), { textContent: info.name });
    const status = Object.assign(document.createElement('p'), {
      className: 'card-status',
      textContent: STATUS_LABELS[info.status as Status] ?? STATUS_LABELS.available,
    });
    status.dataset.status = info.status;
    const room = Object.assign(document.createElement('p'), {
      className: 'muted',
      textContent: info.isLocal ? `Você · ${info.roomName}` : info.roomName,
    });

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    if (info.isLocal) {
      actions.append(this.button('Meu visual', () => this.on.editAvatar()));
    } else {
      actions.append(
        this.button('Ir até', () => this.on.goTo(info.sessionId)),
        this.button('Mencionar', () => this.on.mention(info.name)),
      );
    }

    const text = document.createElement('div');
    text.className = 'card-text';
    text.append(name, status, room, actions);
    this.root.replaceChildren(img, text);
    this.root.hidden = false;

    // Ao lado do clique, sem sair da tela.
    const { width, height } = this.root.getBoundingClientRect();
    const x = Math.min(Math.max(8, at.x + 16), window.innerWidth - width - 8);
    const y = Math.min(Math.max(8, at.y - height / 2), window.innerHeight - height - 8);
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    actions.querySelector('button')?.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-secondary',
      textContent: text,
    });
    b.addEventListener('click', () => {
      this.hide();
      onClick();
    });
    return b;
  }
}
