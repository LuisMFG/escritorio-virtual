import { describe, expect, it } from 'vitest';
import {
  composeFigure,
  FIGURE_WIDTH,
  partsWithoutArt,
  resolveFigure,
  type FigureData,
  type FigureLib,
} from './figureRender.js';

/** Biblioteca de mentira: cada parte é um quadrado 2×2 branco ou de uma cor. */
function lib(assets: Record<string, { x: number; y: number; color?: number[] }>): FigureLib {
  const names = Object.keys(assets);
  const width = names.length * 2;
  const pixels = new Uint8Array(width * 2 * 4);
  const frames: FigureLib['frames'] = {};
  names.forEach((n, i) => {
    frames[n] = { x: i * 2, y: 0, w: 2, h: 2 };
    const c = assets[n]!.color ?? [255, 255, 255];
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      pixels.set([...c, 255], (y! * width + i * 2 + x!) * 4);
  });
  return {
    width,
    height: 2,
    pixels,
    frames,
    assets: Object.fromEntries(names.map((n) => [n, { x: assets[n]!.x, y: assets[n]!.y }])),
  };
}

const DATA: FigureData = {
  libs: { body: 1, hair: 1, hats: 1 },
  swf: {},
  partLib: {
    'bd:1': 'body',
    'hd:1': 'body',
    'hr:5': 'hair',
    'hrb:5': 'hair',
    'ha:9': 'hats',
    'fc:77': 'hats',
  },
  sets: {
    'hd:180': {
      p: 1,
      parts: [
        ['bd', 1, 1, 1],
        ['hd', 1, 1, 1],
      ],
    },
    'hr:828': {
      p: 2,
      parts: [
        ['hr', 5, 1, 1],
        ['hrb', 5, 1, 1],
      ],
    },
    'ha:1009': { p: 3, parts: [['ha', 9, 0, 1]], hide: ['hrb'] },
    'hd:6022': {
      p: 1,
      parts: [
        ['hd', 1, 1, 1],
        ['fc', 77, 0, 1],
      ],
    },
  },
  palettes: { '1': { '1': 'FF8040' }, '2': { '61': '202020' } },
};

const px = (out: Uint8ClampedArray, x: number, y: number) => [
  ...out.subarray((y * FIGURE_WIDTH + x) * 4, (y * FIGURE_WIDTH + x) * 4 + 4),
];

describe('montagem do avatar', () => {
  it('resolve partes, cores e o que falta', () => {
    const r = resolveFigure('hd-180-1.hr-828-61.xx-1-1', DATA);
    expect(r.missing).toEqual(['xx-1-1']);
    expect(r.libs.sort()).toEqual(['body', 'hair']);
    expect(r.parts.find((p) => p.type === 'bd')?.tint).toEqual([255, 128, 64]);
    // Sem chapéu: só a parte grande do cabelo.
    expect(r.parts.map((p) => p.type)).toEqual(['bd', 'hd', 'hrb']);
    // Com chapéu (que esconde `hrb`): a curta, por baixo do chapéu.
    expect(resolveFigure('hr-828-61.ha-1009', DATA).parts.map((p) => p.type)).toEqual(['hr', 'ha']);
  });

  it('pinta multiplicando, empilha na ordem e espelha as direções 4–6', () => {
    const libs = new Map([
      [
        'body',
        lib({
          h_std_bd_1_2_0: { x: -10, y: 50 },
          h_std_hd_1_2_0: { x: -10, y: 50, color: [0, 0, 255] },
        }),
      ],
    ]);
    const parts = resolveFigure('hd-180-1', DATA).parts;
    const out = composeFigure(parts, libs, { direction: 2 });
    // Desenho em (REG_X − x, REG_Y − y) = (10, 50); a cabeça (azul × laranja) fica por cima.
    expect(px(out, 10, 50)).toEqual([0, 0, 64, 255]);
    expect(px(out, 12, 50)[3]).toBe(0);
    const mirrored = composeFigure(parts, libs, { direction: 4 });
    expect(px(mirrored, FIGURE_WIDTH - 1 - 10, 50)).toEqual([0, 0, 64, 255]);
    expect(px(mirrored, 10, 50)[3]).toBe(0);
  });

  it('pose sem desenho cai para a pose em pé; cabeça sempre em pé', () => {
    const libs = new Map([
      [
        'body',
        lib({
          h_std_bd_1_2_0: { x: -10, y: 50 },
          h_wlk_bd_1_2_1: { x: -20, y: 50 },
          h_std_hd_1_2_0: { x: -30, y: 50 },
          h_wlk_hd_1_2_1: { x: -40, y: 50 },
        }),
      ],
    ]);
    const parts = resolveFigure('hd-180-1', DATA).parts;
    const walk = composeFigure(parts, libs, { direction: 2, action: 'wlk', frame: 1 });
    expect(px(walk, 20, 50)[3]).toBe(255);
    expect(px(walk, 10, 50)[3]).toBe(0);
    expect(px(walk, 30, 50)[3]).toBe(255);
    expect(px(walk, 40, 50)[3]).toBe(0);
    const sit = composeFigure(parts, libs, { direction: 2, action: 'sit' });
    expect(px(sit, 10, 50)[3]).toBe(255);
  });

  it('acusa parte sem desenho (para usar o imager)', () => {
    const libs = new Map([
      ['body', lib({ h_std_hd_1_2_0: { x: 0, y: 0 } })],
      ['hats', lib({})],
    ]);
    const missing = partsWithoutArt(resolveFigure('hd-6022-1', DATA).parts, libs);
    expect(missing.map((p) => `${p.type}:${p.id}`)).toEqual(['fc:77']);
  });
});
