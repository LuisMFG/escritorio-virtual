import {
  ARCADE_SLOTS,
  ballAt,
  canHit,
  clampPaddle,
  hitBall,
  PONG,
  serveBall,
  sideOf,
  simulate,
  type ArcadeReply,
  type ArcadeSlot,
  type ArcadeView,
  type PongBall,
  type PongPoint,
} from '@office/shared';

/** Folga em volta da zona das raquetes, para a raquete no limite aparecer inteira (com o cabo). */
const PAD = 0.2;
/** Área desenhada (em metros): a mesa e a zona das raquetes atrás e dos lados dela. */
const VIEW_W = PONG.tableL + 2 * (PONG.zoneBack + PAD);
const VIEW_H = PONG.tableW + 2 * (PONG.zoneSide + PAD);
/** De quanto em quanto tempo a posição da raquete vai para o servidor. */
const PADDLE_EVERY_MS = 50;

export interface PongViewOptions {
  canvas: HTMLCanvasElement;
  /** Hora do servidor (ms). */
  now: () => number;
  /** A minha vaga nesta mesa (`null` = assistindo). */
  mySlot: () => ArcadeSlot | null;
  paddle(p: PongPoint): void;
  serve(msg: PongPoint & { t: number }): Promise<ArcadeReply>;
  hit(msg: PongPoint & { t: number; vx: number; vy: number }): Promise<ArcadeReply>;
  /** Atraso simulado (ida e volta, ms), para testar como fica com ping alto (`?atraso=150`). */
  lag?: number;
}

/** Converte entre o canvas (px de CSS) e a mesa (metros). */
export function courtTransform(width: number) {
  const s = width / VIEW_W;
  const ox = (PONG.zoneBack + PAD) * s;
  const oy = (PONG.zoneSide + PAD) * s;
  return {
    s,
    height: VIEW_H * s,
    toPx: (p: PongPoint) => ({ x: ox + p.x * s, y: oy + p.y * s }),
    toTable: (x: number, y: number): PongPoint => ({ x: (x - ox) / s, y: (y - oy) / s }),
  };
}

/**
 * Mesa de ping-pong ao vivo (Fase 58), vista de cima: a bola calculada aqui a partir do trecho
 * que o servidor mandou (na hora do servidor, sem receber a posição a cada quadro), as raquetes
 * de todo mundo e a minha, que segue o mouse ou o dedo na hora. Quem joga saca clicando e
 * rebate encostando a raquete na bola: a rebatida aparece já e o servidor confirma.
 */
export class PongView {
  private view: ArcadeView | null = null;
  /** O trecho da bola que o servidor mandou, e o meu saque ou rebatida antes da confirmação. */
  private serverBall: PongBall | null = null;
  private predicted: PongBall | null = null;
  /** Já pedi a rebatida desta bola (uma por vez). */
  private claimed: number | null = null;
  private pointer: PongPoint | null = null;
  private samples: { t: number; x: number; y: number }[] = [];
  private lastSent = 0;
  private readonly shown = new Map<ArcadeSlot, PongPoint>();
  private raf = 0;
  private readonly half: number;

  constructor(private readonly opts: PongViewOptions) {
    this.half = Math.max(0, (opts.lag ?? 0) / 2);
    const c = opts.canvas;
    // A mesa ao vivo ocupa a largura do painel (a vista parada tinha largura fixa).
    c.style.width = '100%';
    c.style.touchAction = 'none';
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointerleave', this.onLeave);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    const c = this.opts.canvas;
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointerleave', this.onLeave);
    c.style.touchAction = '';
    c.style.width = '';
    c.style.height = '';
  }

  /** O estado da mesa mudou (com o atraso simulado, chega depois). */
  update(view: ArcadeView): void {
    const apply = () => {
      this.view = view;
      const ball = view.ball;
      const changed = ball?.t0 !== this.serverBall?.t0 || ball?.by !== this.serverBall?.by;
      this.serverBall = ball;
      if (changed) {
        // Chegou a confirmação (ou outra bola): a previsão sai e dá para rebater de novo.
        this.predicted = null;
        this.claimed = null;
      }
    };
    if (this.half) window.setTimeout(apply, this.half);
    else apply();
  }

