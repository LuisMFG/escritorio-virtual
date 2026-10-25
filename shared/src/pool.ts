import { z } from 'zod';
import type { ArcadeSlot } from './arcade.js';

/**
 * Sinuca 8 Ball do Salão de Jogos (Fase 59): física da mesa e regras, iguais no servidor e no
 * navegador. A tacada é simulada até as bolas pararem, em passos fixos, só com somas,
 * multiplicações, divisões e raiz quadrada: dá o mesmo resultado em qualquer lugar. O servidor
 * simula, julga e manda a tacada e as posições finais; os navegadores animam a mesma simulação.
 *
 * Unidades: metros e segundos. A área de jogo vai de x = 0 a `tableL` (a cabeceira, onde se
 * abre, fica em x pequeno) e de y = 0 a `tableW`. Bola 0 é a branca; 1–7 lisas, 8 a preta e
 * 9–15 listradas.
 */
export const POOL = {
  tableL: 2.24,
  tableW: 1.12,
  ballR: 0.028575,
  /** Aberturas das caçapas: até onde a tabela some perto de cada canto e do meio. */
  cornerGap: 0.09,
  sideGap: 0.065,
  /** Passo da simulação e o limite de passos de uma tacada. */
  dt: 1 / 360,
  maxSteps: 360 * 30,
  /**
   * Atrito do pano em duas fases, como na mesa de verdade: logo depois da tacada ou de um choque a
   * bola desliza e freia rápido (`slideDecel`) até chegar a 5/7 da velocidade; daí rola e freia
   * devagar (`rollDecel`, um pouco mais que o real, para a partida não arrastar). Velocidade (m/s)
   * abaixo da qual a bola para.
   */
  slideDecel: 2,
  rollDecel: 0.35,
  rollRatio: 5 / 7,
  stopSpeed: 0.01,
  railBounce: 0.78,
  ballBounce: 0.96,
  /**
   * Velocidade da branca com a força mínima e a máxima. A barra cresce em curva (`powerCurve`): o
   * meio dela manda a branca mais ou menos uma mesa, e o fim é a força da abertura.
   */
  minSpeed: 0.3,
  maxSpeed: 6,
  powerCurve: 2,
  /** Efeito: quanto do alto/baixo volta na branca depois do choque, e do lado na tabela. */
  followGain: 0.8,
  sideGain: 0.5,
  /** Tempo por tacada. */
  shotMs: 45_000,
  /** Desalinhamento máximo (m) de cada bola do triângulo, para a abertura não ser sempre igual. */
  rackJitter: 0.0006,
  /** Passos da simulação por quadro gravado para animar. */
  frameEvery: 3,
} as const;

export type PoolSide = 'a' | 'b';
export type PoolGroup = 'solids' | 'stripes';
export type PoolPos = [number, number];
/** Posições das 16 bolas (`null` = encaçapada). */
export type PoolBalls = (PoolPos | null)[];

export const otherPoolSide = (s: PoolSide): PoolSide => (s === 'a' ? 'b' : 'a');
export const otherGroup = (g: PoolGroup): PoolGroup => (g === 'solids' ? 'stripes' : 'solids');
export const GROUP_NAMES: Record<PoolGroup, string> = { solids: 'lisas', stripes: 'listradas' };

export function groupOf(ball: number): PoolGroup | null {
  if (ball >= 1 && ball <= 7) return 'solids';
  if (ball >= 9 && ball <= 15) return 'stripes';
  return null;
}

const L = POOL.tableL;
const W = POOL.tableW;
const R = POOL.ballR;

/** Caçapas: os quatro cantos e o meio das tabelas compridas (centro e raio de captura). */
export const POCKETS: readonly { x: number; y: number; r: number }[] = [
  { x: -0.015, y: -0.015, r: 0.07 },
  { x: L / 2, y: -0.035, r: 0.06 },
  { x: L + 0.015, y: -0.015, r: 0.07 },
  { x: -0.015, y: W + 0.015, r: 0.07 },
  { x: L / 2, y: W + 0.035, r: 0.06 },
  { x: L + 0.015, y: W + 0.015, r: 0.07 },
];

