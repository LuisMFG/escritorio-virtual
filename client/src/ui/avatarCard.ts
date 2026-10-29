import { avatarImageUrl, formatBirthday, STATUS_LABELS, type Status } from '@office/shared';
import { cargoPill } from './profile.js';
import { showcaseRow } from './badges.js';

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
  /** Emblemas de conquistas exibidos (ids separados por vírgula). */
  badges: string;
  /** Atividade fora do escritório ("💻 Codando em C# no Visual Studio"); uma por linha. */
  activity: string;
  /** Link da música (linha 🎵). */
  activityUrl: string;
  /** Modo foco: fim da fase (epoch ms; 0 = fora) e qual fase. */
  focusUntil: number;
  focusKind: string;
}

export interface AvatarCardHandlers {
  goTo(sessionId: string): void;
  /** Toca aqui (Fase 54): o servidor confere se a pessoa está perto e pode. */
  highFive(sessionId: string): void;
  mention(name: string): void;
  editAvatar(): void;
  openProfile(): void;
  kick(userId: string, name: string, scope: 'room' | 'office'): void;
  message(userId: string, name: string): void;
  praise(userId: string, name: string): void;
  /** Chamadas (Fase 49): como está a chamada em relação a essa pessoa. */
  callMode(userId: string): 'call' | 'add' | 'with' | 'none';
  call(userId: string, name: string): void;
}

/** Cartão que aparece ao clicar num avatar: nome, status, sala e ações rápidas. */
export class AvatarCard {
  private readonly root = document.createElement('div');
  /** Documentos (janela flutuante) onde já fecha ao clicar fora. */
  private readonly docs = new WeakSet<Document>();

  get element(): HTMLElement {
    return this.root;
  }

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
    if (info.focusKind && info.focusUntil > Date.now()) {
      const mins = Math.max(1, Math.ceil((info.focusUntil - Date.now()) / 60_000));
      extra.push(
        Object.assign(document.createElement('p'), {
          className: 'card-focus',
          textContent:
            info.focusKind === 'focus'
              ? `🍅 Em foco · faltam ${mins} min (melhor não interromper)`
              : `☕ Em pausa · ${mins} min`,
        }),
      );
    }
    const urls = info.activityUrl.split('\n');
    for (const [i, line] of info.activity.split('\n').entries()) {
      if (!line) continue;
      const p = Object.assign(document.createElement('p'), { className: 'card-activity' });
      // A música vira link para o Spotify; a demanda, para o Jira.
      const url = urls[i] ?? '';
      if (/^https?:\/\//.test(url) && (line.startsWith('🎵') || line.startsWith('📋'))) {
        p.append(
          Object.assign(document.createElement('a'), {
            href: url,
            target: '_blank',
            rel: 'noopener noreferrer',
            textContent: line,
          }),
        );
      } else {
        p.textContent = line;
      }
      extra.push(p);
    }
    const badges = showcaseRow(info.badges);
    if (badges) extra.push(badges);
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
      // Chamar para conversa (ou adicionar à chamada em que você está).
      const mode = this.on.callMode(info.userId);
      if (mode === 'call' || mode === 'add') {
        const b = this.button(mode === 'add' ? 'Adicionar à chamada' : 'Chamar para conversa', () =>
          this.on.call(info.userId, info.name),
        );
        b.classList.add('card-call');
        actions.append(b);
      } else if (mode === 'with') {
        const b = this.button('Na chamada com você', () => undefined);
        b.disabled = true;
        actions.append(b);
      }
      actions.append(
        this.button('Ir até', () => this.on.goTo(info.sessionId)),
        this.button('🤚 Toca aqui', () => this.on.highFive(info.sessionId)),
        this.button('Mensagem', () => this.on.message(info.userId, info.name)),
        this.button('Mencionar', () => this.on.mention(info.name)),
        this.button('🙌 Elogiar', () => this.on.praise(info.userId, info.name)),
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

    // Na janela flutuante: clicar fora também fecha (o Esc de lá já chega à aba).
    const doc = this.root.ownerDocument;
    const win = doc.defaultView ?? window;
    if (doc !== document && !this.docs.has(doc)) {
      this.docs.add(doc);
      doc.addEventListener('pointerdown', (e) => {
        if (!this.root.hidden && !this.root.contains(e.target as Node)) this.hide();
      });
    }
    // Ao lado do clique, sem sair da tela.
    const { width, height } = this.root.getBoundingClientRect();
    const x = Math.min(Math.max(8, at.x + 16), win.innerWidth - width - 8);
    const y = Math.min(Math.max(8, at.y - height / 2), win.innerHeight - height - 8);
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
