import { describe, expect, it } from 'vitest';
import { layoutMap, type MapRoom } from './map.js';

describe('layoutMap', () => {
  it('porta da esquerda põe a vizinha à esquerda; porta do fundo põe acima', () => {
    const rooms: MapRoom[] = [
      {
        id: 'reception',
        name: 'Recepção',
        links: [
          { to: 'meeting', side: 'left' },
          { to: 'pantry', side: 'top' },
        ],
      },
      { id: 'meeting', name: 'Reunião', links: [{ to: 'reception', side: 'left' }] },
      { id: 'pantry', name: 'Copa', links: [{ to: 'reception', side: 'left' }] },
      { id: 'ti', name: 'Sala do TI', links: [] },
    ];
    const pos = layoutMap(rooms);
    // Recepção (1,1); Reunião à esquerda (0,1); Copa acima (1,0); Sala do TI solta embaixo.
    expect(Object.fromEntries(pos)).toEqual({
      reception: { col: 1, row: 1 },
      meeting: { col: 0, row: 1 },
      pantry: { col: 1, row: 0 },
      ti: { col: 0, row: 2 },
    });
  });

  it('duas portas para o mesmo lado: a segunda vai para o lugar livre mais perto', () => {
    const pos = layoutMap([
      {
        id: 'a',
        name: 'A',
        links: [
          { to: 'b', side: 'left' },
          { to: 'c', side: 'left' },
        ],
      },
      { id: 'b', name: 'B', links: [] },
      { id: 'c', name: 'C', links: [] },
    ]);
    const cells = [...pos.values()].map((c) => `${c.col},${c.row}`);
    expect(new Set(cells).size).toBe(3);
  });
});
