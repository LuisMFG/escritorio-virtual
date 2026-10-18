import {
  CHAT_MAX_LENGTH,
  DM_PAGE_SIZE,
  nameKey,
  STATUS_LABELS,
  type DirectMessage,
  type DmConversation,
  type DmReadReceipt,
  replyPreviewText,
  type ReactionSummary,
  type Status,
  type TeamMember,
} from '@office/shared';
import type { LobbyConnection, OnlineInfo } from '../net/LobbyConnection.js';
import { setAvatarPreview } from './login.js';
import { appendLinkified, AttachmentDraft, attachmentView, linkPreview } from './attachments.js';
import { NOTIFY_LABELS, type SystemNotifier } from './notifications.js';
import {
  flashMessage,
  openReactionPicker,
  reactionChips,
  ReplyBar,
  replyQuote,
} from './reactions.js';

export interface MessagesDeps {
  userId: string;
  lobby: () => LobbyConnection | undefined;
  /** Lista da equipe (para "Nova conversa"). */
  loadTeam: () => Promise<TeamMember[]>;
  roomName: (roomId: string) => string;
  notifier: SystemNotifier;
  /** Total de não lidas mudou (contador no botão). */
  unreadChanged: (total: number) => void;
  /** Aviso rápido (erro ao anexar). */
  notify: (message: string) => void;
}

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

function when(ts: number): string {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? timeFormat.format(d)
    : dayFormat.format(d);
}

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'chat'; userId: string; name: string };

/**
 * Painel "Mensagens" (lateral): conversas privadas com qualquer pessoa da equipe, em
 * qualquer sala ou offline. A conversa aberta marca as mensagens como lidas.
 */
export class MessagesPanel {
  private readonly root = document.createElement('aside');
  private readonly body = document.createElement('div');
  private readonly title = document.createElement('h2');
  private readonly back = document.createElement('button');
  private readonly notifyBtn = document.createElement('button');
  private view: View = { kind: 'list' };
  private conversations: DmConversation[] = [];
  private online = new Map<string, OnlineInfo>();
  /** Mensagens da conversa aberta. */
  private messages: DirectMessage[] = [];
  private hasOlder = false;
  private chatList: HTMLOListElement | null = null;
  private draft = new Map<string, string>();
  private replyBar = new ReplyBar();