/** Onde fica o triângulo (a bola da ponta) e a linha de saída (a branca abre de trás dela). */
export const FOOT_SPOT: PoolPos = [(3 * L) / 4, W / 2];
export const HEAD_X = L / 4;

/** Triângulo: a 8 no meio, uma lisa e uma listrada nos cantos de trás. */
const RACK = [[1], [10, 2], [3, 8, 11], [12, 4, 13, 6], [14, 7, 15, 9, 5]];

/**
 * Mesa arrumada para a abertura: o triângulo e a branca atrás da linha de saída. Com `random`,
 * cada bola do triângulo sai um pouquinho do lugar (menos que a folga entre elas, sem encostar):
 * como numa mesa de verdade, cada abertura espalha diferente. Sem ele, o triângulo perfeito.
 */
export function rackBalls(random?: () => number): PoolBalls {
  const balls: PoolBalls = new Array(16).fill(null);
  balls[0] = [HEAD_X, W / 2];
  const dx = R * Math.sqrt(3) + 0.0002;
  const jitter = () => (random ? (random() * 2 - 1) * POOL.rackJitter : 0);
  RACK.forEach((row, k) => {
    row.forEach((ball, j) => {
      balls[ball] = [
        FOOT_SPOT[0] + k * dx + jitter(),
        FOOT_SPOT[1] + (j - k / 2) * (2 * R + 0.0002) + jitter(),
      ];
    });
  });
  return balls;
}

/** Velocidade da branca (m/s) para uma força de 0 a 1 (em curva: mais controle nas fracas). */
export function shotSpeed(power: number): number {
  const p = Math.min(1, Math.max(0, power));
  return POOL.minSpeed + Math.pow(p, POOL.powerCurve) * (POOL.maxSpeed - POOL.minSpeed);
}

/** A tacada: direção (vetor), força (0–1) e o efeito na branca (lado e alto/baixo, −1 a 1). */
export interface PoolShot {
  dx: number;
  dy: number;
  power: number;
  sx: number;
  sy: number;
}

/** O que aconteceu na tacada, para o juiz. */
export interface ShotEvents {
  /** A primeira bola que a branca tocou (`null` = nenhuma). */
  first: number | null;
  /** Encaçapadas, na ordem, e em qual caçapa. */
  pocketed: { ball: number; pocket: number }[];
  /** Alguma bola tocou a tabela depois do primeiro contato. */
  railAfter: boolean;
}

export interface ShotResult {
  final: PoolBalls;
  events: ShotEvents;
  /** Duração (ms) até as bolas pararem. */
  ms: number;
  /** Quadros para animar (posições de todas as bolas, `NaN` = encaçapada), se pedidos. */
  frames?: Float32Array[];
}

/** Trechos de tabela de cada lado (onde não há abertura de caçapa). */
const RAIL_X: readonly [number, number][] = [
  [POOL.cornerGap, L / 2 - POOL.sideGap],
  [L / 2 + POOL.sideGap, L - POOL.cornerGap],
];
const RAIL_Y: readonly [number, number][] = [[POOL.cornerGap, W - POOL.cornerGap]];
const within = (v: number, spans: readonly [number, number][]) =>
  spans.some(([a, b]) => v >= a && v <= b);

/**
 * Simula a tacada até as bolas pararem. Determinística: as mesmas posições e a mesma tacada dão
 * exatamente o mesmo resultado (no servidor e em qualquer navegador).
 */
