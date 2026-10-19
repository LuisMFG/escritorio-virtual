import { describe, expect, it } from 'vitest';
import {
  animationFor,
  animFrame,
  furniSprites,
  isAnimated,
  layerLetter,
  type FurniVisual,
} from './furniVisual.js';

const v: FurniVisual = {
  classname: 'fan',
  layerCount: 3,
  layers: { '1': { alpha: 128 }, '2': { ink: 33, ignoreMouse: 1, z: 5 } },
  directions: { '0': { '1': { z: -100, x: 8 } } },
  animations: {
    '0': {},
    '1': { '2': { frames: [{ id: 1 }, { id: 2 }, { id: 3 }], frameRepeat: 2 } },
  },
  colors: { '2': { '0': 0xff0000 } },
  assets: {
    fan_64_sd_2_0: { x: 10, y: 5 },
    fan_64_a_2_0: { x: 20, y: 40 },
    fan_64_a_0_0: { x: 20, y: 40, source: 'fan_64_a_2_0', flip: 1 },
    fan_64_b_2_0: { x: 15, y: 30 },
    fan_64_c_2_0: { x: 5, y: 50 },
    fan_64_c_2_1: { x: 6, y: 51 },
    fan_64_c_2_3: { x: 7, y: 52 },
  },
  frames: {
    fan_64_sd_2_0: { x: 0, y: 0, w: 30, h: 10 },
    fan_64_a_2_0: { x: 0, y: 0, w: 32, h: 50 },
    fan_64_b_2_0: { x: 0, y: 0, w: 20, h: 20 },
    fan_64_c_2_0: { x: 0, y: 0, w: 10, h: 10 },
    fan_64_c_2_1: { x: 0, y: 0, w: 10, h: 10 },
    fan_64_c_2_3: { x: 0, y: 0, w: 10, h: 10 },
  },
};

describe('móveis por camadas (Fase 37)', () => {
  it('letras das camadas', () => {
    expect([0, 1, 25].map(layerLetter)).toEqual(['a', 'b', 'z']);
  });

  it('quadros: repetição, voltas contadas e sorteio estável', () => {
    const l = { frames: [{ id: 1 }, { id: 2 }, { id: 3 }], frameRepeat: 2 };
    expect([0, 1, 2, 3, 4, 5, 6].map((t) => animFrame(l, t).id)).toEqual([1, 1, 2, 2, 3, 3, 1]);
    const once = { frames: [{ id: 1 }, { id: 2 }], loopCount: 1 };
    expect([0, 1, 2, 9].map((t) => animFrame(once, t).id)).toEqual([1, 2, 2, 2]);
    const rnd = { frames: [{ id: 1 }, { id: 2 }, { id: 3 }], random: 1 as const };
    expect(animFrame(rnd, 7).id).toBe(animFrame(rnd, 7).id);
    expect(animFrame({ frames: [] }, 3).id).toBe(0);
  });

  it('animação do estado (ou a 0) e se precisa redesenhar', () => {
    expect(animationFor(v, 1)).toBe(1);
    expect(animationFor(v, 4)).toBe(0);
    expect(isAnimated(v, 1)).toBe(true);
    expect(isAnimated(v, 0)).toBe(false);
  });

  it('sprites: sombra primeiro, deslocamento do Habbo, ink, alpha, cor e quadro que falta', () => {
    const s = furniSprites(v, 2, 1, 4, 2);
    expect(s.map((x) => x.image)).toEqual([
      'fan_64_sd_2_0',
      'fan_64_a_2_0',
      'fan_64_b_2_0',
      'fan_64_c_2_3',
    ]);
    expect(s[0]).toMatchObject({ x: -10, y: -5, ignoreMouse: true, layer: -1 });
    expect(s[1]).toMatchObject({ x: -20, y: -40, tint: 0xff0000, alpha: 255 });
    expect(s[2]).toMatchObject({ alpha: 128, tint: null });
    expect(s[3]).toMatchObject({ x: -7, y: -52, ink: 33, ignoreMouse: true });
    // Quadro 2 não existe: usa o 0 da camada.
    expect(furniSprites(v, 2, 1, 2).at(-1)!.image).toBe('fan_64_c_2_0');
  });

  it('espelhado conta o deslocamento do outro lado; z da direção põe a camada atrás', () => {
    const s = furniSprites(v, 0, 0, 0);
    expect(s[0]).toMatchObject({ image: 'fan_64_a_2_0', flip: true, x: 20 - 32 });
  });
});
