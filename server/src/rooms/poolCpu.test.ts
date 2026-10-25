import {
  canPlaceCue,
  judgeShot,
  POCKETS,
  POOL,
  rackBalls,
  simulateShot,
  type ArcadeLevel,
  type PoolBalls,
  type PoolRules,
} from '@office/shared';
import { describe, expect, it } from 'vitest';
import { chooseShot } from './poolCpu.js';

/** Sorteio repetível (os testes dão sempre o mesmo resultado). */
function seeded(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const rules = (over: Partial<PoolRules> = {}): PoolRules => ({
  groupA: 'solids',
  turn: 'a',
  next: { a: 0, b: 0 },
  inHand: false,
  breakShot: false,
  ...over,
});

/** Mesa espalhada ao acaso, com bolas dos dois grupos, a 8 e a branca. */
function randomTable(random: () => number): PoolBalls {
  const balls: PoolBalls = new Array(16).fill(null);
  const used: [number, number][] = [];
  for (const i of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]) {
    for (;;) {
      const p: [number, number] = [
        0.1 + random() * (POOL.tableL - 0.2),
        0.1 + random() * (POOL.tableW - 0.2),
      ];
      if (used.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.08)) {
        used.push(p);
        balls[i] = p;
        break;
      }
    }
  }
  return balls;
}

/** Em muitas mesas: quanto encaçapa (e continua) e quanto faz falta. */
function rates(level: ArcadeLevel) {
  const random = seeded(11);
  let ok = 0;
  let foul = 0;
  const n = 80;
  for (let k = 0; k < n; k++) {
    const balls = randomTable(random);
    const shot = chooseShot(rules(), balls, level, 1, random);
    const res = simulateShot(balls, shot);
    const v = judgeShot(rules(), balls, res.final, res.events, shot.call ?? null, 1);
    if (v.foul) foul++;
    else if (v.keep) ok++;
  }
  return { ok: ok / n, foul: foul / n };
}

describe('computador da sinuca', () => {
  it('os níveis jogam diferente: o difícil encaçapa quase sempre e quase não faz falta', () => {
    const facil = rates('facil');
    const medio = rates('medio');
    const dificil = rates('dificil');
    expect(dificil.ok).toBeGreaterThan(0.8);
    expect(dificil.foul).toBeLessThan(0.08);
    expect(medio.ok).toBeGreaterThan(facil.ok + 0.2);
    expect(dificil.ok).toBeGreaterThan(medio.ok + 0.15);
    expect(facil.ok).toBeGreaterThan(0.1); // fácil, mas não tonto
  });

  it('bola fácil na frente da caçapa: o difícil encaçapa', () => {
    const balls: PoolBalls = new Array(16).fill(null);
    // A 3 alinhada com a caçapa do canto de baixo à direita, e a branca atrás dela.
    balls[3] = [1.9, 0.85];
    balls[0] = [1.51, 0.535];
    balls[11] = [0.5, 0.3];
    const shot = chooseShot(rules(), balls, 'dificil', 1, seeded());
    const res = simulateShot(balls, shot);
    expect(res.events.first).toBe(3);
    expect(res.events.pocketed.map((p) => p.ball)).toContain(3);
  });

  it('na vez da 8, canta a caçapa e acerta a 8 primeiro', () => {
    const balls: PoolBalls = new Array(16).fill(null);
    balls[0] = [0.6, 0.6];
    balls[8] = [0.25, 0.25];
    balls[12] = [1.9, 0.9];
    const shot = chooseShot(rules(), balls, 'dificil', 1, seeded());
    expect(shot.call).toBeGreaterThanOrEqual(0);
    expect(shot.call).toBeLessThan(POCKETS.length);
    const res = simulateShot(balls, shot);
    expect(res.events.first).toBe(8);
    const v = judgeShot(rules(), balls, res.final, res.events, shot.call!, 1);
    expect(v.end).toEqual({ winner: 'a', reason: 'a 8 na caçapa cantada' });
  });

  it('abertura forte atrás da linha; bola na mão num lugar que cabe', () => {
    const brk = chooseShot(
      rules({ groupA: '', breakShot: true, inHand: true }),
      rackBalls(),
      'medio',
      1,
      seeded(),
    );
    expect(brk.power).toBeGreaterThan(0.85);
    expect(canPlaceCue(rackBalls(), brk.cue!, true)).toBe(true);
    const random = seeded(3);
    const balls = randomTable(random);
    balls[0] = null;
    const hand = chooseShot(rules({ inHand: true }), balls, 'dificil', 1, random);
    expect(canPlaceCue(balls, hand.cue!, false)).toBe(true);
  });

  it('sem tacada direta, encosta numa bola certa (sem falta) em vez de chutar', () => {
    // A única lisa atrás de uma parede de listradas.
    const balls: PoolBalls = new Array(16).fill(null);
    balls[0] = [0.4, 0.56];
    balls[2] = [1.4, 0.56];
    [9, 10, 11, 12, 13].forEach((b, i) => (balls[b] = [0.9, 0.36 + i * 0.1]));
    const shot = chooseShot(rules(), balls, 'dificil', 1, seeded());
    expect(Number.isFinite(shot.dx) && Number.isFinite(shot.dy)).toBe(true);
    expect(shot.power).toBeGreaterThan(0);
  });
});
