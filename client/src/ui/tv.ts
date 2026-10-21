import {
  formatTvTime,
  parseYouTubeLink,
  TV_ERRORS,
  TV_SYNC_TOLERANCE_S,
  tvPosition,
  type TvItem,
  type TvState,
} from '@office/shared';
import type { TvPlayer, TvPlayerFactory } from '../tv/player.js';
import { makeDraggable, type Draggable } from './draggable.js';
import { iconHtml } from './icons.js';

export interface TvPanelHandlers {
  add(videoIds: string[]): void;
  remove(itemId: string): void;
  control(action: 'play' | 'pause' | 'seek', position: number): void;
  skip(): void;
  duration(itemId: string, seconds: number): void;
  ended(itemId: string): void;
  /** Lê uma playlist do YouTube (ids dos vídeos). */
  playlist(listId: string, fromVideo: string | null): Promise<string[]>;
  close(): void;
}

export interface TvPanelOptions {
  furniId: string;
  title: string;
  myUserId: string;
  isAdmin: boolean;
  player: TvPlayerFactory;
  on: TvPanelHandlers;
}

const VOLUME_KEY = 'ev-tv-volume';
/** De quanto em quanto o player confere se está no mesmo ponto que a sala (ms). */
const SYNC_EVERY_MS = 1000;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && localStorage.getItem(VOLUME_KEY) !== null ? v : 80;
  } catch {
    return 80;
  }
}

/**
 * Painel da TV (Fase 51): o player, os controles (iguais para todo mundo que assiste), a fila
 * e o voto para pular. O player fica sempre montado; o resto é redesenhado a cada estado.
 */
export class TvPanel {
  readonly furniId: string;
  private readonly root = el('section', { className: 'tv-panel' });
  private readonly screen = el('div', { className: 'tv-screen' });
  private readonly shield = el('button', { type: 'button', className: 'tv-shield' });
  private readonly nowBox = el('div', { className: 'tv-now' });
  private readonly playBtn = el('button', { type: 'button', className: 'icon-btn tv-play' });
  private readonly seek = el('input', { type: 'range', className: 'tv-seek', min: '0', step: '1' });
  private readonly timeLabel = el('small', { className: 'tv-time' });
  private readonly skipBtn = el('button', { type: 'button', className: 'btn-secondary tv-skip' });
  private readonly muteBtn = el('button', { type: 'button', className: 'icon-btn tv-mute' });
  private readonly volume = el('input', {
    type: 'range',
    className: 'tv-volume',
    min: '0',
    max: '100',
  });
  private readonly viewersLabel = el('small', { className: 'tv-viewers' });
  private readonly linkInput = el('input', {
    type: 'url',
    className: 'tv-link',
    placeholder: 'Cole um link do YouTube',
  });
  private readonly addBtn = el('button', {
    type: 'submit',
    className: 'btn-primary',
    textContent: 'Adicionar',
  });
  private readonly status = el('small', { className: 'tv-status' });
  private readonly queueBox = el('ol', { className: 'tv-queue' });
  private readonly expandBtn = el('button', { type: 'button', className: 'icon-btn' });
  private readonly player: TvPlayer;
  private readonly drag: Draggable;
  private state: TvState | null = null;
  /** Diferença entre o relógio do servidor e o daqui (ms). */
  private clockOffset = 0;
  private loadedItem = '';
  private durationSent = '';
  private seeking = false;
  private muted = false;
  private expanded = false;
  private syncTimer = 0;
  private statusTimer = 0;

