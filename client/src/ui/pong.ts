import {
  ARCADE_CPU_SESSION,
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
  type PongSide,
} from '@office/shared';

/** Folga em volta da zona das raquetes, para a raquete no limite aparecer inteira (com o cabo). */
const PAD = 0.2;
/** Área desenhada (em metros): a mesa e a zona das raquetes atrás e dos lados dela. */
const VIEW_W = PONG.tableL + 2 * (PONG.zoneBack + PAD);
const VIEW_H = PONG.tableW + 2 * (PONG.zoneSide + PAD);
/** De quanto em quanto tempo a posição da raquete vai para o servidor. */
const PADDLE_EVERY_MS = 50;
/** Velocidade (m/s) com que a raquete avança ou volta para ficar onde a bola dá para rebater. */
const DEPTH_SPEED = 3;
/** Quantas rebatidas a pessoa precisa dar para a dica sumir de vez. */
const TIP_HITS = 3;
const TIP_KEY = 'ev-pingpong-dica';
const NET_X = PONG.tableL / 2;

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

/** Converte entre o canvas (px de CSS) e a mesa (metros), na vista de cima (quem assiste). */
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

// ---------- Vista de quem joga (perspectiva) ----------

/** Câmera atrás da própria linha de fundo: distância (m) e altura. */
const CAM_BACK = 2.6;
const CAM_H = 1.25;
/** O topo da imagem mostra a bola até esta altura sobre o fundo da mesa do outro lado. */
const TOP_H = 0.75;

/**
 * Perspectiva de quem joga: a mesa vista do próprio lado, com a rede no meio e o adversário lá no
 * fundo. Esquerda e direita da tela são a esquerda e a direita de quem joga, e a bola sobe de
 * verdade (com a sombra no tampo). Projeção simples de câmera (sem biblioteca).
 */
export function perspective(side: PongSide, width: number) {
  const W = PONG.tableW;
  const L = PONG.tableL;
  const f = (0.85 * width * CAM_BACK) / W;
  const cx = width / 2;
  /** Distância da minha linha de fundo, em direção ao outro lado. */
  const depth = (x: number) => (side === 'a' ? x : L - x);
  /** Para a direita de quem joga (o lado A olha para x crescente). */
  const across = (y: number) => (side === 'a' ? y - W / 2 : W / 2 - y);
  const scaleAt = (d: number) => f / Math.max(0.05, d + CAM_BACK);
  const home = -PONG.homeBack;
  // O alto da imagem: a bola a `TOP_H` sobre o fundo de lá fica a 30 px do topo.
  const horizon = 30 - (CAM_H - TOP_H) * scaleAt(L);
  // Embaixo, até a minha raquete inteira (com o cabo).
  const paddleK = scaleAt(home);
  const height = Math.round(horizon + (CAM_H - 0.12) * paddleK + PONG.paddleR * paddleK * 1.8);
  return {
    height,
    scaleAt,
    depth,
    /** Ponto da mesa (x, y e altura) na tela. */
    toPx: (x: number, y: number, h = 0) => {
      const k = scaleAt(depth(x));
      return { x: cx + across(y) * k, y: horizon + (CAM_H - h) * k, k };
    },
    /** O y da mesa na altura da raquete para um x da tela (o mouse aponta para os lados). */
    lateralAt: (sx: number) => {
      const u = (sx - cx) / scaleAt(home);
      return side === 'a' ? u + W / 2 : W / 2 - u;
    },
    /** Quantos metros para o lado cada px arrastado vale, na altura da raquete. */
    metersPerPx: 1 / scaleAt(home),
  };
}

// ---------- Ajuda de quem joga (funções puras, testadas) ----------

/** Onde a raquete fica parada esperando: um pouco atrás da linha de fundo. */
export function homeX(side: PongSide): number {
  return side === 'a' ? -PONG.homeBack : PONG.tableL + PONG.homeBack;
}