export function simulateShot(start: PoolBalls, shot: PoolShot, record = false): ShotResult {
  const n = start.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const on: boolean[] = [];
  /** Velocidade em que cada bola para de deslizar e passa a rolar (0 = já rolando). */
  const rollAt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = start[i];
    on.push(Boolean(p));
    if (p) {
      x[i] = p[0];
      y[i] = p[1];
    }
  }
  const len = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy) || 1;
  const speed = shotSpeed(shot.power);
  vx[0] = (shot.dx / len) * speed;
  vy[0] = (shot.dy / len) * speed;
  rollAt[0] = speed * POOL.rollRatio;
  // Efeito: alto (+) ou baixo (−) volta na branca depois do primeiro choque; lado, na tabela.
  let follow = Math.min(1, Math.max(-1, shot.sy)) * speed * 0.5;
  let side = Math.min(1, Math.max(-1, shot.sx)) * speed * 0.25;
  const events: ShotEvents = { first: null, pocketed: [], railAfter: false };
  const frames: Float32Array[] = [];
  const snap = () => {
    const f = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      f[i * 2] = on[i] ? x[i]! : NaN;
      f[i * 2 + 1] = on[i] ? y[i]! : NaN;
    }
    frames.push(f);
  };
  if (record) snap();
  const pocket = (i: number) => {
    let best = 0;
    let bestD = Infinity;
    POCKETS.forEach((p, k) => {
      const d = (x[i]! - p.x) * (x[i]! - p.x) + (y[i]! - p.y) * (y[i]! - p.y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    on[i] = false;
    vx[i] = 0;
    vy[i] = 0;
    events.pocketed.push({ ball: i, pocket: best });
  };
  const rail = (i: number, nx: number, ny: number) => {
    // Bateu na tabela: a parte da velocidade contra ela volta, com perda.
    const vn = vx[i]! * nx + vy[i]! * ny;
    vx[i] = vx[i]! - (1 + POOL.railBounce) * vn * nx;
    vy[i] = vy[i]! - (1 + POOL.railBounce) * vn * ny;
    if (i === 0 && side !== 0) {
      vx[i] = vx[i]! + ny * side * POOL.sideGain;
      vy[i] = vy[i]! - nx * side * POOL.sideGain;
      side *= 0.5;
    }
    if (events.first !== null) events.railAfter = true;
  };
  let steps = 0;
  for (; steps < POOL.maxSteps; steps++) {
    let moving = false;
    for (let i = 0; i < n; i++) {
      if (!on[i] || (vx[i] === 0 && vy[i] === 0)) continue;
      moving = true;
      x[i] = x[i]! + vx[i]! * POOL.dt;
      y[i] = y[i]! + vy[i]! * POOL.dt;
    }
    if (!moving) break;
    if (follow !== 0 && events.first === null) follow *= 1 - 0.35 * POOL.dt;
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      // Caçapa: o centro da bola entrou na boca dela.
      if (
        POCKETS.some(
          (p) => (x[i]! - p.x) * (x[i]! - p.x) + (y[i]! - p.y) * (y[i]! - p.y) < p.r * p.r,
        )
      ) {
        pocket(i);
        continue;
      }
      // Tabelas (fora das aberturas das caçapas).
      if (y[i]! < R && vy[i]! < 0 && within(x[i]!, RAIL_X)) {
        y[i] = 2 * R - y[i]!;
        rail(i, 0, 1);
      } else if (y[i]! > W - R && vy[i]! > 0 && within(x[i]!, RAIL_X)) {
        y[i] = 2 * (W - R) - y[i]!;
        rail(i, 0, -1);
      }
      if (x[i]! < R && vx[i]! < 0 && within(y[i]!, RAIL_Y)) {
        x[i] = 2 * R - x[i]!;
        rail(i, 1, 0);
      } else if (x[i]! > L - R && vx[i]! > 0 && within(y[i]!, RAIL_Y)) {
        x[i] = 2 * (L - R) - x[i]!;
        rail(i, -1, 0);
      }
      // Escapou pela abertura sem cair na boca: vai para a caçapa mais perto.
      if (x[i]! < -3 * R || x[i]! > L + 3 * R || y[i]! < -3 * R || y[i]! > W + 3 * R) pocket(i);
    }
    // Choques entre bolas (duas passadas: o triângulo da abertura tem vários ao mesmo tempo).
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        if (!on[i]) continue;
        for (let j = i + 1; j < n; j++) {
          if (!on[j]) continue;
          const ddx = x[j]! - x[i]!;
          const ddy = y[j]! - y[i]!;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2);
          // Velocidade de i em relação a j, ao longo da linha dos centros.
          const rvx = vx[i]! - vx[j]!;
          const rvy = vy[i]! - vy[j]!;
          if (rvx * ddx + rvy * ddy <= 0) {
            // Já se afastando: só separa as que ficaram encostadas.
            const push = (2 * R - d) / 2;
            x[i] = x[i]! - (ddx / d) * push;
            y[i] = y[i]! - (ddy / d) * push;
            x[j] = x[j]! + (ddx / d) * push;
            y[j] = y[j]! + (ddy / d) * push;
            continue;
          }
          // Volta as duas até o instante exato do contato (dentro do passo): o choque sai na
          // linha dos centros certa, a mesma que a linha-guia mostra.
          // |centros − velocidade relativa × t| = 2R: o t (para trás) do contato.
          const a = rvx * rvx + rvy * rvy;
          const B = ddx * rvx + ddy * rvy;
          const c = d2 - 4 * R * R;
          const back = Math.min(POOL.dt, Math.max(0, (-B + Math.sqrt(B * B - a * c)) / a));
          x[i] = x[i]! - vx[i]! * back;
          y[i] = y[i]! - vy[i]! * back;
          x[j] = x[j]! - vx[j]! * back;
          y[j] = y[j]! - vy[j]! * back;
          const cx = x[j]! - x[i]!;
          const cy = y[j]! - y[i]!;
          const cd = Math.sqrt(cx * cx + cy * cy) || 2 * R;
          const nx = cx / cd;
          const ny = cy / cd;
          const vrel = (vx[i]! - vx[j]!) * nx + (vy[i]! - vy[j]!) * ny;
          // A branca é sempre a bola 0 (o `i` do par).
          const cue = i === 0;
          const before: { x: number; y: number } | null = cue ? { x: vx[0]!, y: vy[0]! } : null;
          const k = (Math.max(0, vrel) * (1 + POOL.ballBounce)) / 2;
          vx[i] = vx[i]! - k * nx;
          vy[i] = vy[i]! - k * ny;
          vx[j] = vx[j]! + k * nx;
          vy[j] = vy[j]! + k * ny;
          // A bola acertada sai deslizando, e a que bateu volta a deslizar (o choque tira o rolar).
          const vj = Math.sqrt(vx[j]! * vx[j]! + vy[j]! * vy[j]!);
          const vi = Math.sqrt(vx[i]! * vx[i]! + vy[i]! * vy[i]!);
          rollAt[j] = vj * POOL.rollRatio;
          rollAt[i] = vi * POOL.rollRatio;
          if (cue && events.first === null) {
            events.first = j;
            // Alto segue em frente, baixo volta: soma na direção em que a branca vinha.
            const bl = Math.sqrt(before!.x * before!.x + before!.y * before!.y);
            if (bl > 0 && follow !== 0) {
              vx[0] = vx[0]! + (before!.x / bl) * follow * POOL.followGain;
              vy[0] = vy[0]! + (before!.y / bl) * follow * POOL.followGain;
              rollAt[0] = Math.sqrt(vx[0]! * vx[0]! + vy[0]! * vy[0]!) * POOL.rollRatio;
            }
            follow = 0;
          }
          // E anda de novo o que tinha voltado, já com as velocidades novas.
          x[i] = x[i]! + vx[i]! * back;
          y[i] = y[i]! + vy[i]! * back;
          x[j] = x[j]! + vx[j]! * back;
          y[j] = y[j]! + vy[j]! * back;
        }
      }
    }
    // Atrito do pano: desliza (freia rápido) até a velocidade de rolar, depois rola.
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      const v = Math.sqrt(vx[i]! * vx[i]! + vy[i]! * vy[i]!);
      if (v === 0) continue;
      const sliding = v > rollAt[i]!;
      const next = Math.max(
        sliding ? rollAt[i]! : 0,
        v - (sliding ? POOL.slideDecel : POOL.rollDecel) * POOL.dt,
      );
      if (next < POOL.stopSpeed) {
        vx[i] = 0;
        vy[i] = 0;
      } else {
        vx[i] = (vx[i]! * next) / v;
        vy[i] = (vy[i]! * next) / v;
      }
    }
    if (record && steps % POOL.frameEvery === 0) snap();
  }
  if (record) snap();
  const final: PoolBalls = start.map((_, i) => (on[i] ? [x[i]!, y[i]!] : null));
  return {
    final,
    events,
    ms: steps * POOL.dt * 1000,
    ...(record ? { frames } : {}),
  };
}

