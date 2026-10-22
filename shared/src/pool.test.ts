import { describe, expect, it } from 'vitest';
import {
  aimGuide,
  canPlaceCue,
  cueSpot,
  FOOT_SPOT,
  HEAD_X,
  judgeShot,
  newPoolRules,
  onEight,
  POCKETS,
  POOL,
  rackBalls,
  shooterSlot,
  simulateShot,
  timeoutRules,
  type PoolBalls,
  type PoolPos,
  type PoolRules,
  type ShotEvents,
} from './pool.js';

const { tableL: L, tableW: W, ballR: R } = POOL;
/** Mesa só com estas bolas (o resto encaçapado). */
function table(pos: Record<number, PoolPos>): PoolBalls {
  return Array.from({ length: 16 }, (_, i) => pos[i] ?? null);
}
const shot = (dx: number, dy: number, power = 0.3, sx = 0, sy = 0) => ({ dx, dy, power, sx, sy });
const dist = (a: PoolPos | null, b: PoolPos | null) => Math.hypot(a![0] - b![0], a![1] - b![1]);

describe('sinuca: a física da mesa (Fase 59)', () => {
  it('choque de frente: a branca para e a bola acertada segue', () => {
    const start = table({ 0: [0.5, 0.56], 3: [0.9, 0.56] });
    const res = simulateShot(start, shot(1, 0, 0.15));
    expect(res.events.first).toBe(3);
    // A branca fica no ponto do choque; a 3 segue em frente na mesma linha.
    expect(Math.abs(res.final[0]![0] - (0.9 - 2 * R))).toBeLessThan(0.03);
    expect(res.final[3]![0] - 0.9).toBeGreaterThan(0.2);
    expect(res.final[3]![1]).toBeCloseTo(0.56, 6);
  });

  it('a bola acertada sai na linha dos centros (para onde a linha-guia mostra)', () => {
    const start = table({ 0: [0.5, 0.5], 5: [1.0, 0.53] });
    const guide = aimGuide(start, [1, 0]);
    expect(guide).toMatchObject({ kind: 'ball', ball: 5 });
    if (guide?.kind !== 'ball') throw new Error('sem guia');
    expect(guide.ghost[0]).toBeCloseTo(1.0 - Math.sqrt(4 * R * R - 0.03 * 0.03), 6);
    const res = simulateShot(start, shot(1, 0, 0.15));
    const moved: PoolPos = [res.final[5]![0] - 1.0, res.final[5]![1] - 0.53];
    const len = Math.hypot(...moved);
    expect(moved[0] / len).toBeCloseTo(guide.objectDir[0], 2);
    expect(moved[1] / len).toBeCloseTo(guide.objectDir[1], 2);
  });

  it('na tabela a bola volta com perda; o efeito de lado muda o rebote', () => {
    const start = table({ 0: [0.6, 0.5] });
    const plain = simulateShot(start, shot(0, -1, 0.25));
    // Voltou da tabela de cima (y = 0) para baixo, e não acertou nenhuma bola.
    expect(plain.final[0]![1]).toBeGreaterThan(R);
    expect(plain.events.first).toBeNull();
    const angled = simulateShot(start, shot(0.4, -1, 0.3));
    const english = simulateShot(start, shot(0.4, -1, 0.3, 1, 0));
    expect(dist(angled.final[0]!, english.final[0]!)).toBeGreaterThan(0.05);
  });

  it('caçapas: no canto e no meio da tabela comprida', () => {
    const corner = simulateShot(table({ 0: [0.4, 0.4] }), shot(-1, -1, 0.4));
    expect(corner.events.pocketed).toEqual([{ ball: 0, pocket: 0 }]);
    expect(corner.final[0]).toBeNull();
    const side = simulateShot(table({ 0: [L / 2, 0.5], 7: [L / 2, 0.2] }), shot(0, -1, 0.3));
    expect(side.events.pocketed.map((p) => p)).toContainEqual({ ball: 7, pocket: 1 });
    expect(POCKETS).toHaveLength(6);
  });

  it('efeito para trás, a branca volta; para a frente, segue; sem efeito, para', () => {
    const start = table({ 0: [1.0, 0.56], 2: [1.3, 0.56] });
    /** Quanto a branca andou (em x) no quarto de segundo depois do choque. */
    const after = (sy: number) => {
      const res = simulateShot(start, shot(1, 0, 0.3, 0, sy), true);
      const f = res.frames!;
      const hit = f.findIndex((fr) => fr[4]! > 1.3 + 1e-6);
      return f[hit + 30]![0]! - f[hit]![0]!;
    };
    expect(after(-1)).toBeLessThan(-0.08);
    expect(after(1)).toBeGreaterThan(0.08);
    expect(Math.abs(after(0))).toBeLessThan(0.03);
  });

  it('é determinística: a mesma tacada dá exatamente o mesmo resultado, também pelo JSON', () => {
    const start = rackBalls();
    const brk = shot(1, 0.01, 1);
    const a = simulateShot(start, brk);
    const b = simulateShot(JSON.parse(JSON.stringify(start)) as PoolBalls, brk);
    expect(b.final).toEqual(a.final);
    expect(b.events).toEqual(a.events);
    // Os quadros para animar terminam nas mesmas posições.
    const rec = simulateShot(start, brk, true);
    const last = rec.frames!.at(-1)!;
    a.final.forEach((p, i) => {
      if (p) expect(last[i * 2]).toBeCloseTo(p[0], 4);
      else expect(Number.isNaN(last[i * 2]!)).toBe(true);
    });
  });

  it('a abertura espalha o triângulo; no fim ninguém fica sobreposto nem fora da mesa', () => {
    const start = rackBalls();
    expect(start[8]).toEqual([FOOT_SPOT[0] + 2 * (R * Math.sqrt(3) + 0.0002), FOOT_SPOT[1]]);
    const res = simulateShot(start, shot(1, 0, 1));
    expect(res.events.first).toBe(1);
    const moved = res.final.filter((p, i) => p && start[i] && dist(p, start[i]!) > 0.05);
    expect(moved.length).toBeGreaterThan(5);
    const on = res.final.filter(Boolean) as PoolPos[];
    for (const p of on) {
      expect(p[0]).toBeGreaterThanOrEqual(R - 0.001);
      expect(p[0]).toBeLessThanOrEqual(L - R + 0.001);
      expect(p[1]).toBeGreaterThanOrEqual(R - 0.001);
      expect(p[1]).toBeLessThanOrEqual(W - R + 0.001);
    }
    for (let i = 0; i < on.length; i++) {
      for (let j = i + 1; j < on.length; j++)
        expect(dist(on[i]!, on[j]!)).toBeGreaterThan(2 * R - 0.003);
    }
    expect(res.ms).toBeGreaterThan(1000);
  });

  it('linha-guia na tabela quando não há bola no caminho; bola na mão sem encostar', () => {
    const balls = table({ 0: [0.5, 0.5], 4: [1.5, 0.9] });
    const rail = aimGuide(balls, [0, -1]);
    if (rail?.kind !== 'rail') throw new Error('esperava a tabela');
    expect(rail.point[0]).toBeCloseTo(0.5, 9);
    expect(rail.point[1]).toBeCloseTo(R, 9);
    expect(rail.bounce[1]).toBeCloseTo(1, 9);
    expect(canPlaceCue(balls, [1.5, 0.9], false)).toBe(false);
    expect(canPlaceCue(balls, [1.2, 0.5], false)).toBe(true);
    expect(canPlaceCue(balls, [1.2, 0.5], true)).toBe(false); // abertura: atrás da linha de saída
    expect(canPlaceCue(balls, [HEAD_X - 0.1, 0.5], true)).toBe(true);
    expect(canPlaceCue(balls, [0.01, 0.5], false)).toBe(false);
  });

  it('a branca que caiu volta atrás da linha de saída, num lugar livre', () => {
    expect(cueSpot(table({}), false)).toEqual([HEAD_X, W / 2]);
    // Bolas no caminho: o lugar escolhido não encosta em nenhuma.
    const crowded = table({
      3: [HEAD_X, W / 2],
      5: [HEAD_X, W / 2 + 3 * R],
      9: [HEAD_X, W / 2 - 3 * R],
    });
    const spot = cueSpot(crowded, true);
    expect(canPlaceCue(crowded, spot, true)).toBe(true);
    expect(spot[0]).toBeLessThanOrEqual(HEAD_X);
  });
});

