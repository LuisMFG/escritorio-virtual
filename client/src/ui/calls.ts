import { CALL_REASON_MAX, CALL_REASONS, type CallInvite, type CallState } from '@office/shared';
import { icon, iconHtml } from './icons.js';

/** Caixa "Chamar para conversa": motivo (com sugestões) e Enviar. */
export function openCallInvite(
  target: { name: string },
  adding: boolean,
  send: (reason: string) => void,
): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const sheet = document.createElement('form');
  sheet.className = 'sheet call-invite';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'call-invite-title');
  sheet.innerHTML = `
    <header class="sheet-head">
      <h2 id="call-invite-title"></h2>
      <button type="button" class="sheet-close" aria-label="Fechar">${iconHtml('x')}</button>
    </header>
    <div class="sheet-body">
      <label class="field"><span>Motivo (aparece no convite)</span>
        <input name="reason" maxlength="${CALL_REASON_MAX}" placeholder="Ex.: dúvida no deploy" autocomplete="off" /></label>
      <div class="call-reasons" role="group" aria-label="Sugestões"></div>
      <button type="submit" class="btn-primary call-send">${iconHtml('phone', 16)} Chamar</button>
    </div>`;
  sheet.querySelector('h2')!.textContent = adding
    ? `Adicionar ${target.name} à chamada`
    : `Chamar ${target.name} para conversa`;
  const input = sheet.querySelector<HTMLInputElement>('input[name=reason]')!;
  const chips = sheet.querySelector('.call-reasons')!;
  for (const r of CALL_REASONS) {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'decor-chip',
      textContent: r,
    });
    b.addEventListener('click', () => {
      input.value = r;
      input.focus();
    });
    chips.append(b);
  }
  backdrop.append(sheet);
  document.body.append(backdrop);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  sheet.querySelector('.sheet-close')!.addEventListener('click', close);
  sheet.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value.trim());
    close();
  });
  input.focus();
}

/**
 * Convites recebidos (Fase 49): um cartão por convite, com quem chama, o motivo, quem já está
 * na conversa, o tempo que falta e Aceitar/Recusar.
 */
export class IncomingCalls {
  private readonly box = document.createElement('div');
  private readonly cards = new Map<string, { el: HTMLElement; timer: number }>();

  constructor(private readonly answer: (inviteId: string, accept: boolean) => void) {
    this.box.className = 'call-incoming';
    this.box.setAttribute('aria-live', 'assertive');
    document.body.append(this.box);
  }

  add(invite: CallInvite): void {
    this.remove(invite.id);
    const el = document.createElement('section');
    el.className = 'call-card';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', `${invite.fromName} está chamando você`);
    const head = document.createElement('div');
    head.className = 'call-card-head';
    head.append(
      icon('phone', 18),
      Object.assign(document.createElement('strong'), {
        textContent: `${invite.fromName} está chamando você`,
      }),
    );
    const reason = Object.assign(document.createElement('p'), {
      className: 'call-card-reason',
      textContent: invite.reason ? `“${invite.reason}”` : 'Sem motivo informado.',
    });
    const parts: Node[] = [head, reason];
    if (invite.members.length > 1) {
      parts.push(
        Object.assign(document.createElement('small'), {
          className: 'muted',
          textContent: `Na conversa: ${invite.members.join(', ')}`,
        }),
      );
    }
    const bar = Object.assign(document.createElement('div'), { className: 'call-card-time' });
    const fill = document.createElement('span');
    bar.append(fill);
    const actions = document.createElement('div');
    actions.className = 'call-card-actions';
    const decline = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-secondary',
      textContent: 'Recusar',
    });
    const accept = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-primary',
    });
    accept.append(icon('phone', 16), ' Aceitar');
    decline.addEventListener('click', () => this.respond(invite.id, false));
    accept.addEventListener('click', () => this.respond(invite.id, true));
    actions.append(decline, accept);
    parts.push(bar, actions);
    el.append(...parts);
    this.box.append(el);
    const total = Math.max(1, invite.expiresAt - Date.now());
    const tick = () => {
      const left = invite.expiresAt - Date.now();
      fill.style.width = `${Math.max(0, (left / total) * 100)}%`;
      if (left <= 0) this.remove(invite.id);
    };
    tick();
    this.cards.set(invite.id, { el, timer: window.setInterval(tick, 250) });
    accept.focus({ preventScroll: true });
  }

  remove(inviteId: string): void {
    const card = this.cards.get(inviteId);
    if (!card) return;
    clearInterval(card.timer);
    card.el.remove();
    this.cards.delete(inviteId);
  }

  private respond(inviteId: string, accept: boolean): void {
    this.answer(inviteId, accept);
    this.remove(inviteId);
  }
}

