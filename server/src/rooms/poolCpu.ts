import {
  canPlaceCue,
  cueSpot,
  firstHitFoul,
  HEAD_X,
  judgeShot,
  onEight,
  POCKETS,
  POOL,
  simulateShot,
  type ArcadeLevel,
  type PoolBalls,
  type PoolPos,
  type PoolRules,
  type PoolShot,
  type PoolSide,
} from '@office/shared';

/** A tacada que o computador escolheu: a tacada, onde pôs a branca (bola na mão) e a caçapa da 8. */
export interface CpuShot extends PoolShot {
  cue?: PoolPos;
  call?: number;
}

/**
 * Quanto cada nível erra e quanto ele pensa: desvio da mira (graus) e da força (fração), quantas
 * tacadas ele confere simulando (0 = nenhuma: vai no olho) e quantos lugares ele testa para a
 * branca com bola na mão.
 */
const SKILL: Record<
  ArcadeLevel,
  { aimDeg: number; power: number; verify: number; spots: number; pick: number }
> = {
  facil: { aimDeg: 1.5, power: 0.15, verify: 0, spots: 1, pick: 3 },
  medio: { aimDeg: 0.7, power: 0.07, verify: 6, spots: 8, pick: 1 },
  dificil: { aimDeg: 0.15, power: 0.02, verify: 24, spots: 30, pick: 1 },
};

const R = POOL.ballR;
const L = POOL.tableL;
const W = POOL.tableW;

interface Candidate {
  cue: PoolPos;
  ball: number;
  pocket: number;
  dir: PoolPos;
  power: number;
  /** Quanto menor, mais fácil (corte e distâncias). */
  cost: number;
}

const sub = (a: PoolPos, b: PoolPos): PoolPos => [a[0] - b[0], a[1] - b[1]];
const len = (v: PoolPos) => Math.hypot(v[0], v[1]);
const norm = (v: PoolPos): PoolPos => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};

/** Distância do ponto `p` ao segmento `a`→`b`. */
function segDist(p: PoolPos, a: PoolPos, b: PoolPos): number {
  const ab = sub(b, a);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (len(ab) ** 2 || 1)),
  );
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
}

/** O caminho de `a` até `b` está livre (nenhuma bola, fora as ignoradas, encosta)? */
function clear(balls: PoolBalls, a: PoolPos, b: PoolPos, skip: number[]): boolean {
  return balls.every((p, i) => !p || skip.includes(i) || segDist(p, a, b) >= 2 * R);
}

/** O ponto da caçapa para onde mirar: um pouco para dentro da boca. */
function pocketAim(k: number): PoolPos {
  const p = POCKETS[k]!;
  return [Math.min(L - R, Math.max(R, p.x)), Math.min(W - R, Math.max(R, p.y))];
}

/** Força (0–1) para a branca chegar com a velocidade `speed` (o inverso da curva da barra). */
function powerFor(speed: number): number {
  const p = Math.sqrt(Math.max(0, speed - POOL.minSpeed) / (POOL.maxSpeed - POOL.minSpeed));
  return Math.min(0.92, Math.max(0.22, p));
}

/** Bolas que o lado pode acertar primeiro sem falta. */
function targets(rules: PoolRules, balls: PoolBalls, side: PoolSide): number[] {
  return balls.flatMap((p, i) => (p && i !== 0 && !firstHitFoul(rules, balls, side, i) ? [i] : []));
}

/** Todas as tacadas diretas (bola e caçapa) com caminho livre, da mais fácil para a mais difícil. */
function candidates(rules: PoolRules, balls: PoolBalls, side: PoolSide, cue: PoolPos): Candidate[] {
  const out: Candidate[] = [];
  const table = balls.slice();
  table[0] = cue;
  for (const ball of targets(rules, table, side)) {
    const t = table[ball]!;
    POCKETS.forEach((_, k) => {
      const aim = pocketAim(k);
      const toPocket = norm(sub(aim, t));
      const ghost: PoolPos = [t[0] - toPocket[0] * 2 * R, t[1] - toPocket[1] * 2 * R];
      const toGhost = sub(ghost, cue);
      const d1 = len(toGhost);
      if (d1 < 1e-3) return;
      const dir = norm(toGhost);
      const cos = dir[0] * toPocket[0] + dir[1] * toPocket[1];
      // Corte fino demais não entra.
      if (cos < Math.cos((78 * Math.PI) / 180)) return;
      if (!clear(table, cue, ghost, [0, ball])) return;
      if (!clear(table, t, aim, [0, ball])) return;
      const d2 = len(sub(aim, t));
      // A bola acertada sai com ~cos da velocidade; precisa chegar com folga na caçapa.
      const objectSpeed = Math.sqrt(2 * 0.6 * d2) + 0.5;
      const contact = objectSpeed / Math.max(0.3, cos);
      const speed = Math.sqrt(contact * contact + 2 * 0.6 * d1);
      out.push({ cue, ball, pocket: k, dir, power: powerFor(speed), cost: (d1 + d2 * 1.5) / cos });
    });
  }
  return out.sort((a, b) => a.cost - b.cost);
}