  /** Pedido que demora o atraso simulado para sair. */
  private later<T>(run: () => Promise<T>): Promise<T> {
    if (!this.half) return run();
    return new Promise((resolve) => window.setTimeout(() => resolve(run()), this.half));
  }

  private get side() {
    const slot = this.opts.mySlot();
    return slot ? sideOf(slot) : null;
  }

  private readonly onMove = (e: PointerEvent): void => {
    const side = this.side;
    if (!side || this.view?.status !== 'playing') return;
    const r = this.opts.canvas.getBoundingClientRect();
    const tr = courtTransform(r.width);
    const p = clampPaddle(side, tr.toTable(e.clientX - r.left, e.clientY - r.top));
    this.pointer = p;
    const t = this.opts.now();
    this.samples.push({ t, ...p });
    while (this.samples.length > 2 && t - this.samples[0]!.t > 120) this.samples.shift();
    if (t - this.lastSent >= PADDLE_EVERY_MS) {
      this.lastSent = t;
      if (this.half) window.setTimeout(() => this.opts.paddle(p), this.half);
      else this.opts.paddle(p);
    }
  };

  private readonly onLeave = (): void => {
    this.samples = [];
  };

  /** Clique (ou toque): saca, se for a minha vez. */
  private readonly onDown = (e: PointerEvent): void => {
    this.onMove(e);
    const slot = this.opts.mySlot();
    const v = this.view;
    if (!slot || !v || v.phase !== 'serve' || v.turn !== slot || !this.pointer) return;
    const t = this.opts.now();
    const p = this.pointer;
    this.predicted = serveBall(sideOf(slot), p, t);
    this.claimed = null;
    void this.later(() => this.opts.serve({ t, ...p })).then((res) => {
      if (!res.ok) this.predicted = null;
    });
  };

  /** Velocidade da raquete (m/s) nos últimos instantes. */
  private velocity(): PongPoint {
    const a = this.samples[0];
    const b = this.samples.at(-1);
    if (!a || !b || b.t - a.t < 10) return { x: 0, y: 0 };
    const dt = (b.t - a.t) / 1000;
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }

  /** A bola agora: a prevista (meu saque ou rebatida) ou a do servidor, até onde o tempo chegou. */
  private ballNow(now: number) {
    const base = this.predicted ?? (this.view?.phase === 'serve' ? null : this.serverBall);
    if (!base) return null;
    const sim = simulate(base, now, true);
    return sim.ball ? { seg: sim.ball, at: ballAt(sim.ball, now) } : null;
  }

  /** Encostou a raquete na bola que quicou do meu lado: rebate (aparece já). */
  private tryHit(now: number): void {
    const side = this.side;
    const base = this.predicted ?? this.serverBall;
    if (!side || !base || !this.pointer || this.view?.phase !== 'rally') return;
    if (this.claimed === base.t0) return;
    const sim = simulate(base, now);
    if (sim.point || !sim.ball) return;
    const at = ballAt(sim.ball, now);
    if (!canHit(sim.ball, at, side, this.pointer)) return;
    const p = this.pointer;
    const v = this.velocity();
    this.claimed = base.t0;
    this.predicted = hitBall(at, p, v, side, sim.ball.hits, now);
    const before = this.predicted;
    void this.later(() => this.opts.hit({ t: now, x: p.x, y: p.y, vx: v.x, vy: v.y })).then(
      (res) => {
        if (!res.ok && this.predicted === before) this.predicted = null;
      },
    );
  }

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    const now = this.opts.now();
    this.tryHit(now);
    this.draw(now);
  };

  private draw(now: number): void {
    const canvas = this.opts.canvas;
    const width = canvas.clientWidth || 272;
    const tr = courtTransform(width);
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
    drawTable(ctx, tr);

    const v = this.view;
    const mine = this.opts.mySlot();
    // Raquetes: a minha na hora; as dos outros, suavizadas.
    const paddles: { slot: ArcadeSlot; p: PongPoint }[] = [];
    if (v) {
      for (const slot of ARCADE_SLOTS) {
        if (!v.seats[slot].session || (v.mode === 1 && slot.endsWith('2'))) continue;
        const target = slot === mine && this.pointer ? this.pointer : v.paddles[slot];
        const prev = this.shown.get(slot);
        const p =
          slot === mine || !prev
            ? target
            : { x: prev.x + (target.x - prev.x) * 0.35, y: prev.y + (target.y - prev.y) * 0.35 };
        this.shown.set(slot, p);
        paddles.push({ slot, p });
      }
    }
    // Bola: no saque, na raquete de quem saca; em jogo, onde o tempo chegou.
    const serving =
      !this.predicted && v?.phase === 'serve' && v.turn ? this.shown.get(v.turn) : undefined;
    const ball = this.ballNow(now);
    if (serving)
      drawBall(ctx, tr, {
        x: serving.x + (v!.turn.startsWith('a') ? 0.12 : -0.12),
        y: serving.y,
        h: 0.25,
      });
    else if (ball && ball.at.h > -PONG.tableH + 0.01) drawBall(ctx, tr, ball.at);
    for (const { slot, p } of paddles) drawPaddle(ctx, tr, slot, p, slot === mine);
    if (v?.phase === 'serve' && mine && v.turn === mine) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Clique para sacar', width / 2, 14);
    }
  }
}

