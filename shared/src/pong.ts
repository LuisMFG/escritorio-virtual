import { z } from 'zod';
import type { ArcadeSlot } from './arcade.js';

/**
 * Ping-pong do Salão de Jogos (Fase 58): regras (placar, saque, sets) e física da bola, iguais no
 * servidor e no navegador. A bola anda em trechos de parábola entre eventos (saque, rebatida,
 * quique, rede, chão). Cada trecho começa num instante da hora do servidor, então todos calculam a
 * bola no mesmo lugar sem receber a posição a cada quadro.
 *
 * Unidades: metros e segundos, com gravidade mais fraca que a real para dar tempo de jogar. A
 * mesa vai de x = 0 a `tableL` (lado A antes da rede, lado B depois) e de y = 0 a `tableW`; `h` é
 * a altura acima do tampo (o chão fica em -`tableH`).
 */
export const PONG = {
  tableL: 2.74,
  tableW: 1.525,
  netH: 0.1525,
  tableH: 0.76,
  gravity: 5,
  /** Quanto da velocidade vertical sobra no quique, e da horizontal. */
  bounce: 0.8,
  bounceKeep: 0.95,
  ballR: 0.02,
  paddleR: 0.09,
  /** Folga do servidor ao conferir uma rebatida (o navegador manda o toque já com o atraso). */
  reachSlack: 0.05,
  /** Alturas em que ainda dá para rebater. */
  reachUp: 0.7,
  reachDown: -0.6,
  /** Até onde a raquete vai atrás da mesa e para os lados; e quanto ela fica longe da rede. */
  zoneBack: 0.9,
  zoneSide: 0.5,
  netGap: 0.08,
  /** Saque: de trás da linha de fundo, a esta altura. */
  serveBack: 0.4,
  serveH: 0.25,
  /** Tempo de voo (s): o saque, a rebatida mais lenta e a mais rápida. */
  serveFlight: 1.1,
  slowFlight: 1.05,
  fastFlight: 0.55,
  /** Pausa depois do ponto, folga para uma rebatida atrasada chegar e o máximo de volta no tempo. */
  pointPauseMs: 1200,
  graceMs: 300,
  maxRewindMs: 350,
  setPoints: 11,
  setsToWin: 2,
} as const;

export type PongSide = 'a' | 'b';
export const otherPongSide = (s: PongSide): PongSide => (s === 'a' ? 'b' : 'a');

/** Trecho de parábola da bola, com o contexto do ponto no começo dele. */
export interface PongBall {
  /** Hora do servidor (ms) do começo do trecho. */
  t0: number;
  x: number;
  y: number;
  h: number;
  vx: number;
  vy: number;
  vh: number;
  /** Quem bateu por último. */
  by: PongSide;
  /** Quiques em cada lado desde a última rebatida. */
  na: number;
  nb: number;
  /** Rebatidas no ponto (a bola fica mais rápida). */
  hits: number;
}

export interface PongPoint {
  x: number;
  y: number;
}

export interface BallState extends PongPoint {
  h: number;
  vx: number;
  vy: number;
  vh: number;
}

