import { describe, expect, it } from 'vitest';
import {
  bedDirection,
  layDirection,
  nearestFreeSeat,
  parsePostureCommand,
  seatTiles,
  sitDirection,
} from './posture.js';

describe('sentar e deitar', () => {
  it('comandos do chat', () => {
    expect(
      ['/sentar', '/Deitar', '/levantar', '/pular', 'sentar'].map(parsePostureCommand),
    ).toEqual(['sit', 'lay', 'stand', null, null]);
  });

  it('direções que existem em cada pose', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(sitDirection)).toEqual([0, 0, 2, 2, 4, 4, 6, 6]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(layDirection)).toEqual([2, 2, 2, 4, 4, 4, 4, 2]);
    expect([0, 2].map(bedDirection)).toEqual([4, 2]);
  });

  it('lugares: cada tile do sofá; só a cabeceira da cama', () => {
    expect(seatTiles({ width: 2, depth: 1, canSit: true }, { x: 1, y: 8, rot: 0 })).toEqual([
      { x: 1, y: 8 },
      { x: 2, y: 8 },
    ]);
    const bed = { width: 2, depth: 3, canSit: false, canLay: true };
    expect(seatTiles(bed, { x: 9, y: 6, rot: 0 })).toEqual([
      { x: 9, y: 6 },
      { x: 10, y: 6 },
    ]);
    // Girada (rot 2): comprimento no eixo x, cabeceira em minX.
    expect(seatTiles(bed, { x: 3, y: 2, rot: 2 })).toEqual([
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('lugar livre mais perto', () => {
    const tiles = [
      { x: 1, y: 8 },
      { x: 2, y: 8 },
    ];
    expect(nearestFreeSeat(tiles, { x: 0, y: 8 }, () => false)).toEqual({ x: 1, y: 8 });
    expect(nearestFreeSeat(tiles, { x: 0, y: 8 }, (t) => t.x === 1)).toEqual({ x: 2, y: 8 });
    expect(nearestFreeSeat(tiles, { x: 0, y: 8 }, () => true)).toBeNull();
  });
});
