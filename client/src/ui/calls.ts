import { CALL_REASON_MAX, CALL_REASONS, type CallInvite, type CallState } from '@office/shared';
import type {
  CallDevices,
  CallVideo,
  LinkQuality,
  VideoRef,
  VideoStat,
} from '../net/CallManager.js';
import type { CallQuality, ScreenMode } from '../net/callPrefs.js';
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
  targetDoc: Document = document,
): void {
  const doc = targetDoc;
  const backdrop = doc.createElement('div');
  backdrop.className = 'modal-backdrop';
  const sheet = doc.createElement('form');
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
    const b = Object.assign(doc.createElement('button'), {
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
  doc.body.append(backdrop);
  const close = () => {
    backdrop.remove();
    doc.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  doc.addEventListener('keydown', onKey);
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
  /** Liga (no modo escolhido) ou desliga a tela; ligada, troca o modo sem pedir a tela de novo. */
  screen(on: boolean, mode?: ScreenMode): Promise<boolean>;
  cameraOn(): boolean;
  screenOn(): boolean;
  screenMode(): ScreenMode;
  devices(): Promise<CallDevices>;
  useMic(deviceId: string): Promise<void>;
  useCam(deviceId: string): Promise<void>;
  useSpeaker(deviceId: string): Promise<void>;
  /** Efeitos escolhidos (salvos para as próximas chamadas). */
  effects(): { blur: boolean; noise: boolean };
  setBlur(on: boolean): Promise<void>;
  setNoise(on: boolean): Promise<void>;
  /** Qualidade do vídeo (automática, alta, economia), salva para as próximas. */
  quality(): CallQuality;
  setQuality(q: CallQuality): Promise<void>;
  /** O desfoque está de fato no vídeo agora. */
  blurActive(): boolean;
  /** Volume do meu microfone agora (0 a 1). */
  micLevel(): number;
  /** O vídeo que sai da minha câmera (prévia dos dispositivos). */
  cameraStream(): MediaStream | null;
  /** Resolução, fps, bitrate e atraso de cada vídeo (painel de detalhes). */
  stats(): Promise<VideoStat[]>;
  /** Rosto do avatar com esse visual (boca fechada e falando); `null` se não der para montar. */
  face(figure: string): Promise<CallFace | null>;
  /** A minha internet ficou fraca com a janela minimizada (o aviso vai como notificação). */
  weakLink(): void;
}

/** Conexão ruim por esse tempo (ms) antes de avisar (piscadas curtas não contam). */
const WEAK_AFTER_MS = 4000;
/** Boa de novo por esse tempo (ms) antes de tirar o aviso. */
const WEAK_CLEAR_MS = 8000;
/** Fechou o aviso: não volta por esse tempo (ms). */
const WEAK_SNOOZE_MS = 3 * 60_000;

/** Vídeos de uma pessoa no painel (câmera e/ou tela). */
export type PanelVideo = CallVideo;

/**
 * Um quadro por pessoa: o vídeo dela (com câmera e tela juntas, a tela em destaque e a câmera
 * numa miniatura que dá para mover, esconder ou trocar de lugar) ou, sem vídeo, o rosto do avatar.
 */
interface Tile {
  el: HTMLElement;
  video: HTMLVideoElement;
  /** Vídeo ligado em cada elemento agora (para não religar). */
  mainRef: VideoRef | null;
  pip: HTMLElement;
  pipVideo: HTMLVideoElement;
  pipRef: VideoRef | null;
  pipSwap: HTMLButtonElement;
  pipFull: HTMLButtonElement;
  pipHide: HTMLButtonElement;
  face: HTMLImageElement;
  initial: HTMLElement;
  name: HTMLElement;
  icons: HTMLElement;
  link: HTMLElement;
  tools: HTMLElement;
  pin: HTMLButtonElement;
  full: HTMLButtonElement;
  showPip: HTMLButtonElement;
  figure: string;
  mouth: Mouth;
}

const nameOrYou = (id: string, me: string, name: string) => (id === me ? 'Você' : name);

const LINK_TEXT: Record<LinkQuality, string> = {
  bom: 'Conexão boa',
  medio: 'Conexão média',
  ruim: 'Conexão ruim',
};

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

/** Liga um vídeo num elemento (desligando o anterior); `null` desliga. */
function bind(
  el: HTMLVideoElement,
  current: VideoRef | null,
  next: VideoRef | null,
): VideoRef | null {
  if (current?.id === next?.id) return current;
  current?.detach(el);
  if (!next) el.srcObject = null;
  next?.attach(el);
  return next;
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
  private readonly statsBtn: HTMLButtonElement;
  private readonly timeEl = Object.assign(document.createElement('span'), {
    className: 'call-time muted',
  });
  private readonly tiles = new Map<string, Tile>();
  /** Aviso de que a minha internet está fraca (entre o topo e os quadros). */
  private readonly weak = document.createElement('div');
  private weakTimer = 0;
  private weakSnoozedUntil = 0;
  private videos: ReadonlyMap<string, PanelVideo> = new Map();
  private links: ReadonlyMap<string, LinkQuality> = new Map();
  private timer = 0;
  private state: CallState | null = null;
  private speaking: ReadonlySet<string> = new Set();
  private levels: ReadonlyMap<string, number> = new Map();
  private tick = 0;
  private lastSpeaker: string | null = null;
  private expanded = false;
  /** Vídeo destacado na janela da chamada. */
  private pinned: string | null = null;
  /** Quem está com a câmera em destaque e a tela na miniatura (trocou). */
  private readonly swapped = new Set<string>();
  /** Quem está com a miniatura escondida. */
  private readonly pipHidden = new Set<string>();
  private minimized = false;
  private readonly faces = new Map<string, CallFace | null>();
  private readonly mini: CallMini;
  private closeDevices: (() => void) | null = null;
  private closeStats: (() => void) | null = null;
  private closeShare: (() => void) | null = null;
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
    this.statsBtn = iconButton('call-stats-btn', () => this.toggleStats());
    label(this.statsBtn, 'activity', 'Detalhes da conexão');
    this.fullBtn = iconButton('call-full', () => void toggleFullscreen(this.el));
    this.expandBtn = iconButton('call-expand', () => this.setExpanded(!this.expanded));
    this.minBtn = iconButton('call-minimize', () => void this.minimize());
    label(this.minBtn, 'pip', 'Minimizar chamada');
    this.head.append(
      grip,
      icon('phone', 16),
      Object.assign(document.createElement('strong'), { textContent: 'Em chamada' }),
      this.timeEl,
      this.statsBtn,
      this.fullBtn,
      this.expandBtn,
      this.minBtn,
    );
    this.grid.className = 'call-grid';
    this.controls.className = 'call-controls';
    this.buildWeak();
    this.el.append(this.head, this.weak, this.grid, this.controls);
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
      this.swapped.clear();
      this.pipHidden.clear();
      this.closeDevices?.();
      this.closeStats?.();
      this.closeShare?.();
      if (fullscreenElement() && this.el.contains(fullscreenElement())) void exitFullscreen();
      for (const t of this.tiles.values()) {
        t.mainRef = bind(t.video, t.mainRef, null);
        t.pipRef = bind(t.pipVideo, t.pipRef, null);
      }
      this.tiles.clear();
      clearTimeout(this.weakTimer);
      this.weak.hidden = true;
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

  /** Elemento do painel da chamada para exibição na janela flutuante (Document PiP). */
  get element(): HTMLElement {
    return this.el;
  }

  /** Elemento do mini-player para exibição na janela flutuante (Document PiP). */
  get miniElement(): HTMLElement {
    return this.mini.element;
  }

  /** Qualidade da conexão de cada um (o pontinho no canto do quadro). */
  setLinks(links: ReadonlyMap<string, LinkQuality>): void {
    const wasWeak = this.links.get(this.myUserId) === 'ruim';
    this.links = links;
    for (const [id, t] of this.tiles) this.paintLink(id, t);
    const weak = links.get(this.myUserId) === 'ruim';
    if (weak === wasWeak) return;
    // Só avisa (ou tira o aviso) se a mudança durar: a qualidade oscila.
    clearTimeout(this.weakTimer);
    this.weakTimer = window.setTimeout(
      () => this.setWeak(weak),
      weak ? WEAK_AFTER_MS : WEAK_CLEAR_MS,
    );
  }

  private buildWeak(): void {
    this.weak.className = 'call-weak';
    this.weak.setAttribute('role', 'status');
    this.weak.hidden = true;
    const text = Object.assign(document.createElement('p'), {
      textContent:
        'Sua internet está fraca: os outros podem ver e ouvir você com falhas. Feche downloads e vídeos ou chegue mais perto do Wi-Fi.',
    });
    const economy = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-secondary call-weak-economy',
      textContent: 'Usar Economia',
    });
    economy.addEventListener('click', () => {
      void this.on.setQuality('economia');
      this.weak.hidden = true;
    });
    const close = iconButton('call-weak-close', () => {
      this.weak.hidden = true;
      this.weakSnoozedUntil = Date.now() + WEAK_SNOOZE_MS;
    });
    label(close, 'x', 'Fechar aviso de internet fraca');
    this.weak.append(icon('wifi-off', 16), text, economy, close);
  }

  private setWeak(on: boolean): void {
    if (!this.state) return;
    if (!on) {
      this.weak.hidden = true;
      return;
    }
    if (Date.now() < this.weakSnoozedUntil || !this.weak.hidden) return;
    const economy = this.weak.querySelector<HTMLButtonElement>('.call-weak-economy')!;
    economy.hidden = this.on.quality() === 'economia';
    this.weak.hidden = false;
    if (this.minimized) this.on.weakLink();
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

  /** O que vai em destaque no quadro e o que vai na miniatura. */
  private layout(id: string): { main: VideoRef | null; pip: VideoRef | null } {
    const v = this.videos.get(id);
    if (!v) return { main: null, pip: null };
    if (v.screen && v.cam) {
      return this.swapped.has(id) ? { main: v.cam, pip: v.screen } : { main: v.screen, pip: v.cam };
    }
    return { main: v.screen ?? v.cam ?? null, pip: null };
  }

  private mainKind(id: string): 'screen' | 'cam' | null {
    const v = this.videos.get(id);
    if (!v) return null;
    if (v.screen && v.cam) return this.swapped.has(id) ? 'cam' : 'screen';
    return v.screen ? 'screen' : v.cam ? 'cam' : null;
  }

  private syncTiles(): void {
    const st = this.state;
    if (!st) return;
    const ids = new Set(st.members.map((m) => m.userId));
    for (const [id, t] of this.tiles) {
      if (ids.has(id)) continue;
      t.mainRef = bind(t.video, t.mainRef, null);
      t.pipRef = bind(t.pipVideo, t.pipRef, null);
      t.el.remove();
      this.tiles.delete(id);
    }
    if (this.pinned && !this.videos.has(this.pinned)) this.pinned = null;
    for (const id of [...this.swapped]) {
      const v = this.videos.get(id);
      if (!v?.cam || !v.screen) this.swapped.delete(id);
    }
    for (const m of st.members) {
      const t = this.tiles.get(m.userId) ?? this.makeTile(m.userId);
      const { main, pip } = this.layout(m.userId);
      const kind = this.mainKind(m.userId);
      const who = nameOrYou(m.userId, this.myUserId, m.name);
      const mine = m.userId === this.myUserId;
      t.el.classList.toggle('has-video', Boolean(main));
      t.el.classList.toggle('screen', kind === 'screen');
      t.el.classList.toggle('mine', mine);
      t.el.classList.toggle('speaking', this.speaking.has(m.userId));
      t.el.classList.toggle('pinned', this.pinned === m.userId);
      t.el.setAttribute('aria-label', who);
      t.mainRef = bind(t.video, t.mainRef, main);
      t.video.hidden = !main;
      t.video.dataset.kind = kind ?? '';
      t.video.classList.toggle('mirror', mine && kind === 'cam');
      // Miniatura (câmera sobre a tela, ou a tela sobre a câmera se trocou).
      const showPip = Boolean(pip) && !this.pipHidden.has(m.userId);
      t.pipRef = bind(t.pipVideo, t.pipRef, showPip ? pip : null);
      t.pip.hidden = !showPip;
      const pipKind = kind === 'screen' ? 'cam' : 'screen';
      t.pipVideo.dataset.kind = pipKind;
      t.pipVideo.classList.toggle('mirror', mine && pipKind === 'cam');
      t.pip.classList.toggle('screen', pipKind === 'screen');
      const pipName = pipKind === 'cam' ? `câmera de ${who}` : `tela de ${who}`;
      if (mine) t.pip.setAttribute('aria-label', pipKind === 'cam' ? 'Sua câmera' : 'Sua tela');
      else
        t.pip.setAttribute('aria-label', pipKind === 'cam' ? `Câmera de ${who}` : `Tela de ${who}`);
      label(t.pipSwap, 'arrow-left-right', `Trocar destaque: ${pipName}`);
      label(
        t.pipFull,
        isFullscreen(t.pipVideo) ? 'fullscreen-exit' : 'fullscreen',
        `Tela cheia: ${pipName}`,
      );
      label(t.pipHide, 'eye-off', `Esconder ${pipName}`);
      t.showPip.hidden = !pip || showPip;
      label(t.showPip, 'eye', `Mostrar ${pipName}`);
      t.name.textContent = m.away
        ? `${who} · reconectando…`
        : `${who}${kind === 'screen' ? ' · tela' : ''}`;
      t.el.classList.toggle('away', m.away);
      t.icons.replaceChildren();
      if (!m.mic) {
        const muted = icon('mic-off', 13);
        muted.classList.add('call-muted');
        muted.setAttribute('aria-label', 'sem microfone');
        t.icons.append(muted);
      }
      if (m.screen && kind !== 'screen' && !pip) t.icons.append(icon('screen-share', 13));
      t.icons.append(t.link);
      this.paintLink(m.userId, t);
      t.tools.hidden = !main;
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
      id === this.pinned ? 0 : this.videos.get(id)?.screen ? 1 : this.videos.has(id) ? 2 : 3;
    const order = st.members.map((m) => m.userId).sort((a, b) => rank(a) - rank(b));
    const current = [...this.grid.children].map((c) => (c as HTMLElement).dataset.user);
    if (order.join() !== current.join()) {
      this.grid.replaceChildren(...order.map((id) => this.tiles.get(id)!.el));
    }
    this.grid.classList.toggle('has-pin', Boolean(this.pinned));
    this.grid.classList.toggle(
      'has-screen',
      [...this.videos.values()].some((v) => v.screen),
    );
    this.grid.dataset.count = String(st.members.length);
    this.el.classList.toggle('with-video', this.videos.size > 0);
  }

  private paintLink(id: string, t: Tile): void {
    const q = this.links.get(id);
    t.link.hidden = !q;
    t.link.dataset.link = q ?? '';
    t.link.setAttribute('aria-label', q ? LINK_TEXT[q] : '');
    t.link.title = q ? LINK_TEXT[q] : '';
  }

  private makeTile(id: string): Tile {
    const el = document.createElement('figure');
    el.className = 'call-tile';
    el.dataset.user = id;
    el.dataset.mouth = 'closed';
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // o áudio vem separado
    video.hidden = true;
    const pip = Object.assign(document.createElement('div'), { className: 'call-pip' });
    pip.setAttribute('role', 'group');
    pip.hidden = true;
    const pipVideo = document.createElement('video');
    pipVideo.autoplay = true;
    pipVideo.playsInline = true;
    pipVideo.muted = true;
    const pipTools = Object.assign(document.createElement('div'), { className: 'call-pip-tools' });
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
    const link = Object.assign(document.createElement('span'), { className: 'call-link' });
    link.setAttribute('role', 'img');
    const tools = Object.assign(document.createElement('div'), { className: 'call-tile-tools' });
    const t: Tile = {
      el,
      video,
      mainRef: null,
      pip,
      pipVideo,
      pipRef: null,
      pipSwap: iconButton('call-pip-swap', () => this.toggleSwap(id)),
      pipFull: iconButton('call-pip-full', () => void toggleFullscreen(pipVideo, pipVideo)),
      pipHide: iconButton('call-pip-hide', () => this.setPipHidden(id, true)),
      face,
      initial,
      name,
      icons,
      link,
      tools,
      pin: iconButton('call-pin', () => this.togglePin(id)),
      full: iconButton('call-tile-full', () => void toggleFullscreen(el, video)),
      showPip: iconButton('call-pip-show', () => this.setPipHidden(id, false)),
      figure: '',
      mouth: 'closed',
    };
    pipTools.append(t.pipSwap, t.pipFull, t.pipHide);
    pip.append(pipVideo, pipTools);
    dragInside(pip, el);
    tools.append(t.showPip, t.pin, t.full);
    el.append(video, faceBox, pip, caption, tools);
    // Duplo clique num vídeo: destaca (ou volta à grade).
    el.addEventListener('dblclick', (e) => {
      if (pip.contains(e.target as Node)) return;
      if (this.videos.has(id)) this.togglePin(id);
    });
    // Duplo clique na miniatura: troca o destaque.
    pip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.toggleSwap(id);
    });
    this.tiles.set(id, t);
    return t;
  }

  private toggleSwap(id: string): void {
    if (this.swapped.has(id)) this.swapped.delete(id);
    else this.swapped.add(id);
    this.syncTiles();
    this.updateMini();
  }

  private setPipHidden(id: string, hidden: boolean): void {
    if (hidden) this.pipHidden.add(id);
    else this.pipHidden.delete(id);
    this.syncTiles();
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
    this.closeStats?.();
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

  private toggleStats(): void {
    if (this.closeStats) return this.closeStats();
    this.closeStats = openCallStats(
      this.el,
      this.on,
      (id) => {
        const m = this.member(id);
        return nameOrYou(id, this.myUserId, m?.name ?? '?');
      },
      () => {
        this.closeStats = null;
        this.renderHead();
      },
    );
    this.renderHead();
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
    this.statsBtn.classList.toggle('on', Boolean(this.closeStats));
    this.statsBtn.setAttribute('aria-pressed', String(Boolean(this.closeStats)));
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
    if (screen) {
      btn('call-screen', 'screen-share', 'Parar tela', true, async () => {
        await this.on.screen(false);
      });
      // Trocar nitidez/fluidez com a tela já compartilhada (sem escolher a tela de novo).
      const mode = this.on.screenMode();
      const other: ScreenMode = mode === 'nitidez' ? 'fluidez' : 'nitidez';
      btn(
        'call-screen-mode',
        mode === 'nitidez' ? 'eye' : 'play',
        mode === 'nitidez' ? 'Tela: nitidez' : 'Tela: fluidez',
        null,
        async () => {
          await this.on.screen(true, other);
        },
      ).title = `Mudar para ${other}`;
    } else {
      // Antes de escolher a tela: nitidez (texto, código) ou fluidez (vídeo, rolagem).
      btn('call-screen', 'screen-share', 'Tela', false, () => {
        this.closeShare?.();
        this.closeShare = openShareChoice(this.on, () => {
          this.closeShare = null;
          this.refresh();
        });
      });
    }
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
    const main = this.layout(id).main;
    this.mini.update({
      name: nameOrYou(id, this.myUserId, m.name),
      video: main,
      mirror: id === this.myUserId && this.mainKind(id) === 'cam',
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

/** Arrastar a miniatura dentro do quadro (fica onde soltou, sem sair dele). */
function dragInside(el: HTMLElement, box: HTMLElement): void {
  let start: { x: number; y: number; left: number; top: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left - b.left, top: r.top - b.top };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    e.stopPropagation();
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const b = box.getBoundingClientRect();
    const left = Math.max(0, Math.min(b.width - el.offsetWidth, start.left + e.clientX - start.x));
    const top = Math.max(0, Math.min(b.height - el.offsetHeight, start.top + e.clientY - start.y));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  const end = () => {
    start = null;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

interface MiniInfo {
  name: string;
  video: VideoRef | null;
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
  private videoRef: VideoRef | null = null;
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
    this.videoRef = bind(this.video, this.videoRef, null);
  }

  get element(): HTMLElement {
    return this.el;
  }

  update(info: MiniInfo): void {
    if (this.el.hidden) return;
    this.videoRef = bind(this.video, this.videoRef, info.video);
    this.video.hidden = !info.video;
    this.video.classList.toggle('mirror', info.mirror);
    this.face.hidden = Boolean(info.video) || !info.face;
    this.initial.hidden = Boolean(info.video) || Boolean(info.face);
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
 * Antes de compartilhar a tela: nitidez (texto e código legíveis; com movimento, cai o fps) ou
 * fluidez (vídeo e rolagem lisos; cai a resolução). A escolha fica salva. O clique em
 * "Compartilhar" abre a escolha de tela do navegador. Devolve como fechar.
 */
function openShareChoice(on: CallPanelHandlers, closed: () => void): () => void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop call-devices-backdrop';
  const sheet = document.createElement('section');
  sheet.className = 'sheet call-share-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'call-share-title');
  const mode = on.screenMode();
  sheet.innerHTML = `
    <header class="sheet-head">
      <h2 id="call-share-title">Compartilhar a tela</h2>
      <button type="button" class="sheet-close" aria-label="Fechar">${iconHtml('x')}</button>
    </header>
    <div class="sheet-body">
      <fieldset class="call-share-modes">
        <legend>Priorizar</legend>
        <label class="call-share-mode"><input type="radio" name="call-share-mode" value="nitidez" ${mode === 'nitidez' ? 'checked' : ''} />
          <span><strong>Nitidez</strong><small class="muted">Texto, código e planilhas legíveis. Com muito movimento, a tela anda mais devagar.</small></span></label>
        <label class="call-share-mode"><input type="radio" name="call-share-mode" value="fluidez" ${mode === 'fluidez' ? 'checked' : ''} />
          <span><strong>Fluidez</strong><small class="muted">Vídeo, animação e rolagem lisos. A imagem pode perder um pouco de definição.</small></span></label>
      </fieldset>
      <small class="muted">Sua câmera continua ligada: os outros veem a tela em destaque e você numa miniatura.</small>
      <div class="sheet-actions"><button type="button" class="btn-primary call-share-go">Compartilhar</button></div>
    </div>`;
  backdrop.append(sheet);
  (document.fullscreenElement ?? document.body).append(backdrop);
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
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
  sheet.querySelector('.sheet-close')!.addEventListener('click', close);
  const go = sheet.querySelector<HTMLButtonElement>('.call-share-go')!;
  go.addEventListener('click', () => {
    const picked = sheet.querySelector<HTMLInputElement>('input[name=call-share-mode]:checked');
    const m: ScreenMode = picked?.value === 'fluidez' ? 'fluidez' : 'nitidez';
    go.disabled = true;
    // A escolha de tela do navegador precisa sair direto deste clique.
    void on.screen(true, m).finally(close);
  });
  go.focus();
  return close;
}

const fmtKbps = (k: number) => (k >= 1000 ? `${(k / 1000).toFixed(1)} Mbps` : `${k} kbps`);
const LIMIT_TEXT: Record<string, string> = {
  bandwidth: 'rede',
  cpu: 'processador',
  other: 'outro',
};

/**
 * Detalhes da conexão (dentro da janela da chamada): cada vídeo que eu mando (as camadas) e que
 * eu recebo, com resolução, fps, bitrate, perda e atraso. Atualiza a cada segundo.
 */
function openCallStats(
  host: HTMLElement,
  on: CallPanelHandlers,
  nameOf: (userId: string) => string,
  closed: () => void,
): () => void {
  const box = document.createElement('section');
  box.className = 'call-stats';
  box.setAttribute('aria-label', 'Detalhes da conexão');
  const body = document.createElement('div');
  box.append(body);
  host.querySelector('.call-panel-head')!.after(box);
  let running = true;
  const draw = async () => {
    const rows = await on.stats().catch(() => []);
    if (!running) return;
    if (!rows.length) {
      body.replaceChildren(
        Object.assign(document.createElement('small'), {
          className: 'muted',
          textContent: 'Sem vídeo agora. Ligue a câmera ou espere alguém ligar.',
        }),
      );
      return;
    }
    const table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th>Vídeo</th><th>Resolução</th><th>fps</th><th>Bitrate</th><th>Atraso</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const r of rows.sort((a, b) =>
      a.direction === b.direction ? 0 : a.direction === 'envio' ? -1 : 1,
    )) {
      const tr = document.createElement('tr');
      const what = r.kind === 'screen' ? 'tela' : 'câmera';
      const who =
        r.direction === 'envio' ? `Você mandando (${what})` : `${nameOf(r.userId)} (${what})`;
      const res = r.layers.map((l) => `${l.width}×${l.height}`).join(' · ') || '—';
      const fps = r.layers.map((l) => l.fps).join(' · ') || '—';
      const extra = [
        r.limit ? `limitado pelo ${LIMIT_TEXT[r.limit] ?? r.limit}` : '',
        r.lossPct ? `${r.lossPct}% perdido` : '',
      ]
        .filter(Boolean)
        .join(', ');
      const delay =
        r.delayMs !== undefined
          ? `~${r.delayMs} ms`
          : r.rttMs !== undefined
            ? `RTT ${r.rttMs} ms`
            : '—';
      const cells = [who, res, fps, `${fmtKbps(r.kbps)}${extra ? ` (${extra})` : ''}`, delay];
      for (const c of cells)
        tr.append(Object.assign(document.createElement('td'), { textContent: c }));
      tb.append(tr);
    }
    table.append(tb);
    body.replaceChildren(
      table,
      Object.assign(document.createElement('small'), {
        className: 'muted',
        textContent:
          'Atraso: ida e volta pela rede mais a espera para tocar sem engasgar. Abaixo de 150 ms a conversa flui sem notar.',
      }),
    );
  };
  void draw();
  const timer = window.setInterval(() => void draw(), 1000);
  return () => {
    running = false;
    clearInterval(timer);
    box.remove();
    closed();
  };
}

/**
 * Dispositivos e efeitos: microfone (com medidor de volume), câmera (com prévia), saída de
 * áudio, qualidade do vídeo, desfoque de fundo e supressão de ruído. Cada troca vale na hora,
 * sem cair a chamada.
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
      <label class="field"><span>Qualidade do vídeo</span><select id="call-dev-quality">
        <option value="auto">Automática (ajusta sozinha à sua conexão)</option>
        <option value="alta">Alta (conexão boa: mais nitidez)</option>
        <option value="economia">Economia (4G ou rede fraca)</option>
      </select></label>
      <small class="muted call-quality-note"></small>
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
  const qualitySel = $<HTMLSelectElement>('#call-dev-quality');
  const qualityNote = $<HTMLElement>('.call-quality-note');
  const QUALITY_NOTES: Record<CallQuality, string> = {
    auto: 'Até 1080p a 30 fps; cai e volta sozinha conforme a rede de cada um.',
    alta: 'Até 1080p com mais bitrate (e tela a até 60 fps na fluidez). Use com conexão boa.',
    economia: 'Câmera em 360p e vídeos dos outros menores: gasta bem menos dados.',
  };
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
    qualitySel.value = on.quality();
    qualityNote.textContent = QUALITY_NOTES[on.quality()];
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
  qualitySel.addEventListener(
    'change',
    () =>
      void busy(qualitySel, async () => {
        const q = qualitySel.value as CallQuality;
        qualityNote.textContent = QUALITY_NOTES[q];
        await on.setQuality(q);
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
