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

/** O que o painel precisa da chamada (Fase 50: câmera, tela e dispositivos). */
export interface CallPanelHandlers {
  mute(muted: boolean): void;
  leave(): void;
  isMuted(): boolean;
  camera(on: boolean): Promise<boolean>;
  screen(on: boolean): Promise<boolean>;
  cameraOn(): boolean;
  screenOn(): boolean;
  devices(): Promise<{
    mics: MediaDeviceInfo[];
    cams: MediaDeviceInfo[];
    mic?: string;
    cam?: string;
  }>;
  useMic(deviceId: string): Promise<void>;
  useCam(deviceId: string): Promise<void>;
}

/** Vídeo no painel (câmera ou tela). */
export interface PanelVideo {
  stream: MediaStream;
  kind: 'cam' | 'screen';
}

/**
 * Painel da chamada: quem está, tempo, mudo, câmera, tela, dispositivos e sair; anel em quem
 * está falando. Com vídeo, mostra a grade (a tela compartilhada em destaque) e dá para ampliar.
 */
export class CallPanel {
  private readonly el = document.createElement('section');
  private readonly main = document.createElement('div');
  private readonly videosBox = document.createElement('div');
  private readonly tiles = new Map<string, { el: HTMLElement; video: HTMLVideoElement }>();
  private videos: ReadonlyMap<string, PanelVideo> = new Map();
  private timer = 0;
  private state: CallState | null = null;
  private speaking: ReadonlySet<string> = new Set();
  private expanded = false;

  constructor(
    private readonly myUserId: string,
    private readonly on: CallPanelHandlers,
  ) {
    this.el.className = 'call-panel';
    this.el.setAttribute('aria-label', 'Chamada');
    this.el.hidden = true;
    this.videosBox.className = 'call-videos';
    this.videosBox.hidden = true;
    this.el.append(this.videosBox, this.main);
    document.body.append(this.el);
  }

