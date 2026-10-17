import {
  CHAT_MAX_LENGTH,
  EMOTE_IDS,
  EMOTES,
  findMentions,
  nameKey,
  normalizeChatText,
  parseEmoteCommand,
  TYPING_IDLE_MS,
  replyPreviewText,
  type ChatMessage,
  type EmoteId,
  type Reaction,
  type ReactionSummary,
} from '@office/shared';
import { confirmDialog } from './confirm.js';
import {
  flashMessage,
  openReactionPicker,
  reactionChips,
  ReplyBar,
  replyQuote,
} from './reactions.js';

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
/** Distância (px) do fim da lista dentro da qual o histórico continua rolando sozinho. */
const STICKY_SCROLL_PX = 40;
/** Reenvia "digitando" enquanto a pessoa continua digitando (o servidor não expira sozinho). */
const TYPING_REFRESH_MS = 3000;
const MAX_SUGGESTIONS = 5;

export interface ChatHandlers {
  send(text: string, replyToId?: number): void;
  /** Põe/tira reação numa mensagem. */
  react(id: number, emoji: Reaction): void;
  emote(id: EmoteId): void;
  typing(on: boolean): void;
  /** Apagar a mensagem (o servidor confere se pode). */
  remove(id: number): void;
}

/**
 * Campo de mensagem fixo embaixo (com emotes e sugestão de @menções) e histórico recolhível.
 * Todo texto de usuários entra via `textContent` (nunca `innerHTML`).
 */
export class ChatPanel {
  private readonly form = document.createElement('form');
  private readonly input = document.createElement('input');
  private readonly emoteBtn = document.createElement('button');
  private readonly emoteMenu = document.createElement('div');
  private readonly suggestions = document.createElement('ul');
  private readonly history = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly log = document.createElement('ol');
  private readonly empty = document.createElement('p');
  private localUserId = '';
  /** Admin apaga qualquer mensagem; os outros, só as próprias. */
  private isAdmin = false;
  private localName = '';
  private names: string[] = [];
  private unread = 0;
  private typingOn = false;
  private typingSentAt = 0;
  private typingTimer = 0;
  private suggestionIndex = 0;
  private readonly replyBar = new ReplyBar(() => this.input.focus());