/**
 * Até onde a raquete vai na direção da mesa para pegar esta bola: o ponto da trajetória (do meu
 * lado, depois do quique) mais perto do lugar de espera em que a bola está numa altura que dá. Sem
 * bola vindo para mim, o lugar de espera.
 */
export function interceptX(seg: PongBall | null, side: PongSide, now: number): number {
  const home = homeX(side);
  if (!seg || seg.by === side) return home;
  let best = home;
  let bestD = Infinity;
  for (let t = now; t < now + 3000; t += 20) {
    const sim = simulate(seg, t);
    if (sim.point || !sim.ball) break;
    if ((side === 'a' ? sim.ball.na : sim.ball.nb) !== 1) continue;
    const at = ballAt(sim.ball, t);
    if (at.h > PONG.reachUp - 0.05 || at.h < PONG.reachDown + 0.05) continue;
    const x = clampPaddle(side, at).x;
    if (Math.abs(x - at.x) > 0.01) continue; // fora da zona da raquete
    const d = Math.abs(x - home);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return best;
}

/** O "ímã": perto da bola, a raquete é puxada até ela (no máximo `magnetSpeed` m/s). */
export function magnetY(paddleY: number, ballY: number, dtMs: number): number {
  const dy = ballY - paddleY;
  if (Math.abs(dy) > PONG.magnetR) return paddleY;
  const step = (PONG.magnetSpeed * dtMs) / 1000;
  return Math.abs(dy) <= step ? ballY : paddleY + Math.sign(dy) * step;
}

/**
 * Rebatida do outro que chegou atrasada (ping): o tempo que a tela mostra começa no instante em que
 * ela chegou (a bola sai de onde estava) e alcança o tempo de verdade em `catchupMs`.
 */
export function catchupTime(now: number, arrivedAt: number, late: number): number {
  const k = Math.min(1, Math.max(0, (now - arrivedAt) / PONG.catchupMs));
  return now - late * (1 - k);
}

// ---------- A mesa ao vivo ----------

/** Mesa de cada painel aberto (para os testes acharem a vista). */
export const pongViews = new WeakMap<HTMLCanvasElement, PongView>();

/**
 * Mesa de ping-pong ao vivo (Fase 58). Quem joga vê a mesa em perspectiva, do próprio lado, e só
 * controla para que lado a raquete vai (mouse em qualquer lugar, dedo arrastando em qualquer
 * lugar, ou ←/→ e A/D): ela avança sozinha até onde a bola dá para rebater e rebate ao encostar,
 * com um ímã quando chega perto. O saque sai sozinho depois de uns segundos (ou no clique, espaço
 * ou Enter). Quem assiste vê de cima. A bola é calculada aqui a partir do trecho que o servidor
 * mandou, na hora do servidor; a minha rebatida aparece já e o servidor confirma.
 */
export class PongView {
  private view: ArcadeView | null = null;
  /** O trecho da bola que o servidor mandou, e o meu saque ou rebatida antes da confirmação. */
  private serverBall: PongBall | null = null;
  private predicted: PongBall | null = null;
  /** Já pedi a rebatida desta bola (uma por vez). */
  private claimed: number | null = null;
  /** A minha raquete (metros): `y` vem do controle; `x` avança sozinho. */
  private paddle: PongPoint | null = null;
  /** Para onde o controle manda a raquete (para os lados). */
  private targetY: number | null = null;
  private samples: { t: number; y: number }[] = [];
  private lastSent = 0;
  private lastFrame = 0;
  /** Teclas de lado apertadas agora (-1, 0 ou 1). */
  private keyDir = 0;
  /** Dedo arrastando: de onde (px) e a raquete naquele momento. */
  private touch: { x: number; y: number } | null = null;
  /** Desde quando é a minha vez de sacar (para o saque sozinho). */
  private serveSince = 0;
  /** Rebatida do outro que chegou atrasada: quando chegou e quanto atrasou (ms). */
  private catchup: { t0: number; arrivedAt: number; late: number } | null = null;
  private readonly shown = new Map<ArcadeSlot, PongPoint>();
  private raf = 0;
  private readonly half: number;
  private tipHits: number;

  constructor(private readonly opts: PongViewOptions) {
    this.half = Math.max(0, (opts.lag ?? 0) / 2);
    this.tipHits = readTipHits();
    const c = opts.canvas;
    // A mesa ao vivo ocupa a largura do painel (a vista parada tinha largura fixa).
    c.style.width = '100%';
    c.style.touchAction = 'none';
    c.tabIndex = 0;
    c.setAttribute(
      'aria-label',
      'Mesa de ping-pong: mexa o mouse ou as setas para os lados; espaço saca',
    );
    window.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    pongViews.set(c, this);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    const c = this.opts.canvas;
    window.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    pongViews.delete(c);
    c.style.touchAction = '';
    c.style.width = '';
    c.style.height = '';
    c.removeAttribute('tabindex');
    c.removeAttribute('aria-label');
  }

  /** O estado da mesa mudou (com o atraso simulado, chega depois). */
  update(view: ArcadeView): void {
    const apply = () => {
      this.view = view;
      const ball = view.ball;
      const changed = ball?.t0 !== this.serverBall?.t0 || ball?.by !== this.serverBall?.by;
      this.serverBall = ball;
      if (changed) {
        // Rebatida do outro (ou saque) que já começou há um tempo: a tela alcança aos poucos.
        const now = this.opts.now();
        const late = ball ? now - ball.t0 : 0;
        const mine = this.side && ball?.by === this.side;
        this.catchup = ball && !mine && late > 40 ? { t0: ball.t0, arrivedAt: now, late } : null;
        // Chegou a confirmação (ou outra bola): a previsão sai e dá para rebater de novo.
        this.predicted = null;
        this.claimed = null;
      }
    };
    if (this.half) window.setTimeout(apply, this.half);
    else apply();
  }

  /** Ponto da mesa na tela (px da página), como esta pessoa vê (para os testes). */
  screenPoint(x: number, y: number, h = 0): { x: number; y: number } {
    const r = this.opts.canvas.getBoundingClientRect();
    const side = this.side;
    const p = side
      ? perspective(side, r.width).toPx(x, y, h)
      : courtTransform(r.width).toPx({ x, y });
    return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
  }

  /** Pedido que demora o atraso simulado para sair. */
  private later<T>(run: () => Promise<T>): Promise<T> {
    if (!this.half) return run();
    return new Promise((resolve) => window.setTimeout(() => resolve(run()), this.half));
  }

  private get side(): PongSide | null {
    const slot = this.opts.mySlot();
    return slot ? sideOf(slot) : null;
  }

  private get playing(): boolean {
    return Boolean(this.side && this.view?.status === 'playing');
  }

  // ---------- Controles ----------

  /** Mouse em qualquer lugar da tela: a raquete vai para o lado que ele aponta. */
  private readonly onMove = (e: PointerEvent): void => {
    const side = this.side;
    if (!side || !this.playing) return;
    const r = this.opts.canvas.getBoundingClientRect();
    if (e.pointerType === 'mouse') {
      this.targetY = perspective(side, r.width).lateralAt(e.clientX - r.left);
    } else if (this.touch && this.paddle) {
      // Dedo: arrasta em qualquer lugar (sem cobrir a bola), e a raquete anda junto.
      const dx = (e.clientX - this.touch.x) * perspective(side, r.width).metersPerPx;
      this.touch = { x: e.clientX, y: e.clientY };
      this.targetY = (this.targetY ?? this.paddle.y) + (side === 'a' ? dx : -dx);
    }
  };

  /** Clique ou toque: saca (se for a minha vez); o dedo começa a arrastar. */
  private readonly onDown = (e: PointerEvent): void => {
    if (!this.playing) return;
    if (e.pointerType !== 'mouse') this.touch = { x: e.clientX, y: e.clientY };
    else this.onMove(e);
    this.tryServe();
  };

  private readonly onUp = (): void => {
    this.touch = null;
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.playing || isTyping(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') this.keyDir = -1;
    else if (k === 'arrowright' || k === 'd') this.keyDir = 1;
    else if (k === ' ' || k === 'enter') this.tryServe();
    else return;
    e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if ((k === 'arrowleft' || k === 'a') && this.keyDir < 0) this.keyDir = 0;
    if ((k === 'arrowright' || k === 'd') && this.keyDir > 0) this.keyDir = 0;
  };

  /** Saca, se for a minha vez. */
  private tryServe(): void {
    const slot = this.opts.mySlot();
    const v = this.view;
    if (!slot || !v || v.phase !== 'serve' || v.turn !== slot || !this.paddle || this.predicted) {
      return;
    }
    const t = this.opts.now();
    const p = { ...this.paddle };
    this.predicted = serveBall(sideOf(slot), p, t);
    this.claimed = null;
    this.serveSince = 0;
    void this.later(() => this.opts.serve({ t, ...p })).then((res) => {
      if (!res.ok) this.predicted = null;
    });
  }

  /** Velocidade da raquete para os lados (m/s) nos últimos instantes. */
  private velocity(): PongPoint {
    const a = this.samples[0];
    const b = this.samples.at(-1);
    if (!a || !b || b.t - a.t < 10) return { x: 0, y: 0 };
    return { x: 0, y: (b.y - a.y) / ((b.t - a.t) / 1000) };
  }

  /** Anda a minha raquete um quadro: lado pelo controle (e o ímã), frente pela bola. */
  private movePaddle(now: number, dtMs: number): void {
    const side = this.side;
    if (!side || !this.playing) {
      this.paddle = null;
      return;
    }
    const v = this.view!;
    const slot = this.opts.mySlot()!;
    const start = v.paddles[slot] ?? { x: homeX(side), y: PONG.tableW / 2 };
    const p = this.paddle ?? { x: homeX(side), y: start.y || PONG.tableW / 2 };
    if (this.keyDir) {
      this.targetY =
        (this.targetY ?? p.y) +
        (side === 'a' ? 1 : -1) * this.keyDir * PONG.lateralSpeed * (dtMs / 1000);
    }
    let y = this.targetY ?? p.y;
    // Ímã: com a bola do meu lado e ao alcance, a raquete é puxada até ela.
    const ball = this.ballNow(now);
    const bounced = ball && (side === 'a' ? ball.seg.na : ball.seg.nb) === 1;
    if (
      ball &&
      bounced &&
      v.phase === 'rally' &&
      ball.seg.by !== side &&
      Math.abs(ball.at.x - p.x) < PONG.magnetNear
    ) {
      const pulled = magnetY(y, ball.at.y, dtMs);
      if (pulled !== y) this.targetY = y = pulled;
    }
    const seg = v.phase === 'rally' ? (this.predicted ?? this.serverBall) : null;
    const wantX = interceptX(seg, side, now);
    const stepX = (DEPTH_SPEED * dtMs) / 1000;
    const x = Math.abs(wantX - p.x) <= stepX ? wantX : p.x + Math.sign(wantX - p.x) * stepX;
    this.paddle = clampPaddle(side, { x, y });
    if (this.targetY !== null) this.targetY = this.paddle.y;
    this.samples.push({ t: now, y: this.paddle.y });
    while (this.samples.length > 2 && now - this.samples[0]!.t > 120) this.samples.shift();
    if (now - this.lastSent >= PADDLE_EVERY_MS) {
      this.lastSent = now;
      const sent = { ...this.paddle };
      if (this.half) window.setTimeout(() => this.opts.paddle(sent), this.half);
      else this.opts.paddle(sent);
    }
  }

  /** A bola agora: a prevista (meu saque ou rebatida) ou a do servidor, até onde o tempo chegou. */
  private ballNow(now: number) {
    const base = this.predicted ?? (this.view?.phase === 'serve' ? null : this.serverBall);
    if (!base) return null;
    const sim = simulate(base, now, true);
    return sim.ball ? { seg: sim.ball, at: ballAt(sim.ball, now) } : null;
  }

  /** O tempo que a tela mostra: o de verdade, ou alcançando depois de uma rebatida atrasada. */
  private shownTime(now: number): number {
    const c = this.catchup;
    if (!c || this.predicted || c.t0 !== this.serverBall?.t0) return now;
    if (now - c.arrivedAt >= PONG.catchupMs) {
      this.catchup = null;
      return now;
    }
    return catchupTime(now, c.arrivedAt, c.late);
  }

  /** A bola que quicou do meu lado encostou na raquete: rebate (aparece já). */
  private tryHit(now: number): void {
    const side = this.side;
    const base = this.predicted ?? this.serverBall;
    if (!side || !base || !this.paddle || this.view?.phase !== 'rally') return;
    if (this.claimed === base.t0) return;
    const sim = simulate(base, now);
    if (sim.point || !sim.ball) return;
    const at = ballAt(sim.ball, now);
    if (!canHit(sim.ball, at, side, this.paddle)) return;
    const p = this.paddle;
    const v = this.velocity();
    this.claimed = base.t0;
    this.predicted = hitBall(at, p, v, side, sim.ball.hits, now);
    const before = this.predicted;
    if (this.tipHits < TIP_HITS) saveTipHits(++this.tipHits);
    void this.later(() => this.opts.hit({ t: now, x: p.x, y: p.y, vx: v.x, vy: v.y })).then(
      (res) => {
        if (!res.ok && this.predicted === before) this.predicted = null;
      },
    );
  }

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    const now = this.opts.now();
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 16;
    this.lastFrame = now;
    this.movePaddle(now, dt);
    this.autoServe(now);
    this.tryHit(now);
    this.draw(now);
  };

  /** Saque sozinho depois de uns segundos na minha vez. */
  private autoServe(now: number): void {
    const v = this.view;
    const mine = this.opts.mySlot();
    if (!v || !mine || v.phase !== 'serve' || v.turn !== mine || this.predicted) {
      this.serveSince = 0;
      return;
    }
    this.serveSince ||= now;
    if (now - this.serveSince >= PONG.autoServeMs) this.tryServe();
  }

  // ---------- Desenho ----------

  private draw(now: number): void {
    const canvas = this.opts.canvas;
    const width = canvas.clientWidth || 272;
    const side = this.side;
    const height = side ? perspective(side, width).height : courtTransform(width).height;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = this.view;
    const mine = this.opts.mySlot();
    // Raquetes: a minha na hora; as dos outros, suavizadas.
    const paddles: { slot: ArcadeSlot; p: PongPoint }[] = [];
    if (v) {
      for (const slot of ARCADE_SLOTS) {
        if (!v.seats[slot].session || (v.mode === 1 && slot.endsWith('2'))) continue;
        const target = slot === mine && this.paddle ? this.paddle : v.paddles[slot];
        const prev = this.shown.get(slot);
        const p =
          slot === mine || !prev
            ? target
            : { x: prev.x + (target.x - prev.x) * 0.35, y: prev.y + (target.y - prev.y) * 0.35 };
        this.shown.set(slot, p);
        paddles.push({ slot, p });
      }
    }
    // Bola: no saque, na raquete de quem saca; em jogo, onde o tempo (mostrado) chegou.
    const serving =
      !this.predicted && v?.phase === 'serve' && v.turn ? this.shown.get(v.turn) : undefined;
    const shown = this.ballNow(this.shownTime(now));
    const ball = serving
      ? { x: serving.x + (v!.turn.startsWith('a') ? 0.12 : -0.12), y: serving.y, h: 0.25 }
      : shown && shown.at.h > -PONG.tableH + 0.01
        ? shown.at
        : null;
    if (side) this.drawPerspective(ctx, width, height, side, paddles, ball, mine);
    else this.drawTop(ctx, width, paddles, ball, mine);
    this.drawHelp(ctx, width, now);
  }

  /** Dica no alto da mesa: o saque (com a contagem) e, nas primeiras partidas, como jogar. */
  private drawHelp(ctx: CanvasRenderingContext2D, width: number, now: number): void {
    const v = this.view;
    const mine = this.opts.mySlot();
    if (!v || !mine || v.status !== 'playing') return;
    let text = '';
    if (v.phase === 'serve' && v.turn === mine && !this.predicted) {
      const left = Math.max(1, Math.ceil((PONG.autoServeMs - (now - this.serveSince)) / 1000));
      text = `Saque sozinho em ${left} s`;
    } else if (this.tipHits < TIP_HITS) {
      text =
        'Mexa o mouse para os lados (ou ←/→). A raquete rebate sozinha; no centro sai mais forte.';
    }
    if (!text) return;
    ctx.font = '600 12px system-ui, sans-serif';
    const w = Math.min(width - 16, ctx.measureText(text).width + 16);
    ctx.fillStyle = 'rgba(16,18,22,0.75)';
    ctx.fillRect((width - w) / 2, 4, w, 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, 14, width - 24);
  }

  /** Vista de quem joga: a mesa do próprio lado, em perspectiva. */
  private drawPerspective(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    side: PongSide,
    paddles: { slot: ArcadeSlot; p: PongPoint }[],
    ball: { x: number; y: number; h: number } | null,
    mine: ArcadeSlot | null,
  ): void {
    const pr = perspective(side, width);
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#1d2128');
    sky.addColorStop(1, '#2f3540');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    const L = PONG.tableL;
    const W = PONG.tableW;
    const poly = (pts: { x: number; y: number }[], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    };
    // O lado de lá e o de cá (na tela, o de cá fica embaixo).
    const near = side === 'a' ? 0 : L;
    const far = side === 'a' ? L : 0;
    const c = (x: number, y: number, h = 0) => pr.toPx(x, y, h);
    // Tampo, a borda da frente (a grossura) e as linhas.
    poly([c(near, 0, -0.04), c(near, W, -0.04), c(near, W), c(near, 0)], '#173c6a');
    poly([c(near, 0), c(near, W), c(far, W), c(far, 0)], '#2a64b0');
    ctx.strokeStyle = '#eef3f8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of [
      [c(near, 0), c(near, W)],
      [c(far, 0), c(far, W)],
      [c(near, 0), c(far, 0)],
      [c(near, W), c(far, W)],
    ] as const) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    const m0 = c(near, W / 2);
    const m1 = c(far, W / 2);
    ctx.moveTo(m0.x, m0.y);
    ctx.lineTo(m1.x, m1.y);
    ctx.stroke();
    const drawNet = () => {
      poly(
        [
          c(NET_X, -0.15),
          c(NET_X, W + 0.15),
          c(NET_X, W + 0.15, PONG.netH),
          c(NET_X, -0.15, PONG.netH),
        ],
        'rgba(240,244,248,0.55)',
      );
      ctx.strokeStyle = '#f7f9fb';
      ctx.lineWidth = 2;
      const t0 = c(NET_X, -0.15, PONG.netH);
      const t1 = c(NET_X, W + 0.15, PONG.netH);
      ctx.beginPath();
      ctx.moveTo(t0.x, t0.y);
      ctx.lineTo(t1.x, t1.y);
      ctx.stroke();
    };
    const ballDepth = ball ? pr.depth(ball.x) : 0;
    // De trás para a frente: o adversário, a bola do lado de lá, a rede, a bola do lado de cá, eu.
    const theirs = paddles.filter((q) => sideOf(q.slot) !== side);
    const ours = paddles.filter((q) => sideOf(q.slot) === side);
    for (const q of theirs) this.paddle3d(ctx, pr, q.slot, q.p, false);
    if (ball && ballDepth > pr.depth(NET_X)) this.ball3d(ctx, pr, ball);
    drawNet();
    if (ball && ballDepth <= pr.depth(NET_X)) this.ball3d(ctx, pr, ball);
    for (const q of ours) this.paddle3d(ctx, pr, q.slot, q.p, q.slot === mine);
  }

  private ball3d(
    ctx: CanvasRenderingContext2D,
    pr: ReturnType<typeof perspective>,
    b: { x: number; y: number; h: number },
  ): void {
    const overTable = b.x >= 0 && b.x <= PONG.tableL && b.y >= 0 && b.y <= PONG.tableW;
    if (overTable && b.h >= 0) {
      // Sombra no tampo: fica embaixo da bola e a bola sobe em cima dela.
      const s = pr.toPx(b.x, b.y, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, PONG.ballR * s.k * 1.2, PONG.ballR * s.k * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const p = pr.toPx(b.x, b.y, b.h);
    const r = Math.max(2.5, PONG.ballR * p.k);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c9ced6';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Raquete em pé, de frente: borracha vermelha (lado A) ou preta (B), com o cabo para baixo. */
  private paddle3d(
    ctx: CanvasRenderingContext2D,
    pr: ReturnType<typeof perspective>,
    slot: ArcadeSlot,
    pos: PongPoint,
    mine: boolean,
  ): void {
    if (this.isMachine(slot)) return this.machine3d(ctx, pr, pos);
    const p = pr.toPx(pos.x, pos.y, 0.12);
    const r = Math.max(4, PONG.paddleR * p.k);
    ctx.strokeStyle = '#a0773f';
    ctx.lineWidth = Math.max(2, r * 0.35);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + r * 0.8);
    ctx.lineTo(p.x, p.y + r * 1.7);
    ctx.stroke();
    ctx.fillStyle = slot.startsWith('a') ? '#d2393a' : '#24272d';
    // A minha fica bem na frente: meio transparente, para a bola aparecer atrás dela.
    ctx.globalAlpha = mine ? 0.45 : 1;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = mine ? '#f2c14e' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = mine ? 2 : 1;
    ctx.stroke();
  }

  /** A vaga é da máquina de bolas (treino). */
  private isMachine(slot: ArcadeSlot): boolean {
    const v = this.view;
    return Boolean(v && v.solo === 'practice' && v.seats[slot].session === ARCADE_CPU_SESSION);
  }

  /** Máquina de bolas: uma caixa cinza com a boca de onde as bolas saem. */
  private machine3d(
    ctx: CanvasRenderingContext2D,
    pr: ReturnType<typeof perspective>,
    pos: PongPoint,
  ): void {
    const top = pr.toPx(pos.x, pos.y, 0.45);
    const base = pr.toPx(pos.x, pos.y, 0);
    const w = Math.max(10, 0.3 * base.k);
    ctx.fillStyle = '#5b6270';
    ctx.fillRect(top.x - w / 2, top.y, w, base.y - top.y);
    ctx.fillStyle = '#2b2f36';
    ctx.beginPath();
    ctx.ellipse(top.x, top.y + (base.y - top.y) * 0.3, w * 0.22, w * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Vista de cima (quem assiste). */
  private drawTop(
    ctx: CanvasRenderingContext2D,
    width: number,
    paddles: { slot: ArcadeSlot; p: PongPoint }[],
    ball: { x: number; y: number; h: number } | null,
    mine: ArcadeSlot | null,
  ): void {
    const tr = courtTransform(width);
    ctx.fillStyle = '#2b3138';
    ctx.fillRect(0, 0, width, tr.height);
    drawTable(ctx, tr);
    if (ball) drawBall(ctx, tr, ball);
    for (const { slot, p } of paddles) {
      if (this.isMachine(slot)) {
        const q = tr.toPx(p);
        const w = Math.max(10, 0.3 * tr.s);
        ctx.fillStyle = '#5b6270';
        ctx.fillRect(q.x - w / 2, q.y - w / 2, w, w);
      } else drawPaddle(ctx, tr, slot, p, slot === mine);
    }
  }
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable]'))
  );
}

function readTipHits(): number {
  try {
    return Number(localStorage.getItem(TIP_KEY)) || 0;
  } catch {
    return TIP_HITS;
  }
}

function saveTipHits(n: number): void {
  try {
    localStorage.setItem(TIP_KEY, String(n));
  } catch {
    // sem armazenamento: a dica volta na próxima vez
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
