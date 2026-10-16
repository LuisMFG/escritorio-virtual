import { CHAT_MAX_LENGTH, normalizeChatText, type ChatMessage } from '@office/shared';

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
/** Distância (px) do fim da lista dentro da qual o histórico continua rolando sozinho. */
const STICKY_SCROLL_PX = 40;

/**
 * Campo de mensagem fixo embaixo e histórico recolhível na lateral. Todo texto vindo de
 * usuários entra via `textContent` (nunca `innerHTML`), então HTML aparece como texto.
 */
export class ChatPanel {
  private readonly form = document.createElement('form');
  private readonly input = document.createElement('input');
  private readonly history = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly log = document.createElement('ol');
  private readonly empty = document.createElement('p');
  private localUserId = '';
  private unread = 0;

  constructor(private readonly onSend: (text: string) => void) {
    this.form.className = 'chat-bar';
    this.form.setAttribute('aria-label', 'Enviar mensagem');
    this.input.className = 'chat-input';
    this.input.maxLength = CHAT_MAX_LENGTH;
    this.input.placeholder = 'Diga algo… (Enter para enviar)';
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'Mensagem para a sala');
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'btn-primary';
    send.textContent = 'Enviar';
    this.form.append(this.input, send);

    this.history.className = 'chat-history';
    this.history.open = window.innerWidth > 900;
    this.log.className = 'chat-log';
    this.log.setAttribute('aria-live', 'polite');
    this.empty.className = 'muted chat-empty';
    this.empty.textContent = 'Ninguém falou nada ainda por aqui.';
    this.history.append(this.summary, this.empty, this.log);
    this.renderSummary();

    document.body.append(this.history, this.form);

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = normalizeChatText(this.input.value);
      if (!text) return;
      this.onSend(text);
      this.input.value = '';
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.input.blur();
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

  setHistory(messages: readonly ChatMessage[], localUserId: string): void {
    this.localUserId = localUserId;
    this.log.replaceChildren(...messages.map((m) => this.item(m)));
    this.empty.hidden = messages.length > 0;
    this.unread = 0;
    this.renderSummary();
    this.scrollToEnd();
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

  private item(m: ChatMessage): HTMLLIElement {
    const li = document.createElement('li');
    if (m.userId === this.localUserId) li.classList.add('mine');
    const time = document.createElement('time');
    time.dateTime = new Date(m.ts).toISOString();
    time.textContent = timeFormat.format(m.ts);
    const name = document.createElement('strong');
    name.textContent = m.name;
    const text = document.createElement('span');
    text.textContent = m.text;
    li.append(time, ' ', name, ' ', text);
    return li;
  }

  private renderSummary(): void {
    this.summary.textContent =
      this.unread > 0 ? `Conversa (${this.unread} nova${this.unread > 1 ? 's' : ''})` : 'Conversa';
  }

  private scrollToEnd(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }
}
