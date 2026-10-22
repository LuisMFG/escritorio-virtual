import {
  aimGuide,
  canPlaceCue,
  cueSpot,
  groupOf,
  HEAD_X,
  onEight,
  otherGroup,
  POCKETS,
  POOL,
  sideOf,
  simulateShot,
  type ArcadeReply,
  type ArcadeSide,
  type ArcadeSlot,
  type ArcadeView,
  type PoolAim,
  type PoolBalls,
  type PoolPos,
  type PoolShotMessage,
} from '@office/shared';

/** Largura da tabela desenhada em volta do pano e a folga até a borda (m). */
const RAIL = 0.07;
const MARGIN = 0.03;
/** Faixa da barra de força, à direita da mesa (px). */
const BAR_PX = 46;
/** Quanto tempo cada quadro gravado da simulação representa (ms). */
const FRAME_MS = POOL.dt * POOL.frameEvery * 1000;
/** De quanto em quanto tempo a mira vai para os outros verem. */
const AIM_EVERY_MS = 100;
/** Giro da mira por toque nas setas do teclado (radianos; com Shift, 5 vezes mais). */
const AIM_STEP = (0.2 * Math.PI) / 180;

/** Cores das bolas (1–7 lisas; 9–15 listradas com a mesma cor; 8 preta). */
const COLORS = [
  '#f6f6f2',
  '#f4c20d',
  '#1e5bd8',
  '#d6252b',
  '#6b2fb6',
  '#f07c1a',
  '#1f9d4c',
  '#8a1c1c',
  '#141414',
];
export const poolBallColor = (ball: number) => COLORS[ball > 8 ? ball - 8 : ball]!;

export interface PoolViewOptions {
  canvas: HTMLCanvasElement;
  /** O círculo do efeito na branca (fora do canvas). */
  spin: HTMLElement;
  /** Linha com a dica do que fazer agora. */
  hint: HTMLElement;
  /** Relógio da tacada. */
  clock: HTMLElement;
  /** Hora do servidor. */
  now: () => number;
  mySlot: () => ArcadeSlot | null;
  shoot(msg: Omit<PoolShotMessage, 'furniId'>): Promise<ArcadeReply>;
  aim(msg: PoolAim): void;
}

/** Converte entre o canvas (px de CSS) e o pano (metros); a barra de força fica à direita. */
export function poolTransform(width: number) {
  const area = Math.max(100, width - BAR_PX);
  const s = area / (POOL.tableL + 2 * (RAIL + MARGIN));
  const o = (RAIL + MARGIN) * s;
  const height = (POOL.tableW + 2 * (RAIL + MARGIN)) * s;
  return {
    s,
    height,
    toPx: (p: PoolPos) => ({ x: o + p[0] * s, y: o + p[1] * s }),
    toTable: (x: number, y: number): PoolPos => [(x - o) / s, (y - o) / s],
    bar: { x: area + 12, y: 14, w: BAR_PX - 22, h: height - 28 },
  };
}

/**
 * Bolas que faltam para um lado: as do grupo dele ainda na mesa; só a 8 quando é a vez dela;
 * nenhuma com a mesa aberta.
 */
export function poolLeft(v: ArcadeView, side: ArcadeSide): number[] {
  const { balls, groupA } = v.pool;
  if (!balls || !groupA) return [];
  const group = side === 'a' ? groupA : otherGroup(groupA);
  const left = balls.flatMap((b, i) => (b && groupOf(i) === group ? [i] : []));
  return left.length || !balls[8] ? left : [8];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: PoolPos, b: PoolPos) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Mesa de sinuca ao vivo (Fase 59), vista de cima e em arte própria. Quem tem a vez mira
 * arrastando na mesa (com a linha-guia: a bola-fantasma e o caminho da bola acertada; as setas
 * do teclado afinam a mira), escolhe o efeito no círculo da branca, puxa a barra de força e solta
 * para tacar. Com bola na mão, arrasta a branca; na vez da 8, toca na caçapa. A tacada que o
 * servidor manda é simulada aqui igual e animada no mesmo instante para todos.
 */