/**
 * Linha-guia: até onde a branca vai na direção da mira. Encostando numa bola, a bola-fantasma
 * (onde a branca estará no choque), para onde a bola acertada vai e para onde a branca desvia;
 * senão, o ponto da tabela e o rebote.
 */
export type AimGuide =
  | {
      kind: 'ball';
      ghost: PoolPos;
      ball: number;
      objectDir: PoolPos;
      cueDir: PoolPos;
    }
  | { kind: 'rail'; point: PoolPos; bounce: PoolPos };

export function aimGuide(balls: PoolBalls, dir: PoolPos): AimGuide | null {
  const cue = balls[0];
  if (!cue) return null;
  const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
  if (!len) return null;
  const ux = dir[0] / len;
  const uy = dir[1] / len;
  let best: AimGuide | null = null;
  let bestT = Infinity;
  balls.forEach((b, i) => {
    if (!b || i === 0) return;
    // A branca anda t e encosta na bola quando a distância entre os centros fica 2R.
    const ox = b[0] - cue[0];
    const oy = b[1] - cue[1];
    const along = ox * ux + oy * uy;
    if (along <= 0) return;
    const perp2 = ox * ox + oy * oy - along * along;
    if (perp2 >= 4 * R * R) return;
    const t = along - Math.sqrt(4 * R * R - perp2);
    if (t < 0 || t >= bestT) return;
    bestT = t;
    const ghost: PoolPos = [cue[0] + ux * t, cue[1] + uy * t];
    const nx = (b[0] - ghost[0]) / (2 * R);
    const ny = (b[1] - ghost[1]) / (2 * R);
    const dot = ux * nx + uy * ny;
    best = {
      kind: 'ball',
      ghost,
      ball: i,
      objectDir: [nx, ny],
      cueDir: [ux - dot * nx, uy - dot * ny],
    };
  });
  // Tabela (as linhas por onde o centro da bola passa).
  const hits: { t: number; nx: number; ny: number }[] = [];
  if (ux < 0) hits.push({ t: (R - cue[0]) / ux, nx: 1, ny: 0 });
  if (ux > 0) hits.push({ t: (L - R - cue[0]) / ux, nx: -1, ny: 0 });
  if (uy < 0) hits.push({ t: (R - cue[1]) / uy, nx: 0, ny: 1 });
  if (uy > 0) hits.push({ t: (W - R - cue[1]) / uy, nx: 0, ny: -1 });
  const wall = hits.filter((h) => h.t >= 0).sort((a, b) => a.t - b.t)[0];
  if (wall && wall.t < bestT) {
    const vn = ux * wall.nx + uy * wall.ny;
    return {
      kind: 'rail',
      point: [cue[0] + ux * wall.t, cue[1] + uy * wall.t],
      bounce: [ux - 2 * vn * wall.nx, uy - 2 * vn * wall.ny],
    };
  }
  return best;
}

