import { arcadeView, POOL, rackBalls, type ArcadeFields, type PoolBalls } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { poolLeft, poolTransform } from './pool.js';

/** Uma partida de sinuca com estas bolas e o grupo do lado A. */
function view(balls: PoolBalls, groupA = '') {
  return arcadeView({
    kind: 'pool',
    mode: 1,
    status: 'playing',
    balls: JSON.stringify(balls),
    groupA,
  } as unknown as ArcadeFields);
}

describe('mesa de sinuca no painel (Fase 59)', () => {
  it('converte entre o pano (metros) e o canvas, com a barra de força à direita da mesa', () => {
    const tr = poolTransform(690);
    for (const p of [
      [0, 0],
      [POOL.tableL, POOL.tableW],
      [1.3, 0.4],
    ] as const) {
      const px = tr.toPx([p[0], p[1]]);
      const back = tr.toTable(px.x, px.y);
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
    // A mesa (com a tabela) cabe antes da barra; a barra cabe no canvas.
    expect(tr.toPx([POOL.tableL, 0]).x).toBeLessThan(tr.bar.x);
    expect(tr.bar.x + tr.bar.w).toBeLessThanOrEqual(690);
    expect(tr.bar.y + tr.bar.h).toBeLessThan(tr.height);
  });

  it('bolas que faltam: nenhuma com a mesa aberta, as do grupo e só a 8 no fim', () => {
    expect(poolLeft(view(rackBalls()), 'a')).toEqual([]);
    expect(poolLeft(view(rackBalls(), 'solids'), 'a')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(poolLeft(view(rackBalls(), 'solids'), 'b')).toEqual([9, 10, 11, 12, 13, 14, 15]);
    const late = rackBalls().map((b, i) => (i >= 1 && i <= 7 ? null : b));
    expect(poolLeft(view(late, 'solids'), 'a')).toEqual([8]);
    expect(poolLeft(view(late, 'stripes'), 'a')).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });
});
