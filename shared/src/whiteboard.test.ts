import { describe, expect, it } from 'vitest';
import { splitPoints, WB_MAX_POINTS, wbStrokeInputSchema } from './whiteboard.js';

describe('quadro branco', () => {
  it('traços longos viram pedaços contínuos de até WB_MAX_POINTS', () => {
    const pts = Array.from({ length: (WB_MAX_POINTS + 150) * 2 }, (_, i) => i % 900);
    const parts = splitPoints(pts);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.length <= WB_MAX_POINTS * 2)).toBe(true);
    // O segundo começa no último ponto do primeiro (sem buraco no traço).
    expect(parts[1]!.slice(0, 2)).toEqual(parts[0]!.slice(-2));
    expect(splitPoints([1, 2, 3, 4])).toEqual([[1, 2, 3, 4]]);
  });

  it('valida pincel, borracha e texto', () => {
    expect(
      wbStrokeInputSchema.safeParse({
        tool: 'pen',
        color: '#1f2937',
        width: 3,
        points: [1, 2, 3, 4],
      }).success,
    ).toBe(true);
    expect(
      wbStrokeInputSchema.safeParse({ tool: 'pen', color: '#1f2937', width: 3, points: [1, 2, 3] })
        .success,
    ).toBe(false);
    expect(
      wbStrokeInputSchema.safeParse({
        tool: 'text',
        color: '#dc2626',
        width: 32,
        x: 10,
        y: 20,
        text: '  Pauta  da semana ',
      }),
    ).toMatchObject({ success: true, data: { text: 'Pauta da semana' } });
    expect(
      wbStrokeInputSchema.safeParse({ tool: 'laser', color: '#000000', width: 3, points: [] })
        .success,
    ).toBe(false);
  });
});