/** Dá para pôr a branca aqui (bola na mão)? Na mesa, sem encostar em outra; na abertura, atrás da linha de saída. */
export function canPlaceCue(balls: PoolBalls, pos: PoolPos, breakShot: boolean): boolean {
  const [px, py] = pos;
  if (px < R || px > L - R || py < R || py > W - R) return false;
  if (breakShot && px > HEAD_X) return false;
  return balls.every((b, i) => {
    if (!b || i === 0) return true;
    const dx = b[0] - px;
    const dy = b[1] - py;
    return dx * dx + dy * dy >= (2 * R + 0.001) * (2 * R + 0.001);
  });
}

/** Onde a branca aparece com bola na mão quando caiu: atrás da linha de saída, num lugar livre. */
export function cueSpot(balls: PoolBalls, breakShot: boolean): PoolPos {
  for (let back = 0; back < 5; back++) {
    for (let k = 0; k < 15; k++) {
      // Do meio da mesa para os lados, e depois um pouco mais para trás.
      const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3 * R;
      const pos: PoolPos = [HEAD_X - back * 4 * R, W / 2 + dy];
      if (canPlaceCue(balls, pos, breakShot)) return pos;
    }
  }
  return [HEAD_X, W / 2];
}

/** A 8 volta para a mesa (encaçapada na abertura): no ponto do triângulo ou o mais perto livre. */
export function respotEight(balls: PoolBalls): PoolBalls {
  const out = balls.slice();
  for (let k = 0; k < 40; k++) {
    const pos: PoolPos = [Math.min(L - R, FOOT_SPOT[0] + k * 2.2 * R), FOOT_SPOT[1]];
    const free = out.every((b, i) => {
      if (!b || i === 8) return true;
      const dx = b[0] - pos[0];
      const dy = b[1] - pos[1];
      return dx * dx + dy * dy >= 4 * R * R;
    });
    if (free) {
      out[8] = pos;
      return out;
    }
  }
  out[8] = [FOOT_SPOT[0], FOOT_SPOT[1]];
  return out;
}