export class PoolView {
  private view: ArcadeView | null = null;
  private frames: Float32Array[] | null = null;
  private framesFor = -1;
  /** Muda a cada vez nova (tacada, tempo esgotado): a branca, a caçapa e a força recomeçam. */
  private turnKey = '';
  private aimDir: PoolPos = [1, 0];
  private power = 0;
  private drag: 'aim' | 'cue' | 'power' | null = null;
  /** Toque numa caçapa na vez da 8 (vira o canto se o dedo não arrastar). */
  private tap: { pocket: number; px: number; py: number } | null = null;
  /** Onde quem tem bola na mão pôs a branca (`null` = onde ela parou). */
  private cuePos: PoolPos | null = null;
  private call: number | null = null;
  private spin = { x: 0, y: 0 };
  private lastAim = 0;
  private aimTimer = 0;
  /** A tacada foi mandada e ainda não voltou no estado: nada de mirar de novo. */
  private sent = false;
  private flash = { text: '', until: 0 };
  private raf = 0;
  private readonly dot = document.createElement('span');

  constructor(private readonly opts: PoolViewOptions) {
    const c = opts.canvas;
    c.width = 0; // redesenha no tamanho ao vivo
    c.style.width = '100%';
    c.style.touchAction = 'none';
    c.tabIndex = 0;
    c.setAttribute('aria-label', 'Mesa de sinuca: arraste para mirar; as setas afinam a mira');
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('keydown', this.onKey);
    window.addEventListener('pointerup', this.onUp);
    this.dot.className = 'pool-spin-dot';
    opts.spin.replaceChildren(this.dot);
    opts.spin.addEventListener('pointerdown', this.onSpin);
    opts.spin.addEventListener('pointermove', this.onSpinMove);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.aimTimer);
    const c = this.opts.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerup', this.onUp);
    this.opts.spin.removeEventListener('pointerdown', this.onSpin);
    this.opts.spin.removeEventListener('pointermove', this.onSpinMove);
    c.width = 0;
    c.style.width = '';
    c.style.height = '';
    c.style.touchAction = '';
    c.removeAttribute('tabindex');
    c.removeAttribute('aria-label');
  }

  update(view: ArcadeView): void {
    this.view = view;
    const shot = view.pool.shot;
    if (shot && shot.t0 !== this.framesFor) {
      // A tacada nova: a mesma simulação do servidor, gravada para animar.
      this.frames = simulateShot(shot.start, shot, true).frames ?? null;
      this.framesFor = shot.t0;
      this.sent = false;
    }
    const key = `${view.status}|${view.turn}|${shot?.t0 ?? 0}|${view.phase}`;
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.cuePos = null;
      this.call = null;
      this.power = 0;
      this.drag = null;
      this.tap = null;
      this.spin = { x: 0, y: 0 };
      // Bola na mão com a branca fora da mesa: ela aparece atrás da linha, num lugar livre.
      const balls = view.pool.balls;
      if (this.myTurn && view.pool.inHand && balls && !balls[0]) {
        this.cuePos = cueSpot(balls, view.pool.breakShot);
      }
    }
  }

  // ---------- Estado ----------

  /** É a minha vez de tacar agora. */
  private get myTurn(): boolean {
    const v = this.view;
    const me = this.opts.mySlot();
    return Boolean(v && me && v.status === 'playing' && v.phase === 'aim' && v.turn === me);
  }

  /** As bolas paradas; com bola na mão, a branca onde quem taca a pôs (os outros, pela mira). */
  private restBalls(): PoolBalls | null {
    const v = this.view;
    const balls = v?.pool.balls;
    if (!v || !balls) return null;
    if (!v.pool.inHand || v.phase !== 'aim') return balls;
    const aim = v.pool.aim;
    const cue: PoolPos | null = this.myTurn ? this.cuePos : aim ? [aim.cx, aim.cy] : null;
    if (!cue) return balls;
    const out = balls.slice();
    out[0] = cue;
    return out;
  }

  /** É a minha vez e só falta a 8 (tem que cantar a caçapa). */
  private onEightNow(): boolean {
    const v = this.view;
    if (!v?.pool.balls || !v.turn || !this.myTurn) return false;
    const side = sideOf(v.turn);
    const rules = { groupA: v.pool.groupA, turn: side, next: { a: 0, b: 0 } };
    return onEight({ ...rules, inHand: false, breakShot: false }, v.pool.balls, side);
  }

  private say(text: string): void {
    this.flash = { text, until: performance.now() + 3000 };
  }

  // ---------- Entrada ----------

  private point(e: PointerEvent) {
    const r = this.opts.canvas.getBoundingClientRect();
    const tr = poolTransform(r.width);
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { tr, px, py, p: tr.toTable(px, py) };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.myTurn || this.sent) return;
    const { tr, px, py, p } = this.point(e);
    const bar = tr.bar;
    const cue = this.restBalls()?.[0] ?? null;
    const pocket = POCKETS.findIndex((k) => dist(p, [k.x, k.y]) < k.r + 0.04);
    if (px >= bar.x - 8 && px <= bar.x + bar.w + 8 && py >= bar.y - 8 && py <= bar.y + bar.h + 8) {
      this.drag = 'power';
      this.power = 0;
    } else if (
      this.view!.pool.inHand &&
      (!cue || dist(p, cue) < Math.max(POOL.ballR * 2.5, 16 / tr.s))
    ) {
      this.drag = 'cue';
      this.placeCue(p);
    } else if (this.onEightNow() && pocket >= 0) {
      // Na vez da 8, tocar na caçapa canta; arrastar dali ainda mira.
      this.drag = 'aim';
      this.tap = { pocket, px, py };
    } else {
      this.drag = 'aim';
      this.aimAt(p);
    }
    this.sendAim();
    this.opts.canvas.setPointerCapture?.(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.drag || !this.myTurn) return;
    const { tr, px, py, p } = this.point(e);
    if (this.drag === 'aim') {
      if (this.tap && Math.hypot(px - this.tap.px, py - this.tap.py) < 6) return;
      this.tap = null;
      this.aimAt(p);
    } else if (this.drag === 'cue') this.placeCue(p);
    else this.power = clamp((py - tr.bar.y) / tr.bar.h, 0, 1);
    this.sendAim();
  };

  private readonly onUp = (): void => {
    const was = this.drag;
    this.drag = null;
    if (this.tap) {
      this.call = this.tap.pocket;
      this.tap = null;
      return;
    }
    if (was !== 'power') return;
    if (this.power > 0.02 && this.myTurn) this.shoot();
    else this.power = 0;
    this.sendAim();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.myTurn || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const a = (e.key === 'ArrowLeft' ? -1 : 1) * AIM_STEP * (e.shiftKey ? 5 : 1);
    const [x, y] = this.aimDir;
    this.aimDir = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    this.sendAim();
  };

  private aimAt(p: PoolPos): void {
    const cue = this.restBalls()?.[0];
    if (!cue) return;
    const len = dist(p, cue);
    if (len > 0.01) this.aimDir = [(p[0] - cue[0]) / len, (p[1] - cue[1]) / len];
  }

  private placeCue(p: PoolPos): void {
    const R = POOL.ballR;
    const maxX = this.view?.pool.breakShot ? HEAD_X : POOL.tableL - R;
    this.cuePos = [clamp(p[0], R, maxX), clamp(p[1], R, POOL.tableW - R)];
  }

  private readonly onSpin = (e: PointerEvent): void => {
    if (!this.myTurn) return;
    this.opts.spin.setPointerCapture?.(e.pointerId);
    this.setSpin(e);
  };

  private readonly onSpinMove = (e: PointerEvent): void => {
    if (e.buttons && this.myTurn) this.setSpin(e);
  };

  private setSpin(e: PointerEvent): void {
    const r = this.opts.spin.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    // Para cima no círculo é efeito alto (a branca segue); para baixo, baixo (a branca volta).
    this.spin = { x, y: -y };
  }

  /** Mira ao vivo para os outros (no máximo a cada 100 ms, sempre com a última). */
  private sendAim(): void {
    const wait = this.lastAim + AIM_EVERY_MS - performance.now();
    if (wait > 0) {
      this.aimTimer ||= window.setTimeout(() => {
        this.aimTimer = 0;
        this.sendAim();
      }, wait);
      return;
    }
    const cue = this.restBalls()?.[0];
    if (!cue || !this.myTurn) return;
    this.lastAim = performance.now();
    const [dx, dy] = this.aimDir;
    this.opts.aim({ dx, dy, power: this.power, cx: cue[0], cy: cue[1] });
  }

  private shoot(): void {
    const v = this.view!;
    const power = this.power;
    this.power = 0;
    const balls = this.restBalls();
    if (!balls?.[0]) return;
    if (this.cuePos && !canPlaceCue(balls, this.cuePos, v.pool.breakShot)) {
      return this.say('A branca não cabe aí: arraste para um lugar livre.');
    }
    if (this.onEightNow() && this.call === null) {
      return this.say('Cante a caçapa da 8 antes: toque nela.');
    }
    this.sent = true;
    const [dx, dy] = this.aimDir;
    const msg: Omit<PoolShotMessage, 'furniId'> = {
      dx,
      dy,
      power,
      sx: this.spin.x,
      sy: this.spin.y,
      // A branca só vai se quem tem bola na mão a mexeu (senão fica onde parou).
      ...(this.cuePos ? { cx: this.cuePos[0], cy: this.cuePos[1] } : {}),
      ...(this.call !== null ? { call: this.call } : {}),
    };
    void this.opts.shoot(msg).then(
      (res) => {
        if (!res.ok) this.sent = false;
        // Se o estado não trouxer a tacada, libera depois de um tempo.
        else window.setTimeout(() => (this.sent = false), 3000);
      },
      () => (this.sent = false),
    );
  }

  // ---------- Desenho ----------

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    this.draw();
  };

  /** Posições para desenhar agora: a tacada animada ou as bolas paradas. */
  private positions(now: number): PoolBalls | null {
    const shot = this.view?.pool.shot;
    if (shot && this.frames && shot.t0 === this.framesFor && now < shot.t0 + shot.ms) {
      const k = clamp(Math.floor((now - shot.t0) / FRAME_MS), 0, this.frames.length - 1);
      const f = this.frames[k]!;
      return Array.from({ length: 16 }, (_, i) =>
        Number.isNaN(f[i * 2]!) ? null : ([f[i * 2]!, f[i * 2 + 1]!] as PoolPos),
      );
    }
    return this.restBalls();
  }

  private draw(): void {
    const canvas = this.opts.canvas;
    const width = canvas.clientWidth || 272;
    const tr = poolTransform(width);
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(tr.height * dpr);
      canvas.style.height = `${tr.height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2b3138';
    ctx.fillRect(0, 0, width, tr.height);
    const now = this.opts.now();
    const v = this.view;
    const shot = v?.pool.shot;
    const moving = Boolean(shot && now < shot.t0 + shot.ms);
    const mine = this.myTurn && !moving;
    const calling = mine && this.onEightNow();
    drawTable(ctx, tr, this.call, calling && this.call === null);
    const balls = this.positions(now);
    // Linha-guia e taco de quem tem a vez; os outros veem o taco pela mira ao vivo.
    if (balls?.[0] && v?.phase === 'aim' && !moving) {
      if (mine) {
        drawGuide(ctx, tr, balls, this.aimDir);
        drawCue(ctx, tr, balls[0], this.aimDir, this.power);
      } else if (v.pool.aim) {
        const a = v.pool.aim;
        drawCue(ctx, tr, balls[0], [a.dx, a.dy], a.power);
      }
    }
    balls?.forEach((p, i) => p && drawBall(ctx, tr, p, i));
    // Bola na mão num lugar que não dá: um anel vermelho em volta da branca.
    if (mine && this.cuePos && balls && !canPlaceCue(balls, this.cuePos, v!.pool.breakShot)) {
      const c = tr.toPx(this.cuePos);
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, POOL.ballR * tr.s + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawPowerBar(ctx, tr, mine ? this.power : (v?.pool.aim?.power ?? 0), mine);
    this.dot.style.left = `${50 + this.spin.x * 40}%`;
    this.dot.style.top = `${50 - this.spin.y * 40}%`;
    this.opts.spin.classList.toggle('active', mine);
    const flash = this.flash.until > performance.now() ? this.flash.text : '';
    setText(this.opts.hint, mine ? flash || this.hintText(calling) : '');
    const left = Math.max(0, Math.ceil(((v?.pool.deadline ?? 0) - now) / 1000));
    const ticking = v?.status === 'playing' && v.phase === 'aim' && v.pool.deadline > 0;
    setText(this.opts.clock, ticking ? `⏱ ${left} s` : '');
    this.opts.clock.classList.toggle('low', ticking && left <= 10);
  }

  private hintText(calling: boolean): string {
    if (calling) {
      return this.call === null
        ? 'É a 8! Toque na caçapa onde ela vai cair; depois mire e puxe a barra.'
        : 'Caçapa cantada. Mire e puxe a barra para tacar.';
    }
    if (this.view?.pool.inHand) {
      return this.view.pool.breakShot
        ? 'Abertura: arraste a branca (atrás da linha), mire e puxe a barra.'
        : 'Bola na mão: arraste a branca, mire e puxe a barra.';
    }
    return 'Arraste na mesa para mirar, escolha o efeito e puxe a barra para tacar.';
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

type Tr = ReturnType<typeof poolTransform>;

function drawTable(
  ctx: CanvasRenderingContext2D,
  tr: Tr,
  call: number | null,
  pick: boolean,
): void {
  const a = tr.toPx([-RAIL, -RAIL]);
  const b = tr.toPx([POOL.tableL + RAIL, POOL.tableW + RAIL]);
  const felt0 = tr.toPx([0, 0]);
  const felt1 = tr.toPx([POOL.tableL, POOL.tableW]);
  ctx.fillStyle = '#1a1d22';
  roundRect(ctx, a.x - 2, a.y - 2, b.x - a.x + 4, b.y - a.y + 4, 10);
  ctx.fillStyle = '#efe6d2';
  roundRect(ctx, a.x, a.y, b.x - a.x, b.y - a.y, 9);
  ctx.fillStyle = '#b51f2e';
  ctx.fillRect(felt0.x, felt0.y, felt1.x - felt0.x, felt1.y - felt0.y);
  // Linha de saída e o ponto do triângulo.
  const head = tr.toPx([HEAD_X, 0]);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(head.x, felt0.y);
  ctx.lineTo(head.x, felt1.y);
  ctx.stroke();
  const spot = tr.toPx([(3 * POOL.tableL) / 4, POOL.tableW / 2]);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(spot.x, spot.y, 2, 0, Math.PI * 2);
  ctx.fill();
  // Marcas nas tabelas.
  ctx.fillStyle = '#c8a24a';
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue;
    const top = tr.toPx([(POOL.tableL * k) / 8, -RAIL / 2]);
    const bottom = tr.toPx([(POOL.tableL * k) / 8, POOL.tableW + RAIL / 2]);
    ctx.fillRect(top.x - 1.5, top.y - 1.5, 3, 3);
    ctx.fillRect(bottom.x - 1.5, bottom.y - 1.5, 3, 3);
  }
  // Caçapas: a cantada com um anel dourado; na vez da 8, todas piscam esperando o toque.
  const blink = pick && Math.floor(performance.now() / 500) % 2 === 0;
  POCKETS.forEach((k, i) => {
    const p = tr.toPx([k.x, k.y]);
    ctx.fillStyle = '#0e1013';
    ctx.beginPath();
    ctx.arc(p.x, p.y, k.r * tr.s * 0.95, 0, Math.PI * 2);
    ctx.fill();
    if (i === call || blink) {
      ctx.strokeStyle = i === call ? '#f2c14e' : 'rgba(242,193,78,0.6)';
      ctx.lineWidth = i === call ? 3 : 2;
      ctx.stroke();
    }
  });
}

/** Bola numerada: lisa (cheia), listrada (faixa) ou a branca; com o número num círculo. */
function drawBall(ctx: CanvasRenderingContext2D, tr: Tr, pos: PoolPos, ball: number): void {
  const p = tr.toPx(pos);
  const r = Math.max(4, POOL.ballR * tr.s);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = ball >= 9 ? COLORS[0]! : poolBallColor(ball);
  ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  if (ball >= 9) {
    ctx.fillStyle = poolBallColor(ball);
    ctx.fillRect(p.x - r, p.y - r * 0.55, 2 * r, r * 1.1);
  }
  if (ball > 0 && r >= 6) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.font = `700 ${Math.round(r * 0.72)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(ball), p.x, p.y + 0.5);
  }
  // Brilho para dar volume.
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(p.x - r * 0.35, p.y - r * 0.4, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Linha-guia: até a bola-fantasma, o caminho da bola acertada e o desvio da branca; ou o rebote. */
function drawGuide(ctx: CanvasRenderingContext2D, tr: Tr, balls: PoolBalls, dir: PoolPos): void {
  const guide = aimGuide(balls, dir);
  if (!guide) return;
  const cue = tr.toPx(balls[0]!);
  const end = tr.toPx(guide.kind === 'ball' ? guide.ghost : guide.point);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const line = (from: { x: number; y: number }, d: PoolPos, len: number, alpha: number) => {
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + d[0] * len * tr.s, from.y + d[1] * len * tr.s);
    ctx.stroke();
  };
  if (guide.kind === 'ball') {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(end.x, end.y, POOL.ballR * tr.s, 0, Math.PI * 2);
    ctx.stroke();
    line(tr.toPx(balls[guide.ball]!), guide.objectDir, 0.3, 0.9);
    line(end, guide.cueDir, 0.18, 0.45);
  } else {
    line(end, guide.bounce, 0.2, 0.45);
  }
}