  constructor(private readonly opts: TvPanelOptions) {
    this.furniId = opts.furniId;
    const { on } = opts;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', opts.title);
    const closeBtn = el('button', {
      type: 'button',
      className: 'icon-btn',
      innerHTML: iconHtml('x', 16),
    });
    closeBtn.setAttribute('aria-label', 'Fechar a TV');
    closeBtn.addEventListener('click', () => on.close());
    this.expandBtn.addEventListener('click', () => this.setExpanded(!this.expanded));
    const fullBtn = el('button', {
      type: 'button',
      className: 'icon-btn',
      innerHTML: iconHtml('scan', 16),
    });
    fullBtn.setAttribute('aria-label', 'Tela cheia');
    fullBtn.title = 'Tela cheia';
    fullBtn.addEventListener('click', () => this.fullscreen());

    // O player fica atrás de uma "película": clicar pausa/toca para todos, duplo clique é
    // tela cheia (o player do YouTube não recebe cliques direto, senão cada um mexia só no seu).
    this.shield.setAttribute('aria-label', 'Tocar ou pausar');
    this.shield.addEventListener('click', () => this.togglePlay());
    this.shield.addEventListener('dblclick', () => this.fullscreen());
    const stage = el('div', { className: 'tv-stage' }, [this.screen, this.shield]);

    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.seek.setAttribute('aria-label', 'Ponto do vídeo');
    this.seek.addEventListener('input', () => {
      this.seeking = true;
      this.timeLabel.textContent = this.timeText(Number(this.seek.value));
    });
    this.seek.addEventListener('change', () => {
      this.seeking = false;
      on.control('seek', Number(this.seek.value));
    });
    this.skipBtn.addEventListener('click', () => on.skip());
    this.volume.value = String(readVolume());
    this.volume.setAttribute('aria-label', 'Volume');
    this.volume.addEventListener('input', () => {
      this.muted = false;
      this.applyVolume();
      try {
        localStorage.setItem(VOLUME_KEY, this.volume.value);
      } catch {
        // sem armazenamento: vale só agora
      }
    });
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      this.applyVolume();
    });

    const form = el('form', { className: 'tv-add' }, [this.linkInput, this.addBtn]);
    // Aceita link sem "https://" (youtu.be/…): quem valida é o `parseYouTubeLink`.
    form.noValidate = true;
    this.linkInput.setAttribute('aria-label', 'Link do YouTube');
    // Atalhos da sala (WASD, Enter do chat…) não valem enquanto digita aqui.
    this.linkInput.addEventListener('keydown', (e) => e.stopPropagation());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.addLink();
    });
    this.status.setAttribute('role', 'status');

    this.root.append(
      el(
        'header',
        { className: 'tv-head', title: 'Arraste para mover (duplo clique volta ao lugar)' },
        [
          el('span', { className: 'drag-grip', innerHTML: iconHtml('grip', 14) }),
          el('span', { className: 'tv-title', innerHTML: `${iconHtml('tv', 16)} ` }, [opts.title]),
          this.viewersLabel,
          el('span', { className: 'tv-head-actions' }, [fullBtn, this.expandBtn, closeBtn]),
        ],
      ),
      stage,
      this.nowBox,
      el('div', { className: 'tv-controls' }, [
        this.playBtn,
        this.seek,
        this.timeLabel,
        this.muteBtn,
        this.volume,
      ]),
      el('div', { className: 'tv-actions' }, [this.skipBtn]),
      form,
      this.status,
      this.queueBox,
    );
    document.body.append(this.root);
    this.drag = makeDraggable(this.root, {
      handle: '.tv-head',
      key: 'tv',
      mode: () => (this.expanded ? 'ampliada' : 'pequena'),
    });
    this.setExpanded(false);

    this.player = opts.player(this.screen, {
      ended: () => {
        const item = this.state?.playing?.item;
        if (item) on.ended(item.id);
      },
      blocked: (blocked) => this.root.classList.toggle('blocked', blocked),
      error: (message) => this.flash(message),
    });
    this.applyVolume();
    this.syncTimer = window.setInterval(() => this.sync(), SYNC_EVERY_MS);
    this.render();
    this.linkInput.focus();
  }

  /** Estado novo da TV (vem do servidor). */
  set(state: TvState): void {
    this.state = state;
    this.clockOffset = state.now - Date.now();
    this.sync();
    this.render();
  }

  /** Erro do servidor (vídeo bloqueado, fila cheia…). */
  error(message: string): void {
    this.flash(message);
  }

  close(): void {
    clearInterval(this.syncTimer);
    clearTimeout(this.statusTimer);
    this.drag.destroy();
    this.player.destroy();
    if (document.fullscreenElement === this.root)
      void document.exitFullscreen().catch(() => undefined);
    this.root.remove();
  }

  // ---------- Sincronia ----------

  private serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  /** Deixa o player igual à sala: mesmo vídeo, tocando/pausado e no mesmo ponto. */
  private sync(): void {
    const p = this.state?.playing;
    if (!p) {
      if (this.loadedItem) this.player.pause();
      this.loadedItem = '';
      this.renderTime();
      return;
    }
    const expected = tvPosition(p, this.serverNow());
    const playing = p.pausedAt === null;
    if (this.loadedItem !== p.item.id) {
      this.loadedItem = p.item.id;
      this.player.load(p.item.videoId, expected, playing);
    } else {
      if (playing && !this.player.isPlaying()) this.player.play();
      if (!playing && this.player.isPlaying()) this.player.pause();
      if (Math.abs(this.player.time() - expected) > TV_SYNC_TOLERANCE_S) this.player.seek(expected);
    }
    // O primeiro a saber a duração conta para o servidor (para passar ao próximo no fim).
    const d = this.player.duration();
    if (d && p.item.duration === null && this.durationSent !== p.item.id) {
      this.durationSent = p.item.id;
      this.opts.on.duration(p.item.id, d);
    }
    this.renderTime();
  }

  private position(): number {
    const p = this.state?.playing;
    return p ? tvPosition(p, this.serverNow()) : 0;
  }

  private togglePlay(): void {
    const p = this.state?.playing;
    if (!p) return;
    // Bloqueado pelo navegador: este clique já libera o som (e segue a sala).
    if (this.root.classList.contains('blocked') && p.pausedAt === null) {
      this.player.play();
      return;
    }
    this.opts.on.control(p.pausedAt === null ? 'pause' : 'play', this.position());
  }

  private applyVolume(): void {
    const v = this.muted ? 0 : Number(this.volume.value);
    this.player.setVolume(v);
    this.muteBtn.innerHTML = iconHtml(v === 0 ? 'volume-x' : 'volume-2', 16);
    this.muteBtn.setAttribute('aria-label', v === 0 ? 'Ligar o som' : 'Tirar o som');
  }

  private fullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void this.root.requestFullscreen?.().catch(() => undefined);
  }

  private setExpanded(on: boolean): void {
    this.expanded = on;
    this.root.classList.toggle('expanded', on);
    this.drag?.refresh();
    this.expandBtn.innerHTML = iconHtml(on ? 'minimize' : 'maximize', 16);
    this.expandBtn.setAttribute('aria-label', on ? 'Diminuir' : 'Ampliar');
    this.expandBtn.title = on ? 'Diminuir' : 'Ampliar';
  }

  private async addLink(): Promise<void> {
    const { videoId, listId } = parseYouTubeLink(this.linkInput.value);
    if (!videoId && !listId) return this.flash(TV_ERRORS.invalid);
    this.addBtn.disabled = true;
    try {
      let ids = videoId ? [videoId] : [];
      if (listId) {
        this.flash('Lendo a playlist…', false);
        const list = await this.opts.on.playlist(listId, videoId).catch(() => []);
        if (list.length) ids = list;
      }
      if (!ids.length) return this.flash('Não consegui ler essa playlist.');
      this.opts.on.add(ids);
      this.linkInput.value = '';
      this.flash(
        ids.length > 1 ? `${ids.length} vídeos indo para a fila…` : 'Indo para a fila…',
        false,
      );
    } finally {
      this.addBtn.disabled = false;
    }
  }

  private flash(message: string, error = true): void {
    clearTimeout(this.statusTimer);
    this.status.textContent = message;
    this.status.classList.toggle('error', error);
    this.statusTimer = window.setTimeout(() => (this.status.textContent = ''), 5000);
  }

  // ---------- Desenho ----------

  private timeText(at: number): string {
    const d = this.state?.playing?.item.duration ?? this.player.duration();
    return d ? `${formatTvTime(at)} / ${formatTvTime(d)}` : formatTvTime(at);
  }

  private renderTime(): void {
    const p = this.state?.playing;
    const d = p?.item.duration ?? this.player.duration() ?? 0;
    this.seek.disabled = !p || !d;
    this.seek.max = String(Math.max(1, Math.round(d)));
    if (this.seeking) return;
    const at = this.position();
    this.seek.value = d ? String(Math.round(at)) : '0';
    this.timeLabel.textContent = p ? this.timeText(at) : '';
  }

  private render(): void {
    const st = this.state;
    const p = st?.playing ?? null;
    const me = this.opts.myUserId;
    this.root.classList.toggle('idle', !p);
    // Agora passando.
    if (p) {
      this.nowBox.replaceChildren(
        el('strong', { className: 'tv-now-title', textContent: p.item.title, title: p.item.title }),
        el('small', {
          className: 'muted',
          textContent: [p.item.author, `adicionado por ${p.item.addedByName}`]
            .filter(Boolean)
            .join(' · '),
        }),
      );
    } else {
      this.nowBox.replaceChildren(
        el('p', {
          className: 'muted tv-empty',
          textContent: 'Nada passando. Cole um link do YouTube para começar.',
        }),
      );
    }
    const paused = !p || p.pausedAt !== null;
    this.playBtn.innerHTML = iconHtml(paused ? 'play' : 'pause', 16);
    this.playBtn.setAttribute('aria-label', paused ? 'Tocar' : 'Pausar');
    this.playBtn.disabled = !p;
    // Pular: quem adicionou (ou admin) pula na hora; os outros votam.
    const mine = Boolean(p && (p.item.addedBy === me || this.opts.isAdmin));
    const voted = Boolean(st?.skipVotes.includes(me));
    this.skipBtn.disabled = !p;
    this.skipBtn.innerHTML = `${iconHtml('skip-forward', 16)} ${
      mine ? 'Pular' : `Votar para pular (${st?.skipVotes.length ?? 0}/${st?.skipNeeded ?? 1})`
    }`;
    this.skipBtn.setAttribute('aria-pressed', String(voted));
    this.skipBtn.classList.toggle('on', voted);
    // Quem assiste.
    const viewers = st?.viewers ?? [];
    this.viewersLabel.innerHTML = `${iconHtml('eye', 14)} ${viewers.length} assistindo`;
    this.viewersLabel.title = viewers.map((v) => v.name).join(', ');
    // Fila.
    const queue = st?.queue ?? [];
    this.queueBox.replaceChildren(
      ...(queue.length
        ? queue.map((item, i) => this.queueItem(item, i))
        : [el('li', { className: 'muted tv-queue-empty', textContent: 'A fila está vazia.' })]),
    );
    this.renderTime();
  }

  private queueItem(item: TvItem, index: number): HTMLLIElement {
    const thumb = el('img', {
      className: 'tv-thumb',
      alt: '',
      loading: 'lazy',
      src: `/api/tv/thumb/${item.videoId}.jpg`,
    });
    thumb.addEventListener('error', () => thumb.classList.add('missing'), { once: true });
    const li = el('li', { className: 'tv-queue-item' }, [
      el('span', { className: 'tv-queue-n', textContent: String(index + 1) }),
      thumb,
      el('span', { className: 'tv-queue-text' }, [
        el('span', { className: 'tv-queue-title', textContent: item.title, title: item.title }),
        el('small', { className: 'muted', textContent: item.addedByName }),
      ]),
    ]);
    if (item.addedBy === this.opts.myUserId || this.opts.isAdmin) {
      const rm = el('button', {
        type: 'button',
        className: 'icon-btn',
        innerHTML: iconHtml('x', 14),
      });
      rm.setAttribute('aria-label', `Tirar "${item.title}" da fila`);
      rm.addEventListener('click', () => this.opts.on.remove(item.id));
      li.append(rm);
    }
    return li;
  }
}