// ---------- Regras ----------

/** O estado das regras entre as tacadas. */
export interface PoolRules {
  /** O grupo do lado A ('' = mesa aberta); o do B é o outro. */
  groupA: '' | PoolGroup;
  /** De que lado é a vez. */
  turn: PoolSide;
  /** No 2×2, qual parceiro de cada lado taca na próxima vez do lado (as duplas alternam tacadas). */
  next: Record<PoolSide, number>;
  /** Bola na mão: quem taca pode pôr a branca onde quiser. */
  inHand: boolean;
  /** A próxima tacada é a abertura. */
  breakShot: boolean;
}

export function newPoolRules(): PoolRules {
  return { groupA: '', turn: 'a', next: { a: 0, b: 0 }, inHand: true, breakShot: true };
}

export function sideGroup(rules: Pick<PoolRules, 'groupA'>, side: PoolSide): '' | PoolGroup {
  if (!rules.groupA) return '';
  return side === 'a' ? rules.groupA : otherGroup(rules.groupA);
}

/** Bolas de um grupo ainda na mesa. */
export function remaining(balls: PoolBalls, group: PoolGroup): number {
  return balls.filter((b, i) => b && groupOf(i) === group).length;
}

/** Este lado já encaçapou o grupo todo: agora é a 8 (cantando a caçapa). */
export function onEight(rules: PoolRules, balls: PoolBalls, side: PoolSide): boolean {
  const g = sideGroup(rules, side);
  return g !== '' && remaining(balls, g) === 0;
}

/** Vaga de quem taca agora (no 2×2, o parceiro da vez). */
export function shooterSlot(rules: PoolRules, mode: number): ArcadeSlot {
  const k = mode === 2 ? rules.next[rules.turn] % 2 : 0;
  return `${rules.turn}${k + 1}` as ArcadeSlot;
}

export interface ShotVerdict {
  rules: PoolRules;
  /** Bolas como ficam (a 8 recolocada, se caiu na abertura). */
  balls: PoolBalls;
  /** Motivo da falta, se houve. */
  foul: string | null;
  /** Fim da partida: quem venceu e por quê. */
  end?: { winner: PoolSide; reason: string };
  /** O lado que tacou continua. */
  keep: boolean;
  message: string;
}

/**
 * Julga a tacada. Faltas: branca na caçapa, não acertar nenhuma bola, acertar primeiro a bola
 * errada e nenhuma bola na tabela depois do contato (sem encaçapar). Falta dá bola na mão ao
 * adversário. Mesa aberta até a primeira bola encaçapada (fora da abertura) definir os grupos.
 * A 8: vence quem a encaçapa na caçapa cantada depois do seu grupo; perde quem a encaçapa antes
 * da hora, na caçapa errada ou com falta. Na abertura, a 8 volta para a mesa.
 */
