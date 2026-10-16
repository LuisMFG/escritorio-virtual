import { describe, expect, it } from 'vitest';
import {
  directionBetween,
  pointInTile,
  screenToTile,
  screenToTileFloat,
  tileCorners,
  tileToScreen,
} from './iso.js';

describe('tileToScreen', () => {
  it('coloca a origem em (0,0)', () => {
    expect(tileToScreen(0, 0)).toEqual({ sx: 0, sy: 0 });
  });

  it('x cresce para baixo-direita e y para baixo-esquerda', () => {
    expect(tileToScreen(1, 0)).toEqual({ sx: 32, sy: 16 });
    expect(tileToScreen(0, 1)).toEqual({ sx: -32, sy: 16 });
  });

  it('altura sobe o ponto na tela', () => {
    expect(tileToScreen(2, 2, 1)).toEqual({ sx: 0, sy: 64 - 32 });
  });
});

describe('screenToTile', () => {
  it('faz ida e volta em uma grade 20x20', () => {
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        const { sx, sy } = tileToScreen(x, y);
        expect(screenToTile(sx, sy)).toEqual({ x, y });
        expect(screenToTileFloat(sx, sy)).toEqual({ x, y });
      }
    }
  });

  it('pontos perto dos vértices continuam no tile certo', () => {
    const [top, right, bottom, left] = tileCorners(5, 3);
    expect(screenToTile(top.sx, top.sy + 2)).toEqual({ x: 5, y: 3 });
    expect(screenToTile(right.sx - 3, right.sy)).toEqual({ x: 5, y: 3 });
    expect(screenToTile(bottom.sx, bottom.sy - 2)).toEqual({ x: 5, y: 3 });
    expect(screenToTile(left.sx + 3, left.sy)).toEqual({ x: 5, y: 3 });
  });

  it('pontos logo fora do vértice caem no vizinho', () => {
    const [, right, bottom] = tileCorners(5, 3);
    expect(screenToTile(right.sx + 3, right.sy)).toEqual({ x: 6, y: 2 });
    expect(screenToTile(bottom.sx, bottom.sy + 2)).toEqual({ x: 6, y: 4 });
  });

  it('funciona com coordenadas negativas', () => {
    const { sx, sy } = tileToScreen(-2, 3);
    expect(screenToTile(sx, sy)).toEqual({ x: -2, y: 3 });
  });
});

describe('pointInTile', () => {
  it('considera altura do tile', () => {
    const c = tileToScreen(4, 4, 2);
    expect(pointInTile(c.sx, c.sy, 4, 4, 2)).toBe(true);
    expect(pointInTile(c.sx, c.sy, 4, 4, 0)).toBe(false);
  });
});

describe('directionBetween', () => {
  it('mapeia as 8 direções do Habbo', () => {
    const o = { x: 5, y: 5 };
    expect(directionBetween(o, { x: 5, y: 4 })).toBe(0);
    expect(directionBetween(o, { x: 6, y: 4 })).toBe(1);
    expect(directionBetween(o, { x: 6, y: 5 })).toBe(2);
    expect(directionBetween(o, { x: 6, y: 6 })).toBe(3);
    expect(directionBetween(o, { x: 5, y: 6 })).toBe(4);
    expect(directionBetween(o, { x: 4, y: 6 })).toBe(5);
    expect(directionBetween(o, { x: 4, y: 5 })).toBe(6);
    expect(directionBetween(o, { x: 4, y: 4 })).toBe(7);
  });

  it('usa o fallback para o mesmo tile e normaliza distâncias maiores', () => {
    expect(directionBetween({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toBe(5);
    expect(directionBetween({ x: 0, y: 0 }, { x: 9, y: 0 })).toBe(2);
  });
});