  constructor(private readonly deps: MessagesDeps) {
    this.root.className = 'dm-panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Mensagens privadas');
    const head = document.createElement('header');
    head.className = 'dm-head';
    Object.assign(this.back, { type: 'button', className: 'dm-icon', textContent: '←' });
    this.back.setAttribute('aria-label', 'Voltar para as conversas');
    this.back.addEventListener('click', () => this.show({ kind: 'list' }));
    Object.assign(this.notifyBtn, { type: 'button', className: 'dm-icon' });
    this.notifyBtn.addEventListener('click', () => void deps.notifier.toggle());
    deps.notifier.onChange(() => this.renderNotify());
    const close = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'dm-icon',
      textContent: '✕',
    });
    close.setAttribute('aria-label', 'Fechar mensagens');
    close.addEventListener('click', () => this.close());
    head.append(this.back, this.title, this.notifyBtn, close);
    this.body.className = 'dm-body';
    this.root.append(head, this.body);
    document.body.append(this.root);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.renderNotify();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** A conversa com essa pessoa está aberta e visível agora? */
  isReading(userId: string): boolean {
    return (
      this.isOpen &&
      this.view.kind === 'chat' &&
      this.view.userId === userId &&
      document.visibilityState === 'visible'
    );
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Abre o painel (na lista ou direto numa conversa). */
  open(withUser?: { userId: string; name: string }): void {
    this.root.hidden = false;
    document.body.classList.add('dm-open');
    void this.show(withUser ? { kind: 'chat', ...withUser } : { kind: 'list' });
  }

  close(): void {
    this.root.hidden = true;
    document.body.classList.remove('dm-open');
    this.chatList = null;
  }

  /** (Re)conectou: recarrega as conversas e o contador. */
  async refresh(): Promise<void> {
    this.conversations = (await this.deps.lobby()?.conversations()) ?? [];
    this.emitUnread();
    if (this.isOpen && this.view.kind === 'list') this.render();
    if (this.isOpen && this.view.kind === 'chat') await this.show(this.view);
  }

  setOnline(list: OnlineInfo[]): void {
    this.online = new Map(list.map((p) => [p.userId, p]));
    if (this.isOpen && this.view.kind !== 'chat') this.render();
    if (this.isOpen && this.view.kind === 'chat') this.renderChatSubtitle();
  }

  /** Mensagem nova (minha, de outra aba, ou de alguém). */
  receive(m: DirectMessage): void {
    const mine = m.fromUserId === this.deps.userId;
    const otherId = mine ? m.toUserId : m.fromUserId;
    const reading = this.isReading(otherId);
    const conv = this.conversations.find((c) => c.userId === otherId);
    const unread = !mine && !reading ? (conv?.unread ?? 0) + 1 : (conv?.unread ?? 0);
    const updated: DmConversation = {
      userId: otherId,
      name: conv?.name ?? this.online.get(otherId)?.name ?? '…',
      figure: conv?.figure ?? '',
      lastText: m.text || (m.attachment ? '📎 Anexo' : ''),
      lastFromMe: mine,
      lastAt: m.ts,
      unread,
    };
    this.conversations = [updated, ...this.conversations.filter((c) => c.userId !== otherId)];
    if (!conv) void this.refresh(); // conversa nova: busca nome e visual certos
    this.emitUnread();

    if (this.isOpen && this.view.kind === 'chat' && this.view.userId === otherId) {
      this.messages.push(m);
      this.appendMessage(m, true);
      if (reading && !mine) this.deps.lobby()?.markRead(otherId);
    } else if (this.isOpen && this.view.kind === 'list') {
      this.render();
    }
  }

  receipt(r: DmReadReceipt): void {
    if (r.readerId === this.deps.userId) {
      // Li em outra aba: zera o contador daquela conversa.
      const conv = this.conversations.find((c) => c.userId === r.writerId);
      if (conv) conv.unread = 0;
      this.emitUnread();
      if (this.isOpen && this.view.kind === 'list') this.render();
    } else if (r.writerId === this.deps.userId) {
      // A outra pessoa leu as minhas.
      for (const m of this.messages) {
        if (m.fromUserId === this.deps.userId && m.id <= r.upToId && m.readAt === null) {
          m.readAt = Date.now();
        }
      }
      if (this.view.kind === 'chat' && this.view.userId === r.readerId) this.renderSeen();
    }
  }

  /** A aba voltou a ficar visível com uma conversa aberta: marca como lida. */
  visibilityChanged(): void {
    if (this.view.kind === 'chat' && this.isReading(this.view.userId)) this.markOpenRead();
  }

  get unreadTotal(): number {
    return this.conversations.reduce((n, c) => n + c.unread, 0);
  }

  // ---------- Telas ----------

  private async show(view: View): Promise<void> {
    if (this.view.kind === 'chat') this.saveDraft();
    this.view = view;
    this.back.hidden = view.kind === 'list';
    if (view.kind === 'chat') {
      this.title.textContent = view.name;
      this.messages = (await this.deps.lobby()?.history(view.userId)) ?? [];
      this.hasOlder = this.messages.length >= DM_PAGE_SIZE;
      if (this.view !== view) return;
      this.renderChat(view.userId);
      this.markOpenRead();
    } else {
      this.title.textContent = view.kind === 'list' ? 'Mensagens' : 'Nova conversa';
      this.render();
    }
  }

  private render(): void {
    if (this.view.kind === 'list') this.renderList();
    else if (this.view.kind === 'new') void this.renderNew();
  }

  private renderList(): void {
    const newBtn = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-primary dm-new',
      textContent: 'Nova conversa',
    });
    newBtn.addEventListener('click', () => void this.show({ kind: 'new' }));
    const nodes: HTMLElement[] = [newBtn];
    if (this.conversations.length === 0) {
      nodes.push(
        p('muted dm-empty', 'Nenhuma conversa ainda. Mande uma mensagem para alguém da equipe!'),
      );
    }
    const ul = document.createElement('ul');
    ul.className = 'dm-list';
    for (const c of this.conversations) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dm-conv';
      if (c.unread) btn.classList.add('unread');
      btn.append(this.face(c.figure, c.userId));
      const text = document.createElement('span');
      text.className = 'dm-conv-text';
      const top = document.createElement('span');
      top.className = 'dm-conv-top';
      top.append(span('dm-conv-name', c.name), span('muted dm-conv-time', when(c.lastAt)));
      const last = span('dm-conv-last', `${c.lastFromMe ? 'Você: ' : ''}${c.lastText}`);
      text.append(top, last);
      btn.append(text);
      if (c.unread) btn.append(span('dm-badge', String(c.unread)));
      btn.addEventListener(
        'click',
        () => void this.show({ kind: 'chat', userId: c.userId, name: c.name }),
      );
      li.append(btn);
      ul.append(li);
    }
    nodes.push(ul);
    this.body.replaceChildren(...nodes);
  }

  private async renderNew(): Promise<void> {
    const search = Object.assign(document.createElement('input'), {
      type: 'search',
      className: 'dm-search',
      placeholder: 'Buscar pessoa',
    });
    search.setAttribute('aria-label', 'Buscar pessoa');
    const ul = document.createElement('ul');
    ul.className = 'dm-list';
    this.body.replaceChildren(search, p('muted', 'Carregando…'));
    let team: TeamMember[] = [];
    try {
      team = (await this.deps.loadTeam()).filter((m) => m.userId !== this.deps.userId);
    } catch (err) {
      this.body.replaceChildren(p('login-error', (err as Error).message));
      return;
    }
    if (this.view.kind !== 'new') return;
    const draw = () => {
      const q = nameKey(search.value);
      const people = team
        .filter((m) => !q || nameKey(`${m.name} ${m.username ?? ''}`).includes(q))
        .sort(
          (a, b) =>
            Number(this.online.has(b.userId)) - Number(this.online.has(a.userId)) ||
            a.name.localeCompare(b.name, 'pt-BR'),
        );
      ul.replaceChildren(
        ...people.map((m) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dm-conv';
          btn.append(this.face(m.figure, m.userId));
          const text = span('dm-conv-text', '');
          text.append(
            span('dm-conv-name', m.name),
            span(
              'muted dm-conv-last',
              [m.cargo?.name, this.where(m.userId)].filter(Boolean).join(' · '),
            ),
          );
          btn.append(text);
          btn.addEventListener(
            'click',
            () => void this.show({ kind: 'chat', userId: m.userId, name: m.name }),
          );
          li.append(btn);
          return li;
        }),
      );
    };
    search.addEventListener('input', draw);
    draw();
    this.body.replaceChildren(search, ul);
    search.focus();
  }

  private renderChat(userId: string): void {
    const subtitle = p('muted dm-sub', '');
    const list = document.createElement('ol');
    list.className = 'dm-messages';
    this.chatList = list;
    if (this.hasOlder) {
      const older = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'btn-link dm-older',
        textContent: 'Carregar mensagens anteriores',
      });
      older.addEventListener('click', () => void this.loadOlder(userId));
      const li = document.createElement('li');
      li.className = 'dm-older-row';
      li.append(older);
      list.append(li);
    }
    for (const m of this.messages) this.appendMessage(m, false);
    if (this.messages.length === 0) {
      list.append(
        p('muted dm-empty', 'Comece a conversa. Ela fica salva mesmo se a pessoa estiver offline.'),
      );
    }

    const form = document.createElement('form');
    form.className = 'dm-form';
    const input = Object.assign(document.createElement('input'), {
      className: 'chat-input',
      maxLength: CHAT_MAX_LENGTH,
      placeholder: 'Mensagem privada…',
      autocomplete: 'off',
      value: this.draft.get(userId) ?? '',
    });
    input.setAttribute('aria-label', 'Mensagem privada');
    const send = Object.assign(document.createElement('button'), {
      type: 'submit',
      className: 'btn-primary',
      textContent: 'Enviar',
    });
    const attach = new AttachmentDraft(
      (msg) => this.deps.notify(msg),
      () => input.focus(),
    );
    form.append(attach.button, attach.input, input, send);
    attach.bind(this.root, input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (attach.uploading) return;
      const text = input.value.trim();
      const file = attach.current;
      if (!text && !file) return;
      this.deps.lobby()?.send(userId, text, this.replyBar.current?.id, file?.id);
      attach.clear();
      this.replyBar.set(null);
      input.value = '';
      this.draft.delete(userId);
    });
    // Teclas aqui não vão para a cena (Enter não abre o chat da sala, etc.).
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.replyBar.current) {
        e.preventDefault();
        this.replyBar.set(null);
      }
      e.stopPropagation();
    });

    this.replyBar = new ReplyBar(() => input.focus());
    this.body.replaceChildren(subtitle, list, this.replyBar.el, attach.chip, form);
    this.renderChatSubtitle();
    this.renderSeen();
    list.scrollTop = list.scrollHeight;
    input.focus();
  }

  private renderChatSubtitle(): void {
    if (this.view.kind !== 'chat') return;
    const sub = this.body.querySelector('.dm-sub');
    if (sub) sub.textContent = this.where(this.view.userId) || 'offline — recebe quando voltar';
  }

  private where(userId: string): string {
    const o = this.online.get(userId);
    if (!o) return '';
    const status = o.status !== 'available' ? ` · ${STATUS_LABELS[o.status as Status] ?? ''}` : '';
    return `● online${o.roomId ? ` · ${this.deps.roomName(o.roomId)}` : ''}${status}`;
  }

  private appendMessage(m: DirectMessage, scroll: boolean): void {
    const list = this.chatList;
    if (!list) return;
    list.querySelector('.dm-empty')?.remove();
    const mine = m.fromUserId === this.deps.userId;
    // Linha = balão + reações embaixo dele.
    const row = document.createElement('li');
    row.className = mine ? 'dm-row mine' : 'dm-row';
    row.dataset.id = String(m.id);
    const bubble = document.createElement('div');
    bubble.className = mine ? 'dm-msg mine' : 'dm-msg';
    if (m.replyTo) {
      const target = m.replyTo.id;
      bubble.append(
        replyQuote(m.replyTo, () => flashMessage(list.querySelector(`li[data-id="${target}"]`))),
      );
    }
    const text = span('dm-text', '');
    appendLinkified(text, m.text);
    if (m.text) bubble.append(text);
    if (m.attachment) bubble.append(attachmentView(m.attachment));
    const preview = m.attachment ? null : linkPreview(m.text);
    if (preview) bubble.append(preview);
    bubble.append(span('dm-time', when(m.ts)), this.msgActions(m));
    row.append(bubble, this.chips(m.id, m.reactions));
    list.append(row);
    if (scroll) list.scrollTop = list.scrollHeight;
    this.renderSeen();
  }

  /** Reações de uma DM mudaram. */
  updateReactions(id: number, reactions: ReactionSummary[]): void {
    const msg = this.messages.find((m) => m.id === id);
    if (msg) msg.reactions = reactions;
    const list = this.chatList;
    if (!list) return;
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.querySelector(`li[data-id="${id}"] .reactions`)?.replaceWith(this.chips(id, reactions));
    if (stick) list.scrollTop = list.scrollHeight;
  }

  private chips(id: number, reactions: readonly ReactionSummary[]): HTMLDivElement {
    return reactionChips(reactions, this.deps.userId, (emoji) =>
      this.deps.lobby()?.react(id, emoji),
    );
  }

  private msgActions(m: DirectMessage): HTMLSpanElement {
    const box = span('msg-actions', '');
    const name =
      m.fromUserId === this.deps.userId ? 'Você' : this.view.kind === 'chat' ? this.view.name : '';
    const reply = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'msg-action',
      textContent: '↩',
      title: 'Responder',
    });
    reply.setAttribute('aria-label', 'Responder');
    reply.addEventListener('click', () => {
      this.replyBar.set({ id: m.id, userId: m.fromUserId, name, text: replyPreviewText(m.text) });
      this.body.querySelector<HTMLInputElement>('.dm-form input')?.focus();
    });
    const react = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'msg-action',
      textContent: '😊',
      title: 'Reagir',
    });
    react.setAttribute('aria-label', 'Reagir');
    react.addEventListener('click', () =>
      openReactionPicker(react, (emoji) => this.deps.lobby()?.react(m.id, emoji)),
    );
    box.append(reply, react);
    return box;
  }

  /** "Visto" embaixo da minha última mensagem lida. */
  private renderSeen(): void {
    const list = this.chatList;
    if (!list) return;
    list.querySelector('.dm-seen')?.remove();
    const last = this.messages.at(-1);
    if (!last || last.fromUserId !== this.deps.userId || last.readAt === null) return;
    list.append(p('dm-seen', 'Visto'));
  }

  /** Abre a conversa e destaca a mensagem (resultado da busca). */
  async showMessage(userId: string, name: string, id: number): Promise<void> {
    this.root.hidden = false;
    document.body.classList.add('dm-open');
    await this.show({ kind: 'chat', userId, name });
    // Mensagem antiga: carrega páginas anteriores até achar (ou acabar).
    for (let i = 0; i < 10 && !this.messages.some((m) => m.id === id) && this.hasOlder; i++) {
      await this.loadOlder(userId);
    }
    flashMessage(this.chatList?.querySelector(`li[data-id="${id}"]`) ?? null);
  }

  private async loadOlder(userId: string): Promise<void> {
    const first = this.messages[0];
    if (!first) return;
    const older = (await this.deps.lobby()?.history(userId, first.id)) ?? [];
    this.messages = [...older, ...this.messages];
    this.hasOlder = older.length >= DM_PAGE_SIZE;
    const list = this.chatList;
    const keep = list ? list.scrollHeight - list.scrollTop : 0;
    this.renderChat(userId);
    if (this.chatList) this.chatList.scrollTop = this.chatList.scrollHeight - keep;
  }

  private markOpenRead(): void {
    if (this.view.kind !== 'chat') return;
    const userId = this.view.userId;
    const conv = this.conversations.find((c) => c.userId === userId);
    if (conv?.unread) {
      conv.unread = 0;
      this.emitUnread();
    }
    if (this.messages.some((m) => m.fromUserId === userId && m.readAt === null)) {
      this.deps.lobby()?.markRead(userId);
      for (const m of this.messages) if (m.fromUserId === userId) m.readAt ??= Date.now();
    }
  }

  private saveDraft(): void {
    if (this.view.kind !== 'chat') return;
    const input = this.body.querySelector<HTMLInputElement>('.dm-form input');
    if (input?.value) this.draft.set(this.view.userId, input.value);
  }

  private renderNotify(): void {
    const state = this.deps.notifier.state;
    this.notifyBtn.textContent = state === 'on' ? '🔔' : '🔕';
    this.notifyBtn.title = NOTIFY_LABELS[state];
    this.notifyBtn.setAttribute('aria-label', NOTIFY_LABELS[state]);
    this.notifyBtn.setAttribute('aria-pressed', String(state === 'on'));
    this.notifyBtn.disabled = state === 'unsupported' || state === 'blocked';
  }

  private emitUnread(): void {
    this.deps.unreadChanged(this.unreadTotal);
  }

  private face(figure: string, userId: string): HTMLElement {
    const wrap = span('team-face dm-face', '');
    if (figure) {
      const img = Object.assign(document.createElement('img'), { alt: '', width: 64, height: 110 });
      setAvatarPreview(img, figure);
      wrap.append(img);
    }
    if (this.online.has(userId)) wrap.append(span('dm-online', ''));
    return wrap;
  }
}

function p(className: string, text: string): HTMLParagraphElement {
  return Object.assign(document.createElement('p'), { className, textContent: text });
}

function span(className: string, text: string): HTMLSpanElement {
  return Object.assign(document.createElement('span'), { className, textContent: text });
}