export function judgeShot(
  rules: PoolRules,
  before: PoolBalls,
  after: PoolBalls,
  ev: ShotEvents,
  call: number | null,
  mode: number,
): ShotVerdict {
  const side = rules.turn;
  const mine = sideGroup(rules, side);
  const wasOnEight = onEight(rules, before, side);
  const sunk = ev.pocketed.map((p) => p.ball);
  let foul: string | null = null;
  if (sunk.includes(0)) foul = 'branca na caçapa';
  else if (ev.first === null) foul = 'a branca não acertou nenhuma bola';
  else if (!rules.breakShot) {
    if (!mine && ev.first === 8) foul = 'acertou a 8 primeiro';
    else if (mine && wasOnEight && ev.first !== 8) foul = 'era a vez da 8';
    else if (mine && !wasOnEight && groupOf(ev.first) !== mine) {
      foul = `acertou primeiro uma ${GROUP_NAMES[otherGroup(mine)].slice(0, -1)}`;
    }
  }
  if (!foul && !rules.breakShot && sunk.length === 0 && !ev.railAfter) {
    foul = 'nenhuma bola tocou a tabela';
  }
  let balls = after;
  let end: ShotVerdict['end'];
  if (sunk.includes(8)) {
    const pocket = ev.pocketed.find((p) => p.ball === 8)!.pocket;
    if (rules.breakShot) balls = respotEight(after);
    else if (foul) end = { winner: otherPoolSide(side), reason: 'a 8 caiu com falta' };
    else if (!wasOnEight) end = { winner: otherPoolSide(side), reason: 'a 8 caiu antes da hora' };
    else if (call !== pocket)
      end = { winner: otherPoolSide(side), reason: 'a 8 caiu na caçapa errada' };
    else end = { winner: side, reason: 'a 8 na caçapa cantada' };
  }
  // Mesa aberta: a primeira bola de grupo encaçapada (sem falta, fora da abertura) define.
  let groupA = rules.groupA;
  if (!foul && !groupA && !rules.breakShot) {
    const first = ev.pocketed.find((p) => groupOf(p.ball));
    if (first) {
      const g = groupOf(first.ball)!;
      groupA = side === 'a' ? g : otherGroup(g);
    }
  }
  const nowMine = sideGroup({ groupA }, side);
  const scored = rules.breakShot
    ? sunk.some((b) => b !== 0 && b !== 8)
    : sunk.some((b) => (nowMine ? groupOf(b) === nowMine : groupOf(b) !== null));
  const keep = !foul && !end && scored;
  const next = { ...rules.next, [side]: (rules.next[side] + 1) % (mode === 2 ? 2 : 1) };
  const message = end
    ? end.reason
    : foul
      ? `Falta: ${foul}`
      : groupA && !rules.groupA
        ? `Grupos definidos`
        : keep
          ? 'Encaçapou e continua'
          : 'Passou a vez';
  return {
    rules: {
      groupA,
      turn: keep ? side : otherPoolSide(side),
      next,
      inHand: Boolean(foul),
      breakShot: false,
    },
    balls,
    foul,
    end,
    keep,
    message,
  };
}

/** Tempo esgotado: falta, com bola na mão para o adversário. */
export function timeoutRules(rules: PoolRules, mode: number): PoolRules {
  const side = rules.turn;
  return {
    ...rules,
    turn: otherPoolSide(side),
    next: { ...rules.next, [side]: (rules.next[side] + 1) % (mode === 2 ? 2 : 1) },
    inHand: true,
    breakShot: false,
  };
}

// ---------- Explicações (para quem nunca jogou) ----------

/** Uma linha do histórico das tacadas: o que aconteceu e, numa falta, por que é falta. */
export interface PoolLogEntry {
  kind: 'foul' | 'good' | 'info' | 'end';
  text: string;
  /** Explicação da regra (faltas). */
  help?: string;
}

/** Por que cada falta é falta, em palavras simples. */
export function foulHelp(foul: string): string {
  if (foul.startsWith('branca na caçapa')) {
    return 'A branca não pode cair. O adversário põe a branca onde quiser.';
  }
  if (foul.startsWith('a branca não acertou')) return 'A branca precisa acertar alguma bola.';
  if (foul.startsWith('acertou a 8 primeiro')) {
    return 'A 8 só pode ser a primeira bola acertada depois que você encaçapar o seu grupo todo.';
  }
  if (foul.startsWith('era a vez da 8')) {
    return 'Com o seu grupo todo encaçapado, a primeira bola acertada tem que ser a 8.';
  }
  if (foul.startsWith('acertou primeiro uma')) {
    return 'A primeira bola que a branca acerta tem que ser do seu grupo.';
  }
  if (foul.startsWith('nenhuma bola tocou a tabela')) {
    return 'Depois do choque, alguma bola precisa cair ou encostar numa tabela.';
  }
  return '';
}