/** A tacada dá certo de verdade? Simula e julga: a bola cai, sem falta e sem perder. */
function works(rules: PoolRules, balls: PoolBalls, c: Candidate, mode: number): boolean {
  const start = balls.slice();
  start[0] = c.cue;
  const res = simulateShot(start, { dx: c.dir[0], dy: c.dir[1], power: c.power, sx: 0, sy: 0 });
  const verdict = judgeShot(rules, start, res.final, res.events, c.pocket, mode);
  if (verdict.foul || (verdict.end && verdict.end.winner !== rules.turn)) return false;
  return res.events.pocketed.some((p) => p.ball === c.ball);
}

/** Desvio aleatório com a forma de sino (média 0, desvio `sd`). */
function gauss(random: () => number, sd: number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
}

/** Lugares para a branca com bola na mão: o de sempre e outros espalhados (atrás da linha na abertura). */
function cueSpots(balls: PoolBalls, rules: PoolRules, n: number, random: () => number): PoolPos[] {
  const spots: PoolPos[] = [cueSpot(balls, rules.breakShot)];
  const maxX = rules.breakShot ? HEAD_X : L - R;
  for (let tries = 0; spots.length < n && tries < n * 6; tries++) {
    const p: PoolPos = [R + random() * (maxX - R), R + random() * (W - 2 * R)];
    if (canPlaceCue(balls, p, rules.breakShot)) spots.push(p);
  }
  return spots;
}

/**
 * Escolhe a tacada do computador (Fase de jogar sozinho). Procura as tacadas diretas com caminho
 * livre (bola certa, caçapa, corte possível), confere as melhores simulando (médio e difícil) e
 * erra a mira e a força conforme o nível. Sem nada que dê, taca de leve numa bola certa para não
 * fazer falta. Na vez da 8, canta a caçapa da tacada.
 */
export function chooseShot(
  rules: PoolRules,
  balls: PoolBalls,
  level: ArcadeLevel,
  mode = 1,
  random: () => number = Math.random,
): CpuShot {
  const side = rules.turn;
  const skill = SKILL[level];
  const blur = (shot: CpuShot): CpuShot => {
    const a = (gauss(random, skill.aimDeg) * Math.PI) / 180;
    const [x, y] = [shot.dx, shot.dy];
    return {
      ...shot,
      dx: x * Math.cos(a) - y * Math.sin(a),
      dy: x * Math.sin(a) + y * Math.cos(a),
      power: Math.min(1, Math.max(0.05, shot.power * (1 + gauss(random, skill.power)))),
    };
  };
  // Abertura: forte, no meio do triângulo.
  if (rules.breakShot) {
    const cue: PoolPos = [HEAD_X - 0.05, W / 2 + (random() - 0.5) * 0.2];
    const apex = balls[1] ?? [L * 0.75, W / 2];
    const dir = norm(sub(apex, cue));
    return blur({ dx: dir[0], dy: dir[1], power: level === 'facil' ? 0.8 : 1, sx: 0, sy: 0, cue });
  }
  const spots = rules.inHand ? cueSpots(balls, rules, skill.spots, random) : [balls[0]!];
  let all = spots.flatMap((cue) => candidates(rules, balls, side, cue));
  all = all.sort((a, b) => a.cost - b.cost);
  let chosen: Candidate | undefined;
  if (skill.verify > 0) {
    chosen = all.slice(0, skill.verify).find((c) => works(rules, balls, c, mode));
  }
  // Fácil (ou nada conferido deu): uma das mais fáceis, no olho.
  chosen ??= all[Math.floor(random() * Math.min(skill.pick, all.length))];
  const eight = onEight(rules, balls, side);
  if (chosen) {
    return blur({
      dx: chosen.dir[0],
      dy: chosen.dir[1],
      power: chosen.power,
      sx: 0,
      sy: 0,
      ...(rules.inHand ? { cue: chosen.cue } : {}),
      ...(eight ? { call: chosen.pocket } : {}),
    });
  }
  // Nenhuma tacada direta: encosta de leve numa bola certa (a mais perto), para não fazer falta.
  const cue = spots[0]!;
  const table = balls.slice();
  table[0] = cue;
  const near = targets(rules, table, side)
    .map((i) => ({ i, d: len(sub(table[i]!, cue)) }))
    .sort((a, b) => a.d - b.d)[0];
  const to = near ? table[near.i]! : [L / 2, W / 2];
  const dir = norm(sub(to as PoolPos, cue));
  const call = eight
    ? POCKETS.map((p, k) => ({ k, d: len(sub([p.x, p.y], to as PoolPos)) })).sort(
        (a, b) => a.d - b.d,
      )[0]!.k
    : undefined;
  return blur({
    dx: dir[0],
    dy: dir[1],
    power: 0.5,
    sx: 0,
    sy: 0,
    ...(rules.inHand ? { cue } : {}),
    ...(call !== undefined ? { call } : {}),
  });
}