  constructor(private readonly on: ChatHandlers) {
    this.form.className = 'chat-bar';
    this.form.setAttribute('aria-label', 'Enviar mensagem');

    this.emoteBtn.type = 'button';
    this.emoteBtn.className = 'chat-emote-btn';
    this.emoteBtn.textContent = '😊';
    this.emoteBtn.title = 'Emotes';
    this.emoteBtn.setAttribute('aria-label', 'Emotes');
    this.emoteBtn.setAttribute('aria-expanded', 'false');
    this.emoteMenu.className = 'emote-menu';
    this.emoteMenu.hidden = true;
    this.emoteMenu.setAttribute('role', 'menu');
    for (const id of EMOTE_IDS) {
      const def = EMOTES[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.title = `${def.label} (/${def.command})`;
      b.append(
        Object.assign(document.createElement('span'), {
          className: 'emoji',
          textContent: def.emoji,
        }),
        Object.assign(document.createElement('span'), { textContent: def.label }),
      );
      b.addEventListener('click', () => {
        this.on.emote(id);
        this.toggleEmoteMenu(false);
        this.input.focus();
      });
      this.emoteMenu.append(b);
    }
    // Sorteios: o servidor tira o resultado e todos veem o mesmo.
    for (const [emoji, label, cmd] of [
      ['🎲', 'Dado', '/dado'],
      ['🪙', 'Moeda', '/moeda'],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.title = `${label} (${cmd})`;
      b.append(
        Object.assign(document.createElement('span'), { className: 'emoji', textContent: emoji }),
        Object.assign(document.createElement('span'), { textContent: label }),
      );
      b.addEventListener('click', () => {
        this.on.send(cmd);
        this.toggleEmoteMenu(false);
        this.input.focus();
      });
      this.emoteMenu.append(b);
    }

    this.input.className = 'chat-input';
    this.input.maxLength = CHAT_MAX_LENGTH;
    this.input.placeholder = 'Diga algo… (Enter envia, @ menciona, / emotes, /dado)';
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'Mensagem para a sala');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.suggestions.className = 'mention-suggestions';
    this.suggestions.setAttribute('role', 'listbox');
    this.suggestions.hidden = true;

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'btn-primary';
    send.textContent = 'Enviar';
    this.form.append(
      this.replyBar.el,
      this.emoteBtn,
      this.input,
      send,
      this.emoteMenu,
      this.suggestions,
    );

    this.history.className = 'chat-history';
    this.history.open = window.innerWidth > 900;
    this.log.className = 'chat-log';
    this.log.setAttribute('aria-live', 'polite');
    this.empty.className = 'muted chat-empty';
    this.empty.textContent = 'Ninguém falou nada ainda por aqui.';
    this.history.append(this.summary, this.empty, this.log);
    this.renderSummary();

    document.body.append(this.history, this.form);
    this.bindEvents();
  }

  /** Nomes de quem está na sala (menções) e o próprio nome (destaque). */
  setPeople(names: string[], localName: string): void {
    this.names = names;
    this.localName = localName;
  }

  /** Coloca `@Nome ` no campo e foca (ação "Mencionar" do cartão). */
  insertMention(name: string): void {
    const sep = this.input.value && !this.input.value.endsWith(' ') ? ' ' : '';
    this.input.value = `${this.input.value}${sep}@${name} `.slice(0, CHAT_MAX_LENGTH);
    this.input.focus();
  }

  setHistory(messages: readonly ChatMessage[], localUserId: string): void {
    this.localUserId = localUserId;
    this.log.replaceChildren(...messages.map((m) => this.item(m)));
    this.empty.hidden = messages.length > 0;
    this.unread = 0;
    this.renderSummary();
    this.scrollToEnd();
  }

  setAdmin(on: boolean): void {
    this.isAdmin = on;
  }

  /** Reações de uma mensagem mudaram. */
  updateReactions(id: number, reactions: ReactionSummary[]): void {
    const stick =
      this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < STICKY_SCROLL_PX;
    const li = this.log.querySelector(`li[data-id="${id}"]`);
    li?.querySelector('.reactions')?.replaceWith(this.chips(id, reactions));
    // Reação na última mensagem não pode ficar escondida embaixo da lista.
    if (stick) this.scrollToEnd();
  }

  /** Responder a uma mensagem: mostra a faixa e foca o campo. */
  replyTo(m: ChatMessage): void {
    this.replyBar.set({ id: m.id, userId: m.userId, name: m.name, text: replyPreviewText(m.text) });
    this.input.focus();
  }

  /** Mensagem apagada no servidor: some do histórico. */
  removeMessage(id: number): void {
    this.log.querySelector(`li[data-id="${id}"]`)?.remove();
    this.empty.hidden = this.log.children.length > 0;
  }

  add(message: ChatMessage): void {
    const stick =
      this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < STICKY_SCROLL_PX;
    this.log.append(this.item(message));
    this.empty.hidden = true;
    while (this.log.children.length > 200) this.log.firstElementChild?.remove();
    if (!this.history.open && message.userId !== this.localUserId) {
      this.unread++;
      this.renderSummary();
    }
    if (stick) this.scrollToEnd();
  }

  /** A mensagem cita a pessoa local? */
  mentionsMe(text: string): boolean {
    if (!this.localName) return false;
    const key = nameKey(this.localName);
    return findMentions(text, this.names).some((m) => nameKey(m.name) === key);
  }

  // ---------- Interno ----------

  private bindEvents(): void {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.suggestions.hidden && this.pickSuggestion()) return;
      const text = normalizeChatText(this.input.value);
      if (!text) return;
      const emote = parseEmoteCommand(text);
      if (emote) this.on.emote(emote);
      else this.on.send(text, this.replyBar.current?.id);
      this.replyBar.set(null);
      this.input.value = '';
      this.hideSuggestions();
      this.setTyping(false);
    });
    this.input.addEventListener('input', () => {
      this.updateSuggestions();
      const hasText = this.input.value.trim().length > 0 && !this.input.value.startsWith('/');
      this.setTyping(hasText);
    });
    this.input.addEventListener('keydown', (e) => {
      if (!this.suggestions.hidden) {
        const count = this.suggestions.children.length;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          this.suggestionIndex =
            (this.suggestionIndex + (e.key === 'ArrowDown' ? 1 : count - 1)) % count;
          this.renderSuggestionSelection();
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          this.pickSuggestion();
          return;
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          this.hideSuggestions();
          return;
        }
      }
      if (e.key === 'Escape' && this.replyBar.current) {
        this.replyBar.set(null);
        return;
      }
      if (e.key === 'Escape') this.input.blur();
    });
    this.input.addEventListener('blur', () => {
      this.setTyping(false);
      // Deixa o clique numa sugestão acontecer antes de esconder.
      setTimeout(() => this.hideSuggestions(), 150);
    });

    this.emoteBtn.addEventListener('click', () =>
      this.toggleEmoteMenu(Boolean(this.emoteMenu.hidden)),
    );
    document.addEventListener('pointerdown', (e) => {
      if (!this.emoteMenu.hidden && !this.form.contains(e.target as Node))
        this.toggleEmoteMenu(false);
    });

    this.history.addEventListener('toggle', () => {
      if (this.history.open) {
        this.unread = 0;
        this.renderSummary();
        this.scrollToEnd();
      }
    });
    // Enter em qualquer lugar (fora de campos e diálogos) começa a digitar.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, button, select, [role=dialog]')) return;
      if (document.querySelector('.modal-backdrop, .login-backdrop')) return;
      e.preventDefault();
      this.input.focus();
    });
  }

  private toggleEmoteMenu(open: boolean): void {
    this.emoteMenu.hidden = !open;
    this.emoteBtn.setAttribute('aria-expanded', String(open));
  }

  /** "Digitando": avisa ao começar, renova enquanto digita e desliga parado/ao enviar. */
  private setTyping(on: boolean): void {
    clearTimeout(this.typingTimer);
    const now = Date.now();
    if (on) {
      if (!this.typingOn || now - this.typingSentAt > TYPING_REFRESH_MS) {
        this.on.typing(true);
        this.typingSentAt = now;
      }
      this.typingOn = true;
      this.typingTimer = window.setTimeout(() => this.setTyping(false), TYPING_IDLE_MS);
    } else if (this.typingOn) {
      this.typingOn = false;
      this.on.typing(false);
    }
  }

  /** Palavra começando com @ logo antes do cursor. */
  private mentionQuery(): { start: number; query: string } | null {
    const caret = this.input.selectionStart ?? this.input.value.length;
    const before = this.input.value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,20})$/.exec(before);
    return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null;
  }

  private updateSuggestions(): void {
    const q = this.mentionQuery();
    if (!q) return this.hideSuggestions();
    const key = nameKey(q.query);
    const matches = this.names
      .filter((n) => n !== this.localName && nameKey(n).startsWith(key))
      .slice(0, MAX_SUGGESTIONS);
    if (matches.length === 0) return this.hideSuggestions();
    this.suggestions.replaceChildren(
      ...matches.map((name) => {
        const li = Object.assign(document.createElement('li'), { textContent: `@${name}` });
        li.setAttribute('role', 'option');
        li.dataset.name = name;
        li.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.applySuggestion(name);
        });
        return li;
      }),
    );
    this.suggestionIndex = 0;
    this.renderSuggestionSelection();
    this.suggestions.hidden = false;
  }

  private renderSuggestionSelection(): void {
    [...this.suggestions.children].forEach((li, i) =>
      li.setAttribute('aria-selected', String(i === this.suggestionIndex)),
    );
  }

  private pickSuggestion(): boolean {
    const li = this.suggestions.children[this.suggestionIndex] as HTMLElement | undefined;
    if (!li?.dataset.name) return false;
    this.applySuggestion(li.dataset.name);
    return true;
  }

  private applySuggestion(name: string): void {
    const q = this.mentionQuery();
    if (!q) return;
    const caret = this.input.selectionStart ?? this.input.value.length;
    const value = this.input.value;
    const inserted = `@${name} `;
    this.input.value = (value.slice(0, q.start) + inserted + value.slice(caret)).slice(
      0,
      CHAT_MAX_LENGTH,
    );
    const pos = q.start + inserted.length;
    this.input.setSelectionRange(pos, pos);
    this.hideSuggestions();
    this.input.focus();
  }

  private hideSuggestions(): void {
    this.suggestions.hidden = true;
  }

  private item(m: ChatMessage): HTMLLIElement {
    const li = document.createElement('li');
    if (m.userId === this.localUserId) li.classList.add('mine');
    // Resultado sorteado pelo servidor (dado, moeda, jogo): visual próprio, sem menção.
    if (m.kind !== 'text') li.classList.add('chat-roll');
    const forMe =
      m.kind === 'text' &&
      m.userId !== this.localUserId &&
      (this.mentionsMe(m.text) || m.replyTo?.userId === this.localUserId);
    if (forMe) li.classList.add('mentioned');
    li.dataset.id = String(m.id);
    if (m.replyTo) {
      const target = m.replyTo.id;
      li.append(
        replyQuote(m.replyTo, () =>
          flashMessage(this.log.querySelector(`li[data-id="${target}"]`)),
        ),
      );
    }
    const time = document.createElement('time');
    time.dateTime = new Date(m.ts).toISOString();
    time.textContent = timeFormat.format(m.ts);
    const name = document.createElement('strong');
    name.textContent = m.name;
    const body =
      m.kind === 'text' ? this.textWithMentions(m.text) : document.createTextNode(m.text);
    li.append(time, ' ', name, ' ', body, this.actions(m));
    li.append(this.chips(m.id, m.reactions));
    return li;
  }

  /** Botões que aparecem ao passar o mouse: responder, reagir e (se pode) apagar. */
  private actions(m: ChatMessage): HTMLSpanElement {
    const box = Object.assign(document.createElement('span'), { className: 'msg-actions' });
    const button = (text: string, label: string, onClick: (b: HTMLButtonElement) => void) => {
      const b = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'msg-action',
        textContent: text,
        title: label,
      });
      b.setAttribute('aria-label', `${label} (mensagem de ${m.name})`);
      b.addEventListener('click', () => onClick(b));
      return b;
    };
    box.append(
      button('↩', 'Responder', () => this.replyTo(m)),
      button('😊', 'Reagir', (b) => openReactionPicker(b, (emoji) => this.on.react(m.id, emoji))),
    );
    if (this.isAdmin || m.userId === this.localUserId) {
      const del = button('🗑', 'Apagar', async () => {
        const who = m.userId === this.localUserId ? 'sua mensagem' : `a mensagem de ${m.name}`;
        const yes = await confirmDialog(`Apagar ${who} para todos?`, {
          confirmLabel: 'Apagar',
          danger: true,
        });
        if (yes) this.on.remove(m.id);
      });
      del.classList.add('danger');
      box.append(del);
    }
    return box;
  }

  private chips(id: number, reactions: readonly ReactionSummary[]): HTMLDivElement {
    return reactionChips(reactions, this.localUserId, (emoji) => this.on.react(id, emoji));
  }

  /** Texto com as menções em destaque (só nós de texto e <mark>, nada de HTML do usuário). */
  private textWithMentions(text: string): HTMLSpanElement {
    const span = document.createElement('span');
    let last = 0;
    for (const m of findMentions(text, this.names)) {
      span.append(text.slice(last, m.start));
      const mark = document.createElement('mark');
      mark.className = 'mention';
      mark.textContent = text.slice(m.start, m.end);
      span.append(mark);
      last = m.end;
    }
    span.append(text.slice(last));
    return span;
  }

  private renderSummary(): void {
    this.summary.textContent =
      this.unread > 0 ? `Conversa (${this.unread} nova${this.unread > 1 ? 's' : ''})` : 'Conversa';
  }

  private scrollToEnd(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }
}