  set(state: CallState | null): void {
    this.state = state;
    clearInterval(this.timer);
    if (!state) {
      this.el.hidden = true;
      this.main.replaceChildren();
      this.setExpanded(false);
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

  /** Vídeos ativos: atualiza a grade sem recriar quem já estava (o vídeo não pisca). */
  setVideos(videos: ReadonlyMap<string, PanelVideo>): void {
    this.videos = videos;
    for (const [id, t] of this.tiles) {
      if (!videos.has(id)) {
        t.video.srcObject = null;
        t.el.remove();
        this.tiles.delete(id);
      }
    }
    const nameOf = (id: string) => this.state?.members.find((m) => m.userId === id)?.name ?? '';
    for (const [id, v] of videos) {
      let t = this.tiles.get(id);
      if (!t) {
        const el = document.createElement('figure');
        el.className = 'call-tile';
        el.dataset.user = id;
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true; // o áudio vem pela conexão de áudio
        el.append(video, document.createElement('figcaption'));
        el.addEventListener('dblclick', () => this.setExpanded(!this.expanded));
        t = { el, video };
        this.tiles.set(id, t);
      }
      if (t.video.srcObject !== v.stream) {
        t.video.srcObject = v.stream;
        void t.video.play().catch(() => undefined);
      }
      t.el.classList.toggle('screen', v.kind === 'screen');
      t.el.classList.toggle('mine', id === this.myUserId);
      t.el.classList.toggle('speaking', this.speaking.has(id));
      t.el.querySelector('figcaption')!.textContent =
        `${id === this.myUserId ? 'Você' : nameOf(id)}${v.kind === 'screen' ? ' · tela' : ''}`;
    }
    // Tela compartilhada primeiro (em destaque), depois as câmeras.
    const order = [...this.tiles].sort(
      ([, a], [, b]) =>
        Number(b.el.classList.contains('screen')) - Number(a.el.classList.contains('screen')),
    );
    this.videosBox.replaceChildren(...order.map(([, t]) => t.el));
    this.videosBox.hidden = this.tiles.size === 0;
    this.videosBox.classList.toggle(
      'has-screen',
      [...videos.values()].some((v) => v.kind === 'screen'),
    );
    this.el.classList.toggle('with-video', this.tiles.size > 0);
    if (this.state) this.render();
  }

  private setExpanded(on: boolean): void {
    this.expanded = on;
    this.el.classList.toggle('expanded', on);
    const b = this.el.querySelector<HTMLButtonElement>('.call-expand');
    if (b) {
      b.replaceChildren(icon(on ? 'minimize' : 'maximize', 16));
      b.setAttribute('aria-label', on ? 'Diminuir' : 'Ampliar');
      b.title = on ? 'Diminuir' : 'Ampliar';
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
    if (this.tiles.size) {
      const expand = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'call-expand icon-btn',
      });
      expand.addEventListener('click', () => this.setExpanded(!this.expanded));
      head.append(expand);
    }
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
      if (m.cam) li.append(icon('video', 13));
      if (m.screen) li.append(icon('screen-share', 13));
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
    const btn = (
      cls: string,
      name: Parameters<typeof icon>[0],
      label: string,
      pressed: boolean | null,
      onClick: () => void | Promise<void>,
    ) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn-secondary call-btn ${cls}${pressed ? ' on' : ''}`;
      b.append(
        icon(name, 16),
        Object.assign(document.createElement('span'), { textContent: label }),
      );
      b.title = label;
      b.setAttribute('aria-label', label);
      if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
      b.disabled = !st.here;
      b.addEventListener('click', async () => {
        b.disabled = true;
        await onClick();
        this.render();
      });
      actions.append(b);
      return b;
    };
    const muted = this.on.isMuted();
    btn('call-mute', muted ? 'mic-off' : 'mic', muted ? 'Ativar som' : 'Mudo', muted, () =>
      this.on.mute(!muted),
    );
    const cam = this.on.cameraOn();
    btn(
      'call-cam',
      cam ? 'video' : 'video-off',
      cam ? 'Desligar câmera' : 'Câmera',
      cam,
      async () => {
        await this.on.camera(!cam);
      },
    );
    const screen = this.on.screenOn();
    btn('call-screen', 'screen-share', screen ? 'Parar tela' : 'Tela', screen, async () => {
      await this.on.screen(!screen);
    });
    btn('call-devices', 'settings', 'Dispositivos', null, () => this.openDevices());
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'btn-primary btn-danger call-leave';
    leave.append(icon('phone-off', 16), ' Sair');
    leave.addEventListener('click', () => this.on.leave());
    actions.append(leave);
    parts.push(actions);
    this.main.replaceChildren(...parts);
    this.setExpanded(this.expanded);
    this.renderTime();
  }

  /** Escolher microfone e câmera (os nomes só aparecem depois de dar permissão). */
  private async openDevices(): Promise<void> {
    this.main.querySelector('.call-devices-box')?.remove();
    const box = document.createElement('div');
    box.className = 'call-devices-box';
    const { mics, cams, mic, cam } = await this.on.devices();
    const select = (
      label: string,
      list: MediaDeviceInfo[],
      current: string | undefined,
      use: (id: string) => Promise<void>,
    ) => {
      const wrap = Object.assign(document.createElement('label'), { className: 'field' });
      const sel = document.createElement('select');
      list.forEach((d, i) => sel.append(new Option(d.label || `${label} ${i + 1}`, d.deviceId)));
      if (current) sel.value = current;
      sel.disabled = list.length === 0;
      sel.addEventListener('change', () => void use(sel.value));
      wrap.append(Object.assign(document.createElement('span'), { textContent: label }), sel);
      return wrap;
    };
    box.append(
      select('Microfone', mics, mic, (id) => this.on.useMic(id)),
      select('Câmera', cams, cam, (id) => this.on.useCam(id)),
    );
    this.main.append(box);
  }

  private renderTime(): void {
    const st = this.state;
    const el = this.main.querySelector('.call-time');
    if (!st || !el) return;
    const s = Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