export type PongEvent =
  | { kind: 'bounce'; t: number; side: PongSide }
  | { kind: 'net'; t: number }
  | { kind: 'floor'; t: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NET_X = PONG.tableL / 2;

/** Posição e velocidade da bola num instante (ms, hora do servidor). */
export function ballAt(b: PongBall, t: number): BallState {
  const s = (t - b.t0) / 1000;
  return {
    x: b.x + b.vx * s,
    y: b.y + b.vy * s,
    h: b.h + b.vh * s - (PONG.gravity / 2) * s * s,
    vx: b.vx,
    vy: b.vy,
    vh: b.vh - PONG.gravity * s,
  };
}

export const sideOfX = (x: number): PongSide => (x < NET_X ? 'a' : 'b');

const overTable = (p: PongPoint) =>
  p.x >= 0 && p.x <= PONG.tableL && p.y >= 0 && p.y <= PONG.tableW;

/** Tempo (s) até a bola descer à altura `level`, pela raiz que desce. */
function fallTime(b: Pick<PongBall, 'h' | 'vh'>, level: number): number {
  const g = PONG.gravity;
  const d = b.vh * b.vh + 2 * g * (b.h - level);
  return d < 0 ? Infinity : (b.vh + Math.sqrt(d)) / g;
}

/** O próximo evento do trecho: quique no tampo, rede ou chão. */
export function nextEvent(b: PongBall): PongEvent {
  const ms = (s: number) => b.t0 + s * 1000;
  // Quique: quando a bola desce até o tampo (também a que foi rebatida de baixo da mesa e sobe).
  let bounce = Infinity;
  const down = fallTime(b, 0);
  if (down > 1e-6 && Number.isFinite(down)) {
    const p = { x: b.x + b.vx * down, y: b.y + b.vy * down };
    if (overTable(p)) bounce = down;
  }
  const floor = fallTime(b, -PONG.tableH);
  if (b.vx !== 0) {
    const s = (NET_X - b.x) / b.vx;
    if (s > 1e-6 && s < Math.min(bounce, floor)) {
      const h = b.h + b.vh * s - (PONG.gravity / 2) * s * s;
      const y = b.y + b.vy * s;
      if (h < PONG.netH && h > -PONG.tableH && y > -0.15 && y < PONG.tableW + 0.15) {
        return { kind: 'net', t: ms(s) };
      }
    }
  }
  if (bounce <= floor) return { kind: 'bounce', t: ms(bounce), side: sideOfX(b.x + b.vx * bounce) };
  return { kind: 'floor', t: ms(floor) };
}

/**
 * Aplica o evento: o trecho seguinte da bola (ou `null`, parada no chão) e, se acabou o ponto, quem
 * ganhou. Quique no próprio lado de quem bateu, na rede ou fora: ponto do outro. Dois quiques do
 * lado de quem recebe, ou a bola que quicou e saiu sem ser rebatida: ponto de quem bateu.
 */
export function applyEvent(
  b: PongBall,
  ev: PongEvent,
): { ball: PongBall | null; point?: PongSide } {
  const at = ballAt(b, ev.t);
  const receiver = otherPongSide(b.by);
  if (ev.kind === 'floor') {
    const bounced = receiver === 'a' ? b.na : b.nb;
    return { ball: null, point: bounced >= 1 ? b.by : receiver };
  }
  if (ev.kind === 'net') {
    // Bate na rede e cai do lado de quem bateu.
    return {
      ball: {
        ...b,
        t0: ev.t,
        x: at.x,
        y: at.y,
        h: at.h,
        vx: -0.15 * at.vx,
        vy: 0.3 * at.vy,
        vh: 0,
      },
      point: receiver,
    };
  }
  const na = b.na + (ev.side === 'a' ? 1 : 0);
  const nb = b.nb + (ev.side === 'b' ? 1 : 0);
  const next: PongBall = {
    ...b,
    t0: ev.t,
    x: at.x,
    y: at.y,
    h: 0,
    vx: at.vx * PONG.bounceKeep,
    vy: at.vy * PONG.bounceKeep,
    vh: -at.vh * PONG.bounce,
    na,
    nb,
  };
  if (ev.side === b.by) return { ball: next, point: receiver };
  if ((ev.side === 'a' ? na : nb) >= 2) return { ball: next, point: b.by };
  return { ball: next };
}

/**
 * A bola de um trecho até `until`: o trecho que vale naquele instante e, se o ponto acabou antes,
 * quem ganhou e quando. `keepGoing`: depois do ponto, a bola continua quicando (para desenhar).
 */
export function simulate(
  b: PongBall,
  until: number,
  keepGoing = false,
): { ball: PongBall | null; point?: { side: PongSide; t: number } } {
  let ball: PongBall | null = b;
  let point: { side: PongSide; t: number } | undefined;
  for (let i = 0; i < 40 && ball; i++) {
    const ev = nextEvent(ball);
    if (ev.t > until) break;
    const res = applyEvent(ball, ev);
    if (res.point && !point) {
      point = { side: res.point, t: ev.t };
      if (!keepGoing) return { ball: res.ball ?? ball, point };
    }
    if (!res.ball) {
      // Parou no chão: fica lá (para desenhar), sem mais eventos.
      const end = ballAt(ball, ev.t);
      return {
        ball: { ...ball, t0: ev.t, x: end.x, y: end.y, h: -PONG.tableH, vx: 0, vy: 0, vh: 0 },
        point,
      };
    }
    ball = res.ball;
  }
  return { ball, point };
}

/**
 * Lança a bola de `from` para cair em `to` (no tampo) depois de `flight` segundos. Se o arco não
 * passar a rede (ou a linha de fundo de quem bate, rebatendo de trás e de baixo da mesa), sobe
 * o arco até passar.
 */
export function launch(
  from: BallState | (PongPoint & { h: number }),
  to: PongPoint,
  flight: number,
  t: number,
  by: PongSide,
  hits: number,
): PongBall {
  const g = PONG.gravity;
  const end = by === 'a' ? 0 : PONG.tableL;
  let T = flight;
  let ball!: PongBall;
  for (let i = 0; i < 30; i++) {
    ball = {
      t0: t,
      x: from.x,
      y: from.y,
      h: from.h,
      vx: (to.x - from.x) / T,
      vy: (to.y - from.y) / T,
      vh: (-from.h + (g / 2) * T * T) / T,
      by,
      na: 0,
      nb: 0,
      hits,
    };
    const heightAtX = (x: number) => {
      const s = (x - from.x) / ball.vx;
      return s > 0 && s < T ? ball.h + ball.vh * s - (g / 2) * s * s : Infinity;
    };
    if (heightAtX(NET_X) >= PONG.netH + 0.03 && heightAtX(end) >= 0.02) break;
    T += 0.05;
  }
  return ball;
}

/** Saque: de trás da linha de fundo, direto para o outro lado (um pouco para o meio). */
export function serveBall(side: PongSide, paddle: PongPoint, t: number): PongBall {
  const { tableL: L, tableW: W, serveBack, serveH } = PONG;
  const dir = side === 'a' ? 1 : -1;
  const x = side === 'a' ? clamp(paddle.x, -serveBack, 0) : clamp(paddle.x, L, L + serveBack);
  const y = clamp(paddle.y, 0.1, W - 0.1);
  const to = { x: NET_X + dir * 0.6 * NET_X, y: clamp(y + (W / 2 - y) * 0.3, 0.15, W - 0.15) };
  return launch({ x, y, h: serveH }, to, PONG.serveFlight, t, side, 0);
}

/**
 * Rebatida: a bola volta para o outro lado. Mais forte (raquete indo para a frente) cai mais fundo e
 * mais rápido; pegar com a beirada da raquete ou mexendo para o lado manda a bola na diagonal, e
 * diagonal demais sai da mesa. Cada rebatida do ponto deixa a bola um pouco mais rápida.
 */
export function hitBall(
  ball: BallState,
  paddle: PongPoint,
  velocity: PongPoint,
  side: PongSide,
  hits: number,
  t: number,
): PongBall {
  const dir = side === 'a' ? 1 : -1;
  const swing = clamp((dir * clamp(velocity.x, -6, 6)) / 3, 0, 1);
  const depth = 0.35 + 0.45 * swing;
  const to = {
    x: NET_X + dir * depth * NET_X,
    y: ball.y + (ball.y - paddle.y) * 4 + clamp(velocity.y, -6, 6) * 0.3,
  };
  const flight = clamp(
    PONG.slowFlight - 0.02 * hits - 0.3 * swing,
    PONG.fastFlight,
    PONG.slowFlight,
  );
  return launch(
    { x: ball.x, y: ball.y, h: Math.max(ball.h, PONG.reachDown) },
    to,
    flight,
    t,
    side,
    hits + 1,
  );
}

/** A raquete fica no seu lado: atrás da mesa, dos lados, sem passar da rede. */
export function clampPaddle(side: PongSide, p: PongPoint): PongPoint {
  const { tableL: L, tableW: W, zoneBack, zoneSide, netGap } = PONG;
  return {
    x:
      side === 'a'
        ? clamp(p.x, -zoneBack, NET_X - netGap)
        : clamp(p.x, NET_X + netGap, L + zoneBack),
    y: clamp(p.y, -zoneSide, W + zoneSide),
  };
}

/**
 * Dá para rebater agora? A bola veio do outro lado, já quicou uma vez deste lado, está ao alcance
 * da raquete e numa altura que dá. `slack`: folga extra (o servidor, conferindo um toque atrasado).
 */
export function canHit(
  b: PongBall,
  at: BallState,
  side: PongSide,
  paddle: PongPoint,
  slack = 0,
): boolean {
  if (b.by === side || (side === 'a' ? b.na : b.nb) !== 1) return false;
  if (at.h < PONG.reachDown || at.h > PONG.reachUp) return false;
  return Math.hypot(at.x - paddle.x, at.y - paddle.y) <= PONG.paddleR + PONG.ballR + slack;
}

// ---------- Placar ----------

export interface PongScore {
  points: Record<PongSide, number>;
  sets: Record<PongSide, number>;
  /** Quem saca primeiro neste set (alterna a cada set). */
  first: PongSide;
}

export function newPongScore(): PongScore {
  return { points: { a: 0, b: 0 }, sets: { a: 0, b: 0 }, first: 'a' };
}

/** 10 × 10 ou mais: o saque troca a cada ponto e o set vai até alguém abrir 2. */
export const isDeuce = (s: PongScore) => s.points.a >= 10 && s.points.b >= 10;

/** Vez de saque no set: troca a cada 2 pontos; no 10 × 10, a cada ponto. */
export function serveTurn(s: PongScore): number {
  const total = s.points.a + s.points.b;
  return total < 20 ? Math.floor(total / 2) : 10 + (total - 20);
}

export function servingSide(s: PongScore): PongSide {
  return serveTurn(s) % 2 === 0 ? s.first : otherPongSide(s.first);
}

/** Quem saca: no 2×2, os parceiros se revezam cada vez que o saque volta para o lado deles. */
export function servingSlot(s: PongScore, mode: number): ArcadeSlot {
  const side = servingSide(s);
  const partner = mode === 2 ? Math.floor(serveTurn(s) / 2) % 2 : 0;
  return `${side}${partner + 1}` as ArcadeSlot;
}

/**
 * Ponto para um lado. Set de 11 com 2 de vantagem; quem fecha 2 sets vence (melhor de 3). No set
 * seguinte, saca primeiro quem recebeu primeiro no anterior.
 */
export function addPongPoint(
  s: PongScore,
  side: PongSide,
): { score: PongScore; set?: PongSide; match?: PongSide } {
  const points = { ...s.points, [side]: s.points[side] + 1 };
  const other = otherPongSide(side);
  if (points[side] < PONG.setPoints || points[side] - points[other] < 2) {
    return { score: { ...s, points } };
  }
  const sets = { ...s.sets, [side]: s.sets[side] + 1 };
  const score: PongScore = {
    points: sets[side] >= PONG.setsToWin ? points : { a: 0, b: 0 },
    sets,
    first: otherPongSide(s.first),
  };
  return sets[side] >= PONG.setsToWin ? { score, set: side, match: side } : { score, set: side };
}

// ---------- Mensagens ----------

const furniId = z.string().min(1).max(40);
const coord = z.number().min(-5).max(10);
const speed = z.number().min(-50).max(50);
const time = z.number().min(0).max(1e14);
export const pongPaddleSchema = z.object({ furniId, x: coord, y: coord });
export const pongServeSchema = z.object({ furniId, t: time, x: coord, y: coord });
export const pongHitSchema = z.object({
  furniId,
  t: time,
  x: coord,
  y: coord,
  vx: speed,
  vy: speed,
});
export type PongHitMessage = z.infer<typeof pongHitSchema>;

/** Trecho da bola guardado no estado da sala (JSON compacto). */
export function encodeBall(b: PongBall | null): string {
  return b ? JSON.stringify(b) : '';
}

export function decodeBall(s: string): PongBall | null {
  if (!s) return null;
  try {
    const b = JSON.parse(s) as PongBall;
    return typeof b.t0 === 'number' && typeof b.vx === 'number' ? b : null;
  } catch {
    return null;
  }
}
