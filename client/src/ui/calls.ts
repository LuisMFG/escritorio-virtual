import { CALL_REASON_MAX, CALL_REASONS, type CallInvite, type CallState } from '@office/shared';
import type { CallDevices } from '../net/CallManager.js';
import { mouthFor, spotlightOf, type CallFace, type Mouth } from './callFace.js';
import { makeDraggable, type Draggable } from './draggable.js';
import {
  exitFullscreen,
  fullscreenElement,
  isFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from './fullscreen.js';
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

/** O que o painel precisa da chamada (Fase 50: câmera, tela e dispositivos; depois, efeitos). */
export interface CallPanelHandlers {
  mute(muted: boolean): void;
  leave(): void;
  isMuted(): boolean;
  camera(on: boolean): Promise<boolean>;
  screen(on: boolean): Promise<boolean>;
  cameraOn(): boolean;
  screenOn(): boolean;
  devices(): Promise<CallDevices>;
  useMic(deviceId: string): Promise<void>;
  useCam(deviceId: string): Promise<void>;
  useSpeaker(deviceId: string): Promise<void>;
  /** Efeitos escolhidos (salvos para as próximas chamadas). */
  effects(): { blur: boolean; noise: boolean };
  setBlur(on: boolean): Promise<void>;
  setNoise(on: boolean): Promise<void>;
  /** O desfoque está de fato no vídeo agora. */
  blurActive(): boolean;
  /** Volume do meu microfone agora (0 a 1). */
  micLevel(): number;
  /** O vídeo que sai da minha câmera (prévia dos dispositivos). */
  cameraStream(): MediaStream | null;
  /** Rosto do avatar com esse visual (boca fechada e falando); `null` se não der para montar. */
  face(figure: string): Promise<CallFace | null>;
}

/** Vídeo no painel (câmera ou tela). */
export interface PanelVideo {
  stream: MediaStream;
  kind: 'cam' | 'screen';
}

/** Um quadro por pessoa: o vídeo dela ou, sem vídeo, o rosto do avatar. */
interface Tile {
  el: HTMLElement;
  video: HTMLVideoElement;
  face: HTMLImageElement;
  initial: HTMLElement;
  name: HTMLElement;
  icons: HTMLElement;
  tools: HTMLElement;
  pin: HTMLButtonElement;
  full: HTMLButtonElement;
  figure: string;
  mouth: Mouth;
}

const nameOrYou = (id: string, me: string, name: string) => (id === me ? 'Você' : name);

/** Botão só com ícone (o nome vai no rótulo e na dica). */
function iconButton(cls: string, onClick: () => void): HTMLButtonElement {
  const b = Object.assign(document.createElement('button'), {
    type: 'button',
    className: `icon-btn ${cls}`,
  });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function label(b: HTMLButtonElement, name: Parameters<typeof icon>[0], text: string): void {
  b.replaceChildren(icon(name, 16));
  b.setAttribute('aria-label', text);
  b.title = text;
}

/**
 * Painel da chamada: um quadro por pessoa (a câmera ou a tela dela; sem vídeo, o rosto do
 * avatar, com a boca acompanhando a voz), tempo, mudo, câmera, tela, dispositivos e sair.
 * Cada vídeo pode ser destacado na janela ou ir para a tela cheia; a chamada inteira também.
 * Minimizada, vira um mini-player num canto e a chamada continua igual.
 */
export class CallPanel {
  private readonly el = document.createElement('section');
  private readonly head = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly controls = document.createElement('div');
  private readonly fullBtn: HTMLButtonElement;
  private readonly expandBtn: HTMLButtonElement;
  private readonly minBtn: HTMLButtonElement;
  private readonly timeEl = Object.assign(document.createElement('span'), {
    className: 'call-time muted',
  });
  private readonly tiles = new Map<string, Tile>();
  private videos: ReadonlyMap<string, PanelVideo> = new Map();
  private timer = 0;
  private state: CallState | null = null;
  private speaking: ReadonlySet<string> = new Set();
  private levels: ReadonlyMap<string, number> = new Map();
  private tick = 0;
  private lastSpeaker: string | null = null;
  private expanded = false;
  /** Vídeo destacado na janela da chamada. */
  private pinned: string | null = null;
  private minimized = false;
  private readonly faces = new Map<string, CallFace | null>();
  private readonly mini: CallMini;
  private closeDevices: (() => void) | null = null;
  /** Arrastar pela barra de cima (posição salva para pequena e ampliada). */
  private readonly drag: Draggable;

  constructor(
    private readonly myUserId: string,
    private readonly on: CallPanelHandlers,
  ) {
    this.el.className = 'call-panel';
    this.el.setAttribute('aria-label', 'Chamada');
    this.el.hidden = true;
    this.head.className = 'call-panel-head';
    this.head.title = 'Arraste para mover (duplo clique volta ao lugar)';
    const grip = icon('grip', 14);
    grip.classList.add('drag-grip');
    this.fullBtn = iconButton('call-full', () => void toggleFullscreen(this.el));
    this.expandBtn = iconButton('call-expand', () => this.setExpanded(!this.expanded));
    this.minBtn = iconButton('call-minimize', () => void this.minimize());
    label(this.minBtn, 'pip', 'Minimizar chamada');
    this.head.append(
      grip,
      icon('phone', 16),
      Object.assign(document.createElement('strong'), { textContent: 'Em chamada' }),
      this.timeEl,
      this.fullBtn,
      this.expandBtn,
      this.minBtn,
    );
    this.grid.className = 'call-grid';
    this.controls.className = 'call-controls';
    this.el.append(this.head, this.grid, this.controls);
    document.body.append(this.el);
    this.drag = makeDraggable(this.el, {
      handle: '.call-panel-head',
      key: 'chamada',
      mode: () => (this.expanded ? 'ampliada' : 'pequena'),
    });
    this.mini = new CallMini({
      mute: () => {
        this.on.mute(!this.on.isMuted());
        this.refresh();
      },
      camera: async () => {
        await this.on.camera(!this.on.cameraOn());
        this.refresh();
      },
      leave: () => this.on.leave(),
      restore: () => this.restore(),
    });
    onFullscreenChange(() => this.renderHead());
    this.renderHead();
  }

  set(state: CallState | null): void {
    this.state = state;
    clearInterval(this.timer);
    if (!state) {
      this.el.hidden = true;
      this.mini.hide();
      this.minimized = false;
      this.pinned = null;
      this.closeDevices?.();
      if (fullscreenElement() && this.el.contains(fullscreenElement())) void exitFullscreen();
      for (const t of this.tiles.values()) t.video.srcObject = null;
      this.tiles.clear();
      this.grid.replaceChildren();
      this.controls.replaceChildren();
      this.setExpanded(false);
      return;
    }
    this.el.hidden = this.minimized;
    this.syncTiles();
    this.refresh();
    this.timer = window.setInterval(() => this.renderTime(), 1000);
  }

  setSpeaking(ids: ReadonlySet<string>): void {
    this.speaking = ids;
    const other = [...ids].find((id) => id !== this.myUserId);
    if (other) this.lastSpeaker = other;
    for (const [id, t] of this.tiles) t.el.classList.toggle('speaking', ids.has(id));
    this.updateMini();
  }

  /** Volume de cada um: mexe a boca dos avatares (quem está sem vídeo). */
  setLevels(levels: ReadonlyMap<string, number>): void {
    this.levels = levels;
    this.tick++;
    for (const [id, t] of this.tiles) this.applyMouth(id, t);
    this.updateMini();
  }

  /** Vídeos ativos: atualiza os quadros sem recriar quem já estava (o vídeo não pisca). */
  setVideos(videos: ReadonlyMap<string, PanelVideo>): void {
    this.videos = videos;
    if (this.state) this.syncTiles();
    this.renderHead();
    this.updateMini();
  }

  /** Redesenha os botões (mudo, câmera…) e o mini-player depois de uma mudança. */
  refresh(): void {
    if (!this.state) return;
    this.renderControls();
    this.renderHead();
    this.updateMini();
  }

  private member(id: string) {
    return this.state?.members.find((m) => m.userId === id);
  }

  private syncTiles(): void {
    const st = this.state;
    if (!st) return;
    const ids = new Set(st.members.map((m) => m.userId));
    for (const [id, t] of this.tiles) {
      if (ids.has(id)) continue;
      t.video.srcObject = null;
      t.el.remove();
      this.tiles.delete(id);
    }
    if (this.pinned && !this.videos.has(this.pinned)) this.pinned = null;
    for (const m of st.members) {
      const t = this.tiles.get(m.userId) ?? this.makeTile(m.userId);
      const v = this.videos.get(m.userId);
      const who = nameOrYou(m.userId, this.myUserId, m.name);
      t.el.classList.toggle('has-video', Boolean(v));
      t.el.classList.toggle('screen', v?.kind === 'screen');
      t.el.classList.toggle('mine', m.userId === this.myUserId);
      t.el.classList.toggle('speaking', this.speaking.has(m.userId));
      t.el.classList.toggle('pinned', this.pinned === m.userId);
      t.el.setAttribute('aria-label', who);
      if (v) {
        if (t.video.srcObject !== v.stream) {
          t.video.srcObject = v.stream;
          void t.video.play().catch(() => undefined);
        }
      } else if (t.video.srcObject) {
        t.video.srcObject = null;
      }
      t.video.hidden = !v;
      t.name.textContent = `${who}${v?.kind === 'screen' ? ' · tela' : ''}`;
      t.icons.replaceChildren();
      if (!m.mic) {
        const muted = icon('mic-off', 13);
        muted.classList.add('call-muted');
        muted.setAttribute('aria-label', 'sem microfone');
        t.icons.append(muted);
      }
      if (m.screen && v?.kind !== 'screen') t.icons.append(icon('screen-share', 13));
      t.tools.hidden = !v;
      const pinned = this.pinned === m.userId;
      label(t.pin, pinned ? 'minimize' : 'maximize', pinned ? 'Voltar à grade' : `Destacar ${who}`);
      label(
        t.full,
        isFullscreen(t.el) ? 'fullscreen-exit' : 'fullscreen',
        isFullscreen(t.el) ? 'Sair da tela cheia' : `Tela cheia: ${who}`,
      );
      if (t.figure !== m.figure) {
        t.figure = m.figure;
        void this.loadFace(m.figure);
      }
      t.initial.textContent = (m.name.trim()[0] ?? '?').toUpperCase();
      this.applyMouth(m.userId, t);
    }
    // Destacado primeiro, depois as telas, as câmeras e quem está sem vídeo.
    const rank = (id: string) =>
      id === this.pinned
        ? 0
        : this.videos.get(id)?.kind === 'screen'
          ? 1
          : this.videos.has(id)
            ? 2
            : 3;
    const order = st.members.map((m) => m.userId).sort((a, b) => rank(a) - rank(b));
    const current = [...this.grid.children].map((c) => (c as HTMLElement).dataset.user);
    if (order.join() !== current.join()) {
      this.grid.replaceChildren(...order.map((id) => this.tiles.get(id)!.el));
    }
    this.grid.classList.toggle('has-pin', Boolean(this.pinned));
    this.grid.classList.toggle(
      'has-screen',
      [...this.videos.values()].some((v) => v.kind === 'screen'),
    );
    this.grid.dataset.count = String(st.members.length);
    this.el.classList.toggle('with-video', this.videos.size > 0);
  }

  private makeTile(id: string): Tile {
    const el = document.createElement('figure');
    el.className = 'call-tile';
    el.dataset.user = id;
    el.dataset.mouth = 'closed';
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // o áudio vem pela conexão de áudio
    video.hidden = true;
    const faceBox = document.createElement('div');
    faceBox.className = 'call-face';
    const face = Object.assign(document.createElement('img'), { alt: '', draggable: false });
    face.hidden = true;
    const initial = Object.assign(document.createElement('span'), {
      className: 'call-face-initial',
    });
    faceBox.append(face, initial);
    const caption = document.createElement('figcaption');
    const name = document.createElement('span');
    const icons = Object.assign(document.createElement('span'), { className: 'call-tile-icons' });
    caption.append(name, icons);
    const tools = Object.assign(document.createElement('div'), { className: 'call-tile-tools' });
    const t: Tile = {
      el,
      video,
      face,
      initial,
      name,
      icons,
      tools,
      pin: iconButton('call-pin', () => this.togglePin(id)),
      full: iconButton('call-tile-full', () => void toggleFullscreen(el, video)),
      figure: '',
      mouth: 'closed',
    };
    tools.append(t.pin, t.full);
    el.append(video, faceBox, caption, tools);
    // Duplo clique num vídeo: destaca (ou volta à grade).
    el.addEventListener('dblclick', () => {
      if (this.videos.has(id)) this.togglePin(id);
    });
    this.tiles.set(id, t);
    return t;
  }

  private togglePin(id: string): void {
    this.pinned = this.pinned === id ? null : id;
    if (this.pinned) this.setExpanded(true);
    this.syncTiles();
  }

  private async loadFace(figure: string): Promise<void> {
    if (this.faces.has(figure)) return this.paintFaces();
    this.faces.set(figure, null);
    const face = await this.on.face(figure).catch(() => null);
    this.faces.set(figure, face);
    this.paintFaces();
  }

  private paintFaces(): void {
    for (const [id, t] of this.tiles) this.applyMouth(id, t, true);
    this.updateMini();
  }

  /** Boca do avatar conforme o volume (fecha no silêncio e no mudo). */
  private applyMouth(id: string, t: Tile, force = false): void {
    const muted = this.member(id)?.mic === false;
    const mouth = mouthFor(this.levels.get(id) ?? 0, this.tick, muted);
    if (!force && mouth === t.mouth && t.face.src) return;
    t.mouth = mouth;
    t.el.dataset.mouth = mouth;
    const face = this.faces.get(t.figure);
    t.face.hidden = !face;
    t.initial.hidden = Boolean(face);
    if (face && t.face.src !== face[mouth]) t.face.src = face[mouth];
  }

  private setExpanded(on: boolean): void {
    this.expanded = on;
    this.el.classList.toggle('expanded', on);
    this.drag?.refresh();
    this.renderHead();
  }

  /** Esconde a janela e mostra o mini-player; a chamada segue igual. */
  async minimize(): Promise<void> {
    const full = fullscreenElement();
    if (full && this.el.contains(full)) await exitFullscreen();
    this.closeDevices?.();
    this.minimized = true;
    this.el.hidden = true;
    this.mini.show();
    this.updateMini();
  }

  restore(): void {
    this.minimized = false;
    this.mini.hide();
    if (!this.state) return;
    this.el.hidden = false;
    this.drag.refresh();
    this.refresh();
  }

  private renderHead(): void {
    const full = isFullscreen(this.el);
    this.el.classList.toggle('is-full', full);
    label(
      this.fullBtn,
      full ? 'fullscreen-exit' : 'fullscreen',
      full ? 'Sair da tela cheia' : 'Chamada em tela cheia',
    );
    label(
      this.expandBtn,
      this.expanded ? 'minimize' : 'maximize',
      this.expanded ? 'Diminuir' : 'Ampliar',
    );
    this.expandBtn.hidden = full;
    for (const [id, t] of this.tiles) {
      const tileFull = isFullscreen(t.el);
      const who = nameOrYou(id, this.myUserId, this.member(id)?.name ?? '');
      label(
        t.full,
        tileFull ? 'fullscreen-exit' : 'fullscreen',
        tileFull ? 'Sair da tela cheia' : `Tela cheia: ${who}`,
      );
    }
  }

  private renderControls(): void {
    const st = this.state!;
    const parts: Node[] = [];
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
      text: string,
      pressed: boolean | null,
      onClick: () => void | Promise<void>,
    ) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn-secondary call-btn ${cls}${pressed ? ' on' : ''}`;
      b.append(
        icon(name, 16),
        Object.assign(document.createElement('span'), { textContent: text }),
      );
      b.title = text;
      b.setAttribute('aria-label', text);
      if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
      b.disabled = !st.here;
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.classList.add('busy');
        await onClick();
        this.refresh();
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
    btn('call-devices', 'settings', 'Dispositivos', null, () => {
      this.closeDevices?.();
      this.closeDevices = openCallDevices(this.on, () => {
        this.closeDevices = null;
        this.refresh();
      });
    });
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'btn-primary btn-danger call-leave';
    leave.append(icon('phone-off', 16), ' Sair');
    leave.setAttribute('aria-label', 'Sair da chamada');
    leave.addEventListener('click', () => this.on.leave());
    actions.append(leave);
    parts.push(actions);
    this.controls.replaceChildren(...parts);
    this.renderTime();
  }

  /** O mini-player mostra quem está falando (ou falou por último). */
  private updateMini(): void {
    const st = this.state;
    if (!this.minimized || !st) return;
    const id = spotlightOf(
      st.members.map((m) => m.userId),
      this.myUserId,
      this.speaking,
      this.lastSpeaker,
    );
    const m = id ? this.member(id) : undefined;
    if (!id || !m) return;
    this.mini.update({
      name: nameOrYou(id, this.myUserId, m.name),
      stream: this.videos.get(id)?.stream ?? null,
      mirror: id === this.myUserId && this.videos.get(id)?.kind === 'cam',
      face: this.faces.get(m.figure) ?? null,
      initial: (m.name.trim()[0] ?? '?').toUpperCase(),
      mouth: mouthFor(this.levels.get(id) ?? 0, this.tick, !m.mic),
      speaking: this.speaking.has(id),
      muted: this.on.isMuted(),
      camOn: this.on.cameraOn(),
      here: st.here,
    });
  }

  private renderTime(): void {
    const st = this.state;
    if (!st) return;
    const s = Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000));
    this.timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}

interface MiniInfo {
  name: string;
  stream: MediaStream | null;
  mirror: boolean;
  face: CallFace | null;
  initial: string;
  mouth: Mouth;
  speaking: boolean;
  muted: boolean;
  camOn: boolean;
  here: boolean;
}

/**
 * Chamada minimizada: um quadro pequeno num canto (dá para arrastar) com quem está falando e
 * os botões de mudo, câmera, sair e restaurar.
 */
class CallMini {
  private readonly el = document.createElement('section');
  private readonly stage = document.createElement('div');
  private readonly video = document.createElement('video');
  private readonly face = Object.assign(document.createElement('img'), {
    alt: '',
    draggable: false,
  });
  private readonly initial = Object.assign(document.createElement('span'), {
    className: 'call-face-initial',
  });
  private readonly name = Object.assign(document.createElement('strong'), {
    className: 'call-mini-name',
  });
  private readonly muteBtn: HTMLButtonElement;
  private readonly camBtn: HTMLButtonElement;
  private readonly drag: Draggable;

  constructor(on: { mute(): void; camera(): Promise<void>; leave(): void; restore(): void }) {
    this.el.className = 'call-mini';
    this.el.setAttribute('aria-label', 'Chamada minimizada');
    this.el.hidden = true;
    this.stage.className = 'call-mini-stage';
    this.stage.title = 'Arraste para mover (duplo clique volta ao canto)';
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.hidden = true;
    const faceBox = Object.assign(document.createElement('div'), { className: 'call-face' });
    faceBox.append(this.face, this.initial);
    this.stage.append(this.video, faceBox, this.name);
    const bar = Object.assign(document.createElement('div'), { className: 'call-mini-actions' });
    this.muteBtn = iconButton('call-mini-mute', () => on.mute());
    this.camBtn = iconButton('call-mini-cam', () => {
      this.camBtn.disabled = true;
      void on.camera().finally(() => (this.camBtn.disabled = false));
    });
    const leave = iconButton('call-mini-leave', () => on.leave());
    label(leave, 'phone-off', 'Sair da chamada');
    const restore = iconButton('call-mini-restore', () => on.restore());
    label(restore, 'maximize', 'Restaurar chamada');
    bar.append(this.muteBtn, this.camBtn, leave, restore);
    this.el.append(this.stage, bar);
    document.body.append(this.el);
    this.drag = makeDraggable(this.el, {
      handle: '.call-mini-stage',
      key: 'chamada-mini',
      mode: () => 'mini',
    });
  }

  show(): void {
    this.el.hidden = false;
    this.drag.refresh();
  }

  hide(): void {
    this.el.hidden = true;
    this.video.srcObject = null;
  }

  update(info: MiniInfo): void {
    if (this.el.hidden) return;
    if (this.video.srcObject !== info.stream) {
      this.video.srcObject = info.stream;
      if (info.stream) void this.video.play().catch(() => undefined);
    }
    this.video.hidden = !info.stream;
    this.video.classList.toggle('mirror', info.mirror);
    this.face.hidden = Boolean(info.stream) || !info.face;
    this.initial.hidden = Boolean(info.stream) || Boolean(info.face);
    this.initial.textContent = info.initial;
    if (info.face && this.face.src !== info.face[info.mouth]) this.face.src = info.face[info.mouth];
    this.el.dataset.mouth = info.mouth;
    this.name.textContent = info.name;
    this.el.classList.toggle('speaking', info.speaking);
    label(this.muteBtn, info.muted ? 'mic-off' : 'mic', info.muted ? 'Ativar som' : 'Mudo');
    this.muteBtn.classList.toggle('on', info.muted);
    label(
      this.camBtn,
      info.camOn ? 'video' : 'video-off',
      info.camOn ? 'Desligar câmera' : 'Câmera',
    );
    this.camBtn.classList.toggle('on', info.camOn);
    this.muteBtn.disabled = !info.here;
    if (!info.here) this.camBtn.disabled = true;
  }
}

/**
 * Dispositivos e efeitos: microfone (com medidor de volume), câmera (com prévia), saída de
 * áudio, desfoque de fundo e supressão de ruído. Cada troca vale na hora, sem cair a chamada.
 * Devolve como fechar.
 */
function openCallDevices(on: CallPanelHandlers, closed: () => void): () => void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop call-devices-backdrop';
  const sheet = document.createElement('section');
  sheet.className = 'sheet call-devices-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'call-devices-title');
  sheet.innerHTML = `
    <header class="sheet-head">
      <h2 id="call-devices-title">Dispositivos e efeitos</h2>
      <button type="button" class="sheet-close" aria-label="Fechar">${iconHtml('x')}</button>
    </header>
    <div class="sheet-body">
      <label class="field"><span>Microfone</span><select id="call-dev-mic"></select></label>
      <div class="call-meter" role="meter" aria-label="Volume do microfone" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
      <label class="field"><span>Câmera</span><select id="call-dev-cam"></select></label>
      <div class="call-preview"><video muted playsinline autoplay></video><small class="muted"></small></div>
      <label class="field call-dev-speaker"><span>Saída de áudio</span><select id="call-dev-speaker"></select></label>
      <small class="muted call-dev-speaker-note" hidden>Este navegador não deixa escolher a saída aqui: use a do sistema.</small>
      <fieldset class="call-effects">
        <legend>Efeitos (ficam salvos para as próximas chamadas)</legend>
        <label class="check"><input type="checkbox" id="call-fx-blur" /> Desfocar o fundo (modo retrato)</label>
        <label class="check"><input type="checkbox" id="call-fx-noise" /> Supressão de ruído no microfone</label>
        <small class="muted call-fx-note" role="status"></small>
      </fieldset>
    </div>`;
  backdrop.append(sheet);
  // Com a chamada em tela cheia, só o que está dentro dela aparece.
  (document.fullscreenElement ?? document.body).append(backdrop);
  const $ = <T extends Element>(sel: string) => sheet.querySelector<T>(sel)!;
  const micSel = $<HTMLSelectElement>('#call-dev-mic');
  const camSel = $<HTMLSelectElement>('#call-dev-cam');
  const spkSel = $<HTMLSelectElement>('#call-dev-speaker');
  const meter = $<HTMLElement>('.call-meter');
  const preview = $<HTMLVideoElement>('.call-preview video');
  const previewNote = $<HTMLElement>('.call-preview small');
  const blurBox = $<HTMLInputElement>('#call-fx-blur');
  const noiseBox = $<HTMLInputElement>('#call-fx-noise');
  const fxNote = $<HTMLElement>('.call-fx-note');
  /** Prévia com a câmera desligada: um fluxo só para a janela, fechado ao sair. */
  let own: MediaStream | null = null;
  let closedNow = false;

  const fill = (
    sel: HTMLSelectElement,
    list: MediaDeviceInfo[],
    current: string | undefined,
    kind: string,
  ) => {
    sel.replaceChildren(
      ...list.map((d, i) => new Option(d.label || `${kind} ${i + 1}`, d.deviceId)),
    );
    if (current && list.some((d) => d.deviceId === current)) sel.value = current;
    sel.disabled = list.length === 0;
  };
  const stopOwn = () => {
    for (const t of own?.getTracks() ?? []) t.stop();
    own = null;
  };
  const showPreview = async () => {
    const live = on.cameraStream();
    if (live) {
      stopOwn();
      preview.srcObject = live;
      previewNote.textContent = on.blurActive()
        ? 'Sua câmera agora (com o fundo desfocado).'
        : 'Sua câmera agora.';
    } else if (camSel.value) {
      stopOwn();
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: camSel.value } },
        });
        if (closedNow) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        own = s;
        preview.srcObject = s;
        previewNote.textContent = 'Prévia: a câmera está desligada na chamada.';
      } catch {
        preview.srcObject = null;
        previewNote.textContent = 'Não deu para abrir essa câmera.';
      }
    } else {
      preview.srcObject = null;
      previewNote.textContent = 'Nenhuma câmera encontrada.';
    }
    preview.classList.toggle('mirror', true);
    void preview.play().catch(() => undefined);
  };
  const load = async () => {
    const d = await on.devices();
    fill(micSel, d.mics, d.mic, 'Microfone');
    fill(camSel, d.cams, d.cam, 'Câmera');
    fill(spkSel, d.speakers, d.speaker, 'Saída');
    $<HTMLElement>('.call-dev-speaker').hidden = !d.canPickSpeaker || d.speakers.length === 0;
    $<HTMLElement>('.call-dev-speaker-note').hidden = d.canPickSpeaker && d.speakers.length > 0;
    const fx = on.effects();
    blurBox.checked = fx.blur;
    noiseBox.checked = fx.noise;
    await showPreview();
  };
  const busy = async (el: HTMLInputElement | HTMLSelectElement, run: () => Promise<void>) => {
    el.disabled = true;
    try {
      await run();
    } finally {
      el.disabled = false;
    }
  };
  micSel.addEventListener('change', () => void busy(micSel, () => on.useMic(micSel.value)));
  camSel.addEventListener(
    'change',
    () =>
      void busy(camSel, async () => {
        await on.useCam(camSel.value);
        await showPreview();
      }),
  );
  spkSel.addEventListener('change', () => void busy(spkSel, () => on.useSpeaker(spkSel.value)));
  blurBox.addEventListener(
    'change',
    () =>
      void busy(blurBox, async () => {
        fxNote.textContent = blurBox.checked && on.cameraOn() ? 'Ligando o desfoque…' : '';
        await on.setBlur(blurBox.checked);
        fxNote.textContent =
          blurBox.checked && on.cameraOn() && !on.blurActive()
            ? 'O desfoque não funcionou neste navegador.'
            : blurBox.checked && !on.cameraOn()
              ? 'O fundo vai desfocado quando você ligar a câmera.'
              : '';
        await showPreview();
      }),
  );
  noiseBox.addEventListener(
    'change',
    () => void busy(noiseBox, () => on.setNoise(noiseBox.checked)),
  );

  // Medidor de volume do microfone em uso.
  const meterFill = meter.querySelector('span')!;
  const meterTimer = window.setInterval(() => {
    const pct = Math.min(100, Math.round(Math.sqrt(on.micLevel()) * 220));
    meterFill.style.width = `${pct}%`;
    meter.setAttribute('aria-valuenow', String(pct));
  }, 100);

  const close = () => {
    if (closedNow) return;
    closedNow = true;
    clearInterval(meterTimer);
    stopOwn();
    preview.srcObject = null;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    closed();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  $('.sheet-close').addEventListener('click', close);
  void load();
  micSel.focus();
  return close;
}