/**
 * Acertar `ball` primeiro agora seria falta? Devolve o motivo (o mesmo do juiz), ou `null`.
 * Serve para a linha-guia ficar vermelha antes da tacada.
 */
export function firstHitFoul(
  rules: Pick<PoolRules, 'groupA' | 'breakShot'>,
  balls: PoolBalls,
  side: PoolSide,
  ball: number,
): string | null {
  if (rules.breakShot || ball === 0) return null;
  const mine = sideGroup(rules, side);
  const eight = onEight({ ...rules, turn: side, next: { a: 0, b: 0 }, inHand: false }, balls, side);
  if (!mine) return ball === 8 ? 'acertou a 8 primeiro' : null;
  if (eight) return ball === 8 ? null : 'era a vez da 8';
  if (groupOf(ball) === mine) return null;
  if (ball === 8) return 'acertou a 8 primeiro';
  return `acertou primeiro uma ${GROUP_NAMES[otherGroup(mine)].slice(0, -1)}`;
}

/** O objetivo da tacada de agora, para quem taca (`you`) ou para quem assiste. */
export function shotGoal(
  rules: Pick<PoolRules, 'groupA' | 'breakShot' | 'inHand'>,
  balls: PoolBalls,
  side: PoolSide,
  called: boolean,
): string {
  const mine = sideGroup(rules, side);
  const hand =
    rules.inHand && !rules.breakShot ? ' Bola na mão: dá para pôr a branca onde quiser.' : '';
  if (rules.breakShot) {
    return 'Abertura: ponha a branca atrás da linha, mire no triângulo e taque forte.';
  }
  if (!mine) {
    return `Mesa aberta: acerte qualquer bola, menos a 8. A primeira que cair define o grupo.${hand}`;
  }
  if (remaining(balls, mine) === 0) {
    return called
      ? `Agora é a 8, na caçapa escolhida. Se cair em outra, perde.${hand}`
      : `Agora é a 8: escolha a caçapa onde ela vai cair.${hand}`;
  }
  const left = remaining(balls, mine);
  return `Acerte primeiro uma das ${GROUP_NAMES[mine]} e encaçape (faltam ${left}).${hand}`;
}

// ---------- Mensagens e estado ----------

const furniId = z.string().min(1).max(40);
const unit = z.number().min(-1).max(1);
export const poolShotSchema = z.object({
  furniId,
  dx: unit,
  dy: unit,
  power: z.number().min(0).max(1),
  sx: unit,
  sy: unit,
  /** Bola na mão: onde a branca vai. */
  cx: z.number().min(0).max(POOL.tableL).optional(),
  cy: z.number().min(0).max(POOL.tableW).optional(),
  /** Caçapa cantada para a 8 (0–5). */
  call: z.number().int().min(0).max(5).optional(),
});
export type PoolShotMessage = z.infer<typeof poolShotSchema>;
/** Treino: muda uma bola de lugar (a branca é a 0). */
export const poolPlaceSchema = z.object({
  furniId,
  ball: z.number().int().min(0).max(15),
  x: z.number().min(0).max(POOL.tableL),
  y: z.number().min(0).max(POOL.tableW),
});
/** Dá para pôr esta bola aqui? Na mesa e sem encostar em outra. */
export function canPlaceBall(balls: PoolBalls, ball: number, pos: PoolPos): boolean {
  const [px, py] = pos;
  if (px < R || px > L - R || py < R || py > W - R) return false;
  return balls.every((b, i) => {
    if (!b || i === ball) return true;
    const dx = b[0] - px;
    const dy = b[1] - py;
    return dx * dx + dy * dy >= (2 * R + 0.001) * (2 * R + 0.001);
  });
}
/** Mira ao vivo de quem taca (para os outros verem o taco): direção, força e a branca. */
export const poolAimSchema = z.object({
  furniId,
  dx: unit,
  dy: unit,
  power: z.number().min(0).max(1),
  cx: z.number().min(0).max(POOL.tableL),
  cy: z.number().min(0).max(POOL.tableW),
});

/** A última tacada, para animar: quando começou, as posições de antes e a tacada. */
export interface PoolShotRecord extends PoolShot {
  t0: number;
  start: PoolBalls;
  ms: number;
}

export function decodeJson<T>(s: string): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