/** Taco atrás da branca, recuando com a força. */
function drawCue(
  ctx: CanvasRenderingContext2D,
  tr: Tr,
  cue: PoolPos,
  dir: PoolPos,
  power: number,
): void {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / len;
  const uy = dir[1] / len;
  const p = tr.toPx(cue);
  const gap = (POOL.ballR * 1.6 + power * 0.25) * tr.s;
  const stick = 1.1 * tr.s;
  const sx = p.x - ux * gap;
  const sy = p.y - uy * gap;
  const segment = (from: number, to: number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, width * tr.s);
    ctx.beginPath();
    ctx.moveTo(sx - ux * from, sy - uy * from);
    ctx.lineTo(sx - ux * to, sy - uy * to);
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  segment(stick * 0.45, stick, '#5b3a1e', 0.022);
  segment(0, stick * 0.45, '#d9b77c', 0.016);
  segment(0, 4, '#2f6fe4', 0.014);
  ctx.lineCap = 'butt';
}

/** Barra de força: puxe para baixo e solte para tacar. */
function drawPowerBar(ctx: CanvasRenderingContext2D, tr: Tr, power: number, active: boolean): void {
  const b = tr.bar;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, b.x, b.y, b.w, b.h, 6);
  const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  grad.addColorStop(0, '#3fbf6f');
  grad.addColorStop(0.6, '#f2c14e');
  grad.addColorStop(1, '#e05555');
  ctx.fillStyle = grad;
  ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, Math.max(0, (b.h - 6) * power));
  ctx.strokeStyle = active ? '#f2c14e' : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = active ? 2 : 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
