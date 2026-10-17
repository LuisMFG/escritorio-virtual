import { avatarImageUrl, formatBirthday, STATUS_LABELS, type Status } from '@office/shared';
import { cargoPill } from './profile.js';

export interface AvatarCardInfo {
  sessionId: string;
  name: string;
  status: string;
  isLocal: boolean;
  figure: string;
  roomName: string;
  username: string | null;
  cargo: string;
  cargoColor: string;
  bio: string;
  /** `MM-DD` (da aba Equipe, quando já carregada). */
  birthday: string | null;
  birthdayToday: boolean;
  userId: string;
  /** Quem vê o cartão é admin (mostra as ações de moderação). */
  viewerIsAdmin: boolean;
  /** A pessoa está fora da Recepção (dá para "tirar da sala"). */
  canKickFromRoom: boolean;
}

export interface AvatarCardHandlers {
  goTo(sessionId: string): void;
  mention(name: string): void;
  editAvatar(): void;
  openProfile(): void;
  kick(userId: string, name: string, scope: 'room' | 'office'): void;
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
    this.root.dataset.session = info.sessionId;

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

    const name = Object.assign(document.createElement('h3'), {
      textContent: info.birthdayToday ? `${info.name} 🎂` : info.name,
    });
    const extra: HTMLElement[] = [];
    if (info.username) {
      extra.push(
        Object.assign(document.createElement('p'), {
          className: 'muted card-user',
          textContent: `@${info.username}`,
        }),
      );
    }
    if (info.cargo) {
      const p = document.createElement('p');
      p.append(cargoPill(info.cargo, info.cargoColor));
      extra.push(p);
    }
    if (info.bio) {
      extra.push(
        Object.assign(document.createElement('p'), {
          className: 'card-bio',
          textContent: info.bio,
        }),
      );
    }
    if (info.birthdayToday || info.birthday) {
      extra.push(
        Object.assign(document.createElement('p'), {
          className: 'muted',
          textContent: info.birthdayToday
            ? '🎂 Faz aniversário hoje!'
            : `🎂 ${formatBirthday(info.birthday!)}`,
        }),
      );
    }
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
      actions.append(
        this.button('Meu perfil', () => this.on.openProfile()),
        this.button('Meu visual', () => this.on.editAvatar()),
      );
    } else {
      actions.append(
        this.button('Ir até', () => this.on.goTo(info.sessionId)),
        this.button('Mencionar', () => this.on.mention(info.name)),
      );
    }
    let modRow: HTMLDivElement | null = null;
    if (!info.isLocal && info.viewerIsAdmin) {
      modRow = document.createElement('div');
      modRow.className = 'card-actions card-mod';
      if (info.canKickFromRoom) {
        modRow.append(
          this.button('Tirar da sala', () => this.on.kick(info.userId, info.name, 'room')),
        );
      }
      modRow.append(
        this.button('Tirar do escritório', () => this.on.kick(info.userId, info.name, 'office')),
      );
    }

    const text = document.createElement('div');
    text.className = 'card-text';
    text.append(name, ...extra, status, room, actions);
    if (modRow) text.append(modRow);
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

  /** O cartão aberto é desta pessoa? (Para atualizar quando mais dados chegarem.) */
  isOpenFor(sessionId: string): boolean {
    return !this.root.hidden && this.root.dataset.session === sessionId;
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
