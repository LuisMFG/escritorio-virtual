import { describe, expect, it } from 'vitest';
import { analyzeRender, buildFurniEntry, estimateSize, type RgbaImage } from './furniCatalog.js';

/** Imagem transparente com retângulos opacos. */
function image(
  width: number,
  height: number,
  rects: [number, number, number, number][],
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) data[(y * width + x) * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('analyzeRender', () => {
  it('âncora no centro da linha opaca mais baixa', () => {
    const img = image(96, 60, [
      [0, 0, 95, 40],
      [62, 41, 65, 59],
    ]);
    const a = analyzeRender(img);
    expect(a.anchor).toEqual([63.5, 59]);
    expect(a.leftTiles).toBeCloseTo(63.5 / 32);
  });

  it('imagem vazia não quebra', () => {
    expect(analyzeRender(image(10, 10, [])).anchor).toEqual([5, 10]);
  });
});

describe('estimateSize', () => {
  it('usa as duas direções quando existem (sofá 2×1)', () => {
    const byDir = new Map([
      [0, { anchor: [61.5, 71] as [number, number], leftTiles: 61.5 / 32, rightTiles: 0.7 }],
      [2, { anchor: [18.5, 81] as [number, number], leftTiles: 18.5 / 32, rightTiles: 2 }],
    ]);
    expect(estimateSize(byDir)).toEqual({ width: 2, depth: 1 });
  });

  it('com uma direção só usa os dois lados da âncora (tapete 3×5)', () => {
    const byDir = new Map([
      [
        0,
        { anchor: [94.5, 128] as [number, number], leftTiles: 94.5 / 32, rightTiles: 167.5 / 32 },
      ],
    ]);
    expect(estimateSize(byDir)).toEqual({ width: 3, depth: 5 });
  });
});

describe('buildFurniEntry', () => {
  it('prefere o tamanho da curadoria e grava âncoras por direção', () => {
    const analyses = new Map([[0, analyzeRender(image(52, 55, [[20, 0, 30, 54]]))]]);
    const { entry, estimated } = buildFurniEntry(
      { id: 'x', name: 'X', category: 'teste', width: 2, depth: 2, height: 1 },
      { latest: 123, directions: [0] },
      analyses,
    );
    expect(entry).toMatchObject({ width: 2, depth: 2, revision: 123, anchors: { '0': [25, 54] } });
    expect(estimated).toEqual({ width: 1, depth: 1 });
  });
});
