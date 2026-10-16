import { describe, expect, it } from 'vitest';
import { compareDepth, depthOrder, type DepthBox } from './depth.js';

const box = (
  id: string,
  minX: number,
  minY: number,
  maxX = minX,
  maxY = minY,
  z = 0,
  layer?: number,
): DepthBox => ({
  id,
  minX,
  minY,
  maxX,
  maxY,
  z,
  layer,
});

const before = (order: string[], a: string, b: string) => order.indexOf(a) < order.indexOf(b);

describe('compareDepth', () => {
  it('objeto com x menor na mesma faixa de y fica atrás', () => {
    expect(compareDepth(box('a', 1, 3), box('b', 2, 3))).toBe(-1);
    expect(compareDepth(box('b', 2, 3), box('a', 1, 3))).toBe(1);
  });

  it('objeto em diagonal de trás fica atrás', () => {
    expect(compareDepth(box('a', 1, 1), box('b', 3, 3))).toBe(-1);
  });

  it('objetos lado a lado na tela não têm restrição', () => {
    expect(compareDepth(box('a', 1, 3), box('b', 3, 1))).toBe(0);
  });

  it('tapete fica embaixo de quem pisa nele', () => {
    expect(compareDepth(box('tapete', 0, 0, 2, 2, 0, -1), box('av', 1, 1))).toBe(-1);
  });

  it('avatar sentado (z maior) fica na frente do assento', () => {
    expect(compareDepth(box('sofa', 2, 2, 3, 2), box('av', 3, 2, 3, 2, 0.5))).toBe(-1);
  });
});

describe('depthOrder', () => {
  it('avatar atrás e na frente de uma mesa 2×1', () => {
    const mesa = box('mesa', 3, 3, 4, 3);
    expect(before(depthOrder([mesa, box('av', 3, 2)]), 'av', 'mesa')).toBe(true);
    expect(before(depthOrder([mesa, box('av', 4, 4)]), 'mesa', 'av')).toBe(true);
    // Tile à direita da mesa no eixo x (mesma linha y): na frente.
    expect(before(depthOrder([mesa, box('av', 5, 3)]), 'mesa', 'av')).toBe(true);
    // Atrás no eixo x, mesma faixa de y.
    expect(before(depthOrder([mesa, box('av', 2, 3)]), 'av', 'mesa')).toBe(true);
  });

  it('caso clássico que quebra a ordenação por x+y: estante comprida', () => {
    // Estante 1×4 ao longo de y; avatar em (2,0) tem x+y = 2, menor que o fundo da estante (1+3 = 4),
    // mas está à frente dela no eixo x.
    const estante = box('estante', 1, 0, 1, 3);
    expect(before(depthOrder([box('av', 2, 0), estante]), 'estante', 'av')).toBe(true);
    // E um avatar em (0,3) está atrás dela.
    expect(before(depthOrder([estante, box('av', 0, 3)]), 'av', 'estante')).toBe(true);
  });

  it('avatar andando entre dois tiles usa a união deles', () => {
    const cadeira = box('cadeira', 3, 3);
    // Indo de (3,2) para (4,2): a caixa (3..4, 2) continua atrás da cadeira em (3,3).
    expect(before(depthOrder([cadeira, box('av', 3, 2, 4, 2)]), 'av', 'cadeira')).toBe(true);
  });

  it('ordena uma cena com vários objetos de forma consistente', () => {
    const boxes = [
      box('tapete', 1, 1, 3, 3, 0, -1),
      box('mesa', 2, 2, 3, 2),
      box('av1', 2, 1),
      box('av2', 2, 3),
      box('planta', 5, 0),
    ];
    const order = depthOrder(boxes);
    expect(order).toHaveLength(5);
    expect(order[0]).toBe('tapete');
    expect(before(order, 'av1', 'mesa')).toBe(true);
    expect(before(order, 'mesa', 'av2')).toBe(true);
  });

  it('é determinístico independente da ordem de entrada', () => {
    const boxes = [box('a', 0, 0), box('b', 1, 0), box('c', 0, 1), box('d', 1, 1)];
    const o1 = depthOrder(boxes);
    const o2 = depthOrder([...boxes].reverse());
    expect(o1[0]).toBe('a');
    expect(o1[3]).toBe('d');
    expect(o2[0]).toBe('a');
    expect(o2[3]).toBe('d');
  });
});