describe('sinuca: as regras do 8 Ball (Fase 59)', () => {
  const open: PoolRules = { ...newPoolRules(), breakShot: false, inHand: false };
  const groups: PoolRules = { ...open, groupA: 'solids' };
  const full = rackBalls();
  const ev = (over: Partial<ShotEvents> = {}): ShotEvents => ({
    first: 1,
    pocketed: [],
    railAfter: true,
    ...over,
  });
  const judge = (rules: PoolRules, e: ShotEvents, call: number | null = null, before = full) =>
    judgeShot(
      rules,
      before,
      before.map((p, i) => (e.pocketed.some((k) => k.ball === i) ? null : p)),
      e,
      call,
      1,
    );

  it('faltas: branca na caçapa, nenhuma bola, bola errada primeiro e nenhuma na tabela', () => {
    expect(judge(open, ev({ pocketed: [{ ball: 0, pocket: 2 }] }))).toMatchObject({
      foul: 'branca na caçapa',
      rules: { turn: 'b', inHand: true },
    });
    expect(judge(open, ev({ first: null })).foul).toBe('a branca não acertou nenhuma bola');
    expect(judge(open, ev({ first: 8 })).foul).toBe('acertou a 8 primeiro');
    expect(judge(groups, ev({ first: 12 })).foul).toBe('acertou primeiro uma listrada');
    expect(judge(groups, ev({ first: 3, railAfter: false })).foul).toBe(
      'nenhuma bola tocou a tabela',
    );
    // Sem falta e sem encaçapar: passa a vez, sem bola na mão.
    expect(judge(groups, ev({ first: 3 }))).toMatchObject({
      foul: null,
      keep: false,
      rules: { turn: 'b', inHand: false },
    });
  });

  it('mesa aberta: a primeira bola encaçapada define o grupo e quem acertou continua', () => {
    const res = judge(
      open,
      ev({
        first: 10,
        pocketed: [
          { ball: 10, pocket: 3 },
          { ball: 2, pocket: 1 },
        ],
      }),
    );
    expect(res).toMatchObject({ foul: null, keep: true, rules: { groupA: 'stripes', turn: 'a' } });
    // Do lado B: o A fica com o outro grupo.
    const b = judge({ ...open, turn: 'b' }, ev({ first: 4, pocketed: [{ ball: 4, pocket: 0 }] }));
    expect(b.rules.groupA).toBe('stripes');
    // Na abertura a mesa continua aberta, mas quem abriu e encaçapou continua.
    const brk = judge(
      newPoolRules(),
      ev({ first: 1, pocketed: [{ ball: 9, pocket: 5 }], railAfter: false }),
    );
    expect(brk).toMatchObject({ foul: null, keep: true, rules: { groupA: '', breakShot: false } });
  });

  it('a 8: vence na caçapa cantada depois do grupo; perde cedo, na caçapa errada ou com falta', () => {
    const cleared = full.map((p, i) => (i >= 1 && i <= 7 ? null : p));
    expect(onEight(groups, cleared, 'a')).toBe(true);
    const eightIn = (pocket: number, more: ShotEvents['pocketed'] = []) =>
      ev({ first: 8, pocketed: [{ ball: 8, pocket }, ...more] });
    expect(judge(groups, eightIn(4), 4, cleared).end).toEqual({
      winner: 'a',
      reason: 'a 8 na caçapa cantada',
    });
    expect(judge(groups, eightIn(4), 1, cleared).end).toEqual({
      winner: 'b',
      reason: 'a 8 caiu na caçapa errada',
    });
    expect(judge(groups, eightIn(4, [{ ball: 0, pocket: 2 }]), 4, cleared).end).toEqual({
      winner: 'b',
      reason: 'a 8 caiu com falta',
    });
    expect(judge(groups, ev({ first: 3, pocketed: [{ ball: 8, pocket: 0 }] })).end).toEqual({
      winner: 'b',
      reason: 'a 8 caiu antes da hora',
    });
    // Na vez da 8, acertar outra bola primeiro é falta.
    expect(judge(groups, ev({ first: 10 }), null, cleared).foul).toBe('era a vez da 8');
  });

  it('a 8 encaçapada na abertura volta para a mesa', () => {
    const res = judge(newPoolRules(), ev({ first: 1, pocketed: [{ ball: 8, pocket: 2 }] }));
    expect(res.end).toBeUndefined();
    expect(res.balls[8]).not.toBeNull();
  });

  it('2×2: as duplas alternam as tacadas; tempo esgotado é falta com bola na mão', () => {
    let rules: PoolRules = { ...open };
    const order: string[] = [];
    // Ninguém encaçapa: A1, B1, A2, B2, A1.
    for (let k = 0; k < 5; k++) {
      order.push(shooterSlot(rules, 2));
      rules = judgeShot(
        rules,
        full,
        full,
        ev({ first: rules.turn === 'a' ? 1 : 1 }),
        null,
        2,
      ).rules;
    }
    expect(order).toEqual(['a1', 'b1', 'a2', 'b2', 'a1']);
    // Quem encaçapa continua, mas a tacada seguinte é do parceiro.
    const kept = judgeShot(
      { ...open, next: { a: 0, b: 0 } },
      full,
      full.map((p, i) => (i === 2 ? null : p)),
      ev({ first: 2, pocketed: [{ ball: 2, pocket: 0 }] }),
      null,
      2,
    ).rules;
    expect(shooterSlot(kept, 2)).toBe('a2');
    expect(timeoutRules(open, 1)).toMatchObject({ turn: 'b', inHand: true });
  });
});