/** Painel da chamada: quem está, tempo, mudo e sair; anel em quem está falando. */
export class CallPanel {
  private readonly el = document.createElement('section');
  private timer = 0;
  private state: CallState | null = null;
  private speaking: ReadonlySet<string> = new Set();

  constructor(
    private readonly myUserId: string,
    private readonly on: { mute(muted: boolean): void; leave(): void; isMuted(): boolean },
  ) {
    this.el.className = 'call-panel';
    this.el.setAttribute('aria-label', 'Chamada');
    this.el.hidden = true;
    document.body.append(this.el);
  }

  set(state: CallState | null): void {
    this.state = state;
    clearInterval(this.timer);
    if (!state) {
      this.el.hidden = true;
      this.el.replaceChildren();
      return;
    }
    this.el.hidden = false;
    this.render();
    this.timer = window.setInterval(() => this.renderTime(), 1000);
  }

  setSpeaking(ids: ReadonlySet<string>): void {
    this.speaking = ids;
    for (const li of this.el.querySelectorAll<HTMLElement>('[data-user]')) {
      li.classList.toggle('speaking', ids.has(li.dataset.user!));
    }
  }

  private render(): void {
    const st = this.state!;
    const head = document.createElement('div');
    head.className = 'call-panel-head';
    head.append(
      icon('phone', 16),
      Object.assign(document.createElement('strong'), { textContent: 'Em chamada' }),
      Object.assign(document.createElement('span'), { className: 'call-time muted' }),
    );
    const list = document.createElement('ul');
    list.className = 'call-members';
    for (const m of st.members) {
      const li = document.createElement('li');
      li.dataset.user = m.userId;
      li.classList.toggle('speaking', this.speaking.has(m.userId));
      li.append(
        Object.assign(document.createElement('span'), {
          textContent: m.userId === this.myUserId ? `${m.name} (você)` : m.name,
        }),
      );
      if (!m.mic) li.append(icon('mic-off', 13));
      list.append(li);
    }
    const parts: Node[] = [head, list];
    if (!st.here) {
      parts.push(
        Object.assign(document.createElement('small'), {
          className: 'muted',
          textContent: 'O áudio está em outra aba.',
        }),
      );
    }
    const actions = document.createElement('div');
    actions.className = 'call-panel-actions';
    const muted = this.on.isMuted();
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = `btn-secondary call-mute${muted ? ' on' : ''}`;
    mute.append(icon(muted ? 'mic-off' : 'mic', 16), muted ? ' Ativar som' : ' Mudo');
    mute.setAttribute('aria-pressed', String(muted));
    mute.disabled = !st.here;
    mute.addEventListener('click', () => {
      this.on.mute(!this.on.isMuted());
      this.render();
    });
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'btn-primary btn-danger call-leave';
    leave.append(icon('phone-off', 16), ' Sair');
    leave.addEventListener('click', () => this.on.leave());
    actions.append(mute, leave);
    parts.push(actions);
    this.el.replaceChildren(...parts);
    this.renderTime();
  }

  private renderTime(): void {
    const st = this.state;
    const el = this.el.querySelector('.call-time');
    if (!st || !el) return;
    const s = Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