function drawTable(ctx: CanvasRenderingContext2D, tr: ReturnType<typeof courtTransform>): void {
  const a = tr.toPx({ x: 0, y: 0 });
  const b = tr.toPx({ x: PONG.tableL, y: PONG.tableW });
  const w = b.x - a.x;
  const h = b.y - a.y;
  ctx.fillStyle = '#1a1d22';
  ctx.fillRect(a.x - 2, a.y - 2, w + 4, h + 4);
  ctx.fillStyle = '#2a64b0';
  ctx.fillRect(a.x, a.y, w, h);
  ctx.strokeStyle = '#eef3f8';
  ctx.lineWidth = 2;
  ctx.strokeRect(a.x + 2, a.y + 2, w - 4, h - 4);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x + 2, a.y + h / 2);
  ctx.lineTo(b.x - 2, a.y + h / 2);
  ctx.stroke();
  // Rede no meio, um pouco para fora da mesa, com os postes.
  const nx = a.x + w / 2;
  ctx.fillStyle = '#f7f9fb';
  ctx.fillRect(nx - 1.5, a.y - 8, 3, h + 16);
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(nx - 3, a.y - 11, 6, 5);
  ctx.fillRect(nx - 3, b.y + 6, 6, 5);
}

/** Bola onde ela está; a sombra se afasta e a bola cresce quanto mais alta ela vai. */
function drawBall(
  ctx: CanvasRenderingContext2D,
  tr: ReturnType<typeof courtTransform>,
  b: PongPoint & { h: number },
): void {
  const p = tr.toPx(b);
  const r = Math.max(4, PONG.ballR * tr.s) * (1 + Math.max(0, b.h) * 0.5);
  const lift = Math.max(0, b.h + 0.05) * tr.s * 0.18;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(p.x + lift, p.y + lift, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9ced6';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Raquete: borracha vermelha (lado A) ou preta (lado B), com o cabo para o lado de quem joga. */
function drawPaddle(
  ctx: CanvasRenderingContext2D,
  tr: ReturnType<typeof courtTransform>,
  slot: ArcadeSlot,
  pos: PongPoint,
  mine: boolean,
): void {
  const p = tr.toPx(pos);
  const r = Math.max(9, PONG.paddleR * tr.s);
  const dir = slot.startsWith('a') ? -1 : 1;
  ctx.strokeStyle = '#a0773f';
  ctx.lineWidth = Math.max(3, r * 0.4);
  ctx.beginPath();
  ctx.moveTo(p.x + dir * r * 0.7, p.y);
  ctx.lineTo(p.x + dir * r * 1.6, p.y);
  ctx.stroke();
  ctx.fillStyle = slot.startsWith('a') ? '#d2393a' : '#24272d';
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = mine ? '#f2c14e' : 'rgba(255,255,255,0.6)';
  ctx.lineWidth = mine ? 2 : 1;
  ctx.stroke();
}
