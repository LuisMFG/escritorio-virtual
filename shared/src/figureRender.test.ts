import { describe, expect, it } from 'vitest';
import {
  partsWithoutArt,
  canvasFor,
  composeFigure,
  FIGURE_WIDTH,
  type FigureData,
  type FigureLib,
  LAY_CANVAS,
  layFacing,
  needsWideCanvas,
  sitFacing,
  poseKey,
  resolveFigure,
  STAND_CANVAS,
  WIDE_CANVAS,
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
    const walk = composeFigure(parts, libs, { direction: 2, posture: 'wlk', frame: 1 });
    expect(px(walk, 20, 50)[3]).toBe(255);
    expect(px(walk, 10, 50)[3]).toBe(0);
    expect(px(walk, 30, 50)[3]).toBe(255);
    expect(px(walk, 40, 50)[3]).toBe(0);
    const sit = composeFigure(parts, libs, { direction: 2, posture: 'sit' });
    expect(px(sit, 10, 50)[3]).toBe(255);
  });

  it('gesto no braço certo, fala na cabeça e na boca, expressão nos olhos', () => {
    const data: FigureData = {
      ...DATA,
      partLib: { ...DATA.partLib, 'lh:1': 'body', 'rh:1': 'body', 'ey:1': 'body', 'fc:1': 'body' },
      sets: {
        'hd:1': {
          p: 1,
          parts: [
            ['lh', 1, 0, 1],
            ['rh', 1, 0, 1],
            ['hd', 1, 0, 1],
            ['ey', 1, 0, 1],
            ['fc', 1, 0, 1],
          ],
        },
      },
    };
    const at = (x: number) => ({ x: -x, y: 50 });
    const libs = new Map([
      [
        'body',
        lib({
          h_std_lh_1_2_0: at(0),
          h_wav_lh_1_2_1: at(2),
          h_std_rh_1_2_0: at(4),
          h_blw_rh_1_2_0: at(6),
          h_std_hd_1_2_0: at(8),
          h_spk_hd_1_2_1: at(10),
          h_std_ey_1_2_0: at(12),
          h_eyb_ey_1_2_0: at(14),
          h_std_fc_1_2_0: at(16),
          h_spk_fc_1_2_1: at(18),
          h_sml_fc_1_2_0: at(20),
          // Desenho próprio da direção 4 (sem espelhar) para o aceno.
          h_wav_lh_1_4_1: at(22),
        }),
      ],
    ]);
    const parts = resolveFigure('hd-1', data).parts;
    const on = (out: Uint8ClampedArray, x: number) => px(out, x, 50)[3] === 255;
    const wave = composeFigure(parts, libs, { direction: 2, gesture: 'wav', gestureFrame: 1 });
    expect([on(wave, 0), on(wave, 2), on(wave, 4)]).toEqual([false, true, true]);
    const talk = composeFigure(parts, libs, {
      direction: 2,
      talk: true,
      talkFrame: 1,
      expression: 'sml',
    });
    // Falando, a boca mexe (a fala vence o sorriso); a cabeça usa o quadro de fala.
    expect([on(talk, 8), on(talk, 10), on(talk, 16), on(talk, 18), on(talk, 20)]).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
    const smile = composeFigure(parts, libs, { direction: 2, expression: 'sml' });
    expect([on(smile, 16), on(smile, 20)]).toEqual([false, true]);
    const blink = composeFigure(parts, libs, { direction: 2, expression: 'eyb' });
    expect([on(blink, 12), on(blink, 14), on(blink, 16)]).toEqual([false, true, true]);
    const kiss = composeFigure(parts, libs, { direction: 2, gesture: 'blw' });
    expect([on(kiss, 4), on(kiss, 6)]).toEqual([false, true]);
    // Direção 4: aceno com desenho próprio fica no lugar (sem espelho). O braço direito usa o
    // desenho do esquerdo da direção 2, espelhado (como no Habbo): fica um braço de cada lado.
    const wave4 = composeFigure(parts, libs, { direction: 4, gesture: 'wav', gestureFrame: 1 });
    expect(on(wave4, 22)).toBe(true);
    expect(on(wave4, FIGURE_WIDTH - 1 - 0)).toBe(true);
    expect(on(wave4, FIGURE_WIDTH - 1 - 4)).toBe(false);
  });

  describe('braços, gestos e itens (Fase 52)', () => {
    const data: FigureData = {
      ...DATA,
      libs: { ...DATA.libs, hh_human_item: 1 },
      partLib: { ...DATA.partLib, 'lh:1': 'body', 'rh:1': 'body', 'ls:1': 'body' },
      sets: {
        'hd:1': {
          p: 1,
          parts: [
            ['lh', 1, 0, 1],
            ['rh', 1, 0, 1],
            ['ls', 1, 0, 1],
            ['hd', 1, 0, 1],
          ],
        },
      },
    };
    const at = (x: number) => ({ x: -x, y: 50 });
    const on = (out: Uint8ClampedArray, x: number) => px(out, x, 50)[3] === 255;
    const parts = resolveFigure('hd-1', data).parts;
    const mirror = (x: number) => FIGURE_WIDTH - 1 - x;

    it('segurando o copo nas direções 4–6 aparecem os dois braços (antes o da frente sumia)', () => {
      const libs = new Map([
        [
          'body',
          lib({
            h_std_lh_1_2_0: at(0),
            h_std_rh_1_2_0: at(4),
            // Braço direito segurando, com desenho próprio da direção 4 (é o braço de trás).
            h_crr_rh_1_4_0: at(30),
            h_std_hd_1_2_0: at(8),
          }),
        ],
        ['hh_human_item', lib({ h_crr_ri_43_4_0: at(34) })],
      ]);
      const out = composeFigure(parts, libs, { direction: 4, gesture: 'crr', handItem: 43 });
      expect(on(out, 30)).toBe(true); // braço que segura (de trás)
      expect(on(out, 34)).toBe(true); // o copo
      // O braço da frente é o esquerdo, com o desenho do direito da direção 2 espelhado.
      expect(on(out, mirror(4))).toBe(true);
      expect(on(out, mirror(0))).toBe(false);
    });

    it('deitado não faz gesto com o braço (só o rosto muda)', () => {
      const libs = new Map([
        [
          'body',
          lib({
            h_lay_lh_1_2_0: at(0),
            h_wav_lh_1_2_0: at(2),
            h_lay_hd_1_2_0: at(8),
          }),
        ],
      ]);
      const out = composeFigure(
        parts,
        libs,
        { direction: 2, posture: 'lay', gesture: 'wav' },
        LAY_CANVAS,
      );
      // No quadro de deitado (128 de largura, eixo em 32): braço deitado, nada do aceno.
      const pxl = (x: number) => out[(50 * LAY_CANVAS.width + LAY_CANVAS.regX + x) * 4 + 3] === 255;
      expect([pxl(0), pxl(2)]).toEqual([true, false]);
    });

    it('acenando com o copo na mão: o braço esquerdo acena e o direito segura o item', () => {
      const libs = new Map([
        [
          'body',
          lib({
            h_std_lh_1_2_0: at(0),
            h_wav_lh_1_2_0: at(2),
            h_std_rh_1_2_0: at(4),
            h_crr_rh_1_2_0: at(6),
            h_std_hd_1_2_0: at(8),
          }),
        ],
        ['hh_human_item', lib({ h_crr_ri_43_2_0: at(10) })],
      ]);
      const out = composeFigure(parts, libs, {
        direction: 2,
        gesture: 'wav',
        handGesture: 'crr',
        handItem: 43,
      });
      expect([on(out, 0), on(out, 2), on(out, 4), on(out, 6), on(out, 10)]).toEqual([
        false,
        true,
        false,
        true,
        true,
      ]);
    });

    it('falando, o quadro que falta cai na pose parada (o cabelo não pula)', () => {
      const libs = new Map([
        [
          'body',
          lib({
            h_std_hd_1_2_0: at(8),
            // Só o quadro 0 da fala, deslocado.
            h_spk_hd_1_2_0: at(12),
          }),
        ],
      ]);
      const f1 = composeFigure(parts, libs, { direction: 2, talk: true, talkFrame: 1 });
      expect([on(f1, 8), on(f1, 12)]).toEqual([true, false]);
      const f0 = composeFigure(parts, libs, { direction: 2, talk: true, talkFrame: 0 });
      expect([on(f0, 8), on(f0, 12)]).toEqual([false, true]);
    });

    it('a manga acompanha o joinha (usa o desenho do aceno) em vez de ficar parada', () => {
      const libs = new Map([
        [
          'body',
          lib({
            h_std_lh_1_2_0: at(0),
            h_respect_lh_1_2_0: at(2),
            h_std_ls_1_2_0: at(14),
            h_wav_ls_1_2_0: at(16),
            h_std_hd_1_2_0: at(8),
          }),
        ],
      ]);
      const out = composeFigure(parts, libs, { direction: 2, gesture: 'respect' });
      expect([on(out, 2), on(out, 14), on(out, 16)]).toEqual([true, false, true]);
    });

    it('a chave de cache separa o item segurado durante um gesto', () => {
      expect(poseKey({ direction: 2, gesture: 'wav' })).not.toBe(
        poseKey({ direction: 2, gesture: 'wav', handGesture: 'crr' }),
      );
    });
  });

  it('deitado usa a direção 2 (ou o espelho, 4) e a cabeça deitada', () => {
    const libs = new Map([
      [
        'body',
        lib({
          h_lay_bd_1_2_0: { x: -5, y: 30 },
          h_lay_hd_1_2_0: { x: -7, y: 30 },
          h_std_hd_1_2_0: { x: -9, y: 30 },
        }),
      ],
    ]);
    const parts = resolveFigure('hd-180-1', DATA).parts;
    const lay = composeFigure(parts, libs, { direction: 2, posture: 'lay' });
    expect([px(lay, 5, 70)[3], px(lay, 7, 70)[3], px(lay, 9, 70)[3]]).toEqual([255, 255, 0]);
    const lay6 = composeFigure(parts, libs, { direction: 6, posture: 'lay' });
    expect(px(lay6, FIGURE_WIDTH - 1 - 5, 70)[3]).toBe(255);
    // A mesma regra do servidor (`layDirection`): 3 deita para a esquerda (espelho), 7 e 0 para
    // a direita.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(layFacing)).toEqual([2, 2, 2, 4, 4, 4, 4, 2]);
    const lay3 = composeFigure(parts, libs, { direction: 3, posture: 'lay' });
    expect(px(lay3, FIGURE_WIDTH - 1 - 5, 70)[3]).toBe(255);
  });

  it('sentado numa direção ímpar usa a par anterior (antes caía no desenho em pé)', () => {
    const libs = new Map([
      [
        'body',
        lib({
          h_std_bd_1_2_0: { x: -10, y: 50 },
          h_std_bd_1_3_0: { x: -12, y: 50 },
          h_sit_bd_1_2_0: { x: -20, y: 50 },
        }),
      ],
    ]);
    const parts = resolveFigure('hd-180-1', DATA).parts;
    const sit3 = composeFigure(parts, libs, { direction: 3, posture: 'sit' });
    expect([px(sit3, 20, 50)[3], px(sit3, 12, 50)[3]]).toEqual([255, 0]);
    expect([1, 3, 5, 7].map(sitFacing)).toEqual([0, 2, 4, 6]);
  });

  it('roupa animada alterna os quadros da pose em pé', () => {
    const data: FigureData = {
      ...DATA,
      partLib: { ...DATA.partLib, 'he:7': 'body' },
      sets: { ...DATA.sets, 'he:900': { p: 1, parts: [['he', 7, 0, 1]], a: 1 } },
    };
    const libs = new Map([
      [
        'body',
        lib({
          h_std_he_7_2_0: { x: 0, y: 50 },
          h_std_he_7_2_1: { x: -2, y: 50 },
          h_std_he_7_2_2: { x: -4, y: 50 },
        }),
      ],
    ]);
    const parts = resolveFigure('he-900', data).parts;
    expect(parts[0]!.animated).toBe(true);
    const at = (clothingFrame: number) => {
      const out = composeFigure(parts, libs, { direction: 2, clothingFrame });
      return [0, 2, 4].findIndex((x) => px(out, x, 50)[3] === 255);
    };
    // 3 quadros: 1 → 1, 2 → 2, 3 → 0, 4 → 1.
    expect([at(1), at(2), at(3), at(4)]).toEqual([1, 2, 0, 1]);
  });

  it('chave de cache muda só com o que muda o desenho', () => {
    expect(poseKey({ direction: 2 })).toBe(
      poseKey({ direction: 2, posture: 'std', frame: 0, gestureFrame: 3 }),
    );
    expect(poseKey({ direction: 2, talk: true })).not.toBe(poseKey({ direction: 2 }));
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

describe('quadro largo (pet de ombro e itens diversos)', () => {
  it('usa o quadro largo só quando a figura tem pt/mc, e o deitado continua o seu', () => {
    expect(needsWideCanvas([{ type: 'ch' }, { type: 'ptl' }])).toBe(true);
    expect(needsWideCanvas([{ type: 'mcr' }])).toBe(true);
    expect(needsWideCanvas([{ type: 'ch' }, { type: 'hr' }])).toBe(false);
    expect(canvasFor({ posture: 'std' }, true)).toEqual(WIDE_CANVAS);
    expect(canvasFor({ posture: 'std' })).toEqual(STAND_CANVAS);
    expect(canvasFor({ posture: 'lay' }, true)).toEqual(LAY_CANVAS);
    // Mesmo eixo: os pés não mudam de lugar ao trocar de quadro.
    expect(WIDE_CANVAS.regY).toBe(STAND_CANVAS.regY);
  });
});

describe('pose por parte do corpo (Fase 54)', () => {
  const data: FigureData = {
    ...DATA,
    partLib: { ...DATA.partLib, 'lh:1': 'body', 'rh:1': 'body' },
    sets: {
      'hd:1': {
        p: 1,
        parts: [
          ['lh', 1, 0, 1],
          ['rh', 1, 0, 1],
          ['hd', 1, 0, 1],
        ],
      },
    },
  };
  const at = (x: number) => ({ x: -x, y: 50 });
  const on = (out: Uint8ClampedArray, x: number, y = 50) => px(out, x, y)[3] === 255;
  const parts = resolveFigure('hd-1', data).parts;
  const mirror = (x: number) => FIGURE_WIDTH - 1 - x;
  const libs = new Map([
    [
      'body',
      lib({
        h_std_lh_1_2_0: at(0),
        h_crr_lh_1_2_0: at(10),
        h_lay_lh_1_2_0: at(14),
        h_std_rh_1_2_0: at(4),
        h_std_hd_1_2_0: at(20),
        h_std_hd_1_3_0: at(30),
        h_lay_hd_1_2_0: at(40),
      }),
    ],
  ]);

  it('cada grupo usa a sua ação: o braço esquerdo carrega e o direito fica parado', () => {
    const out = composeFigure(parts, libs, {
      direction: 2,
      parts: { leftArm: { action: 'crr' } },
    });
    expect(on(out, 10)).toBe(true);
    expect(on(out, 0)).toBe(false);
    expect(on(out, 4)).toBe(true);
  });

  it('deslocamento por grupo; no espelho o x inverte junto', () => {
    const pose = { parts: { head: { dx: 3, dy: 2 } } };
    const right = composeFigure(parts, libs, { direction: 2, ...pose });
    expect(on(right, 23, 52)).toBe(true);
    expect(on(right, 20, 50)).toBe(false);
    // Direção 4 = espelho da 2: a cabeça vai 3 px para o outro lado.
    const left = composeFigure(parts, libs, { direction: 4, ...pose });
    expect(on(left, mirror(23), 52)).toBe(true);
  });

  it('giro do grupo: a cabeça olha para a direção vizinha', () => {
    const out = composeFigure(parts, libs, { direction: 2, parts: { head: { dd: 1 } } });
    expect(on(out, 30)).toBe(true);
    expect(on(out, 20)).toBe(false);
    // Da direção 4 (espelhada) girando −1 cai na 3, que não é espelho.
    const back = composeFigure(parts, libs, { direction: 4, parts: { head: { dd: -1 } } });
    expect(on(back, 30)).toBe(true);
  });

  it('deitado a pose por grupo não vale (só o rosto muda)', () => {
    const out = composeFigure(
      parts,
      libs,
      { direction: 2, posture: 'lay', parts: { leftArm: { action: 'crr', dx: 5 } } },
      LAY_CANVAS,
    );
    const lay = (x: number) => out[(50 * LAY_CANVAS.width + LAY_CANVAS.regX + x) * 4 + 3] === 255;
    expect(lay(14)).toBe(true);
    expect(lay(10)).toBe(false);
  });

  it('a chave de cache muda com a pose dos grupos', () => {
    const base = poseKey({ direction: 2 });
    expect(poseKey({ direction: 2, parts: { leftArm: { action: 'crr' } } })).not.toBe(base);
    expect(poseKey({ direction: 2, parts: { head: { dy: 1 } } })).not.toBe(
      poseKey({ direction: 2, parts: { head: { dy: 2 } } }),
    );
  });
});
