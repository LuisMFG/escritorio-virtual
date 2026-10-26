import { describe, expect, it } from 'vitest';
import { footprint, type FurniDef } from './furni.js';
import { GridBase, parseHeightmap, RoomGrid, tileHeight } from './grid.js';

const def = (over: Partial<FurniDef> & { id: string }): FurniDef => ({
  name: over.id,
  category: 'teste',
  width: 1,
  depth: 1,
  height: 1,
  canSit: false,
  canWalk: false,
  sitHeight: 0,
  directions: [0, 2, 4, 6],
  ...over,
});

const defs = new Map<string, FurniDef>([
  ['mesa', def({ id: 'mesa', width: 2, depth: 1 })],
  ['cadeira', def({ id: 'cadeira', canSit: true, sitHeight: 0.5 })],
  ['tapete', def({ id: 'tapete', width: 2, depth: 2, height: 0, canWalk: true })],
]);

describe('parseHeightmap', () => {
  it('lê tiles, vazios e alturas', () => {
    const map = parseHeightmap(['x00', '01a', '  ']);
    expect(map.width).toBe(3);
    expect(map.height).toBe(2);
    expect(tileHeight(map, 0, 0)).toBeNull();
    expect(tileHeight(map, 1, 1)).toBe(1);
    expect(tileHeight(map, 2, 1)).toBe(10);
    expect(tileHeight(map, 9, 9)).toBeNull();
  });

  it('completa linhas curtas com vazio', () => {
    const map = parseHeightmap(['000', '0']);
    expect(tileHeight(map, 2, 1)).toBeNull();
  });

  it('recusa caracteres inválidos', () => {
    expect(() => parseHeightmap(['0#0'])).toThrow(/inválido/);
  });
});

describe('footprint', () => {
  it('troca os eixos nas rotações 2 e 6', () => {
    const d = { width: 2, depth: 1 };
    expect(footprint(d, 3, 3, 0)).toEqual({ minX: 3, minY: 3, maxX: 4, maxY: 3 });
    expect(footprint(d, 3, 3, 4)).toEqual({ minX: 3, minY: 3, maxX: 4, maxY: 3 });
    expect(footprint(d, 3, 3, 2)).toEqual({ minX: 3, minY: 3, maxX: 3, maxY: 4 });
  });
});

describe('RoomGrid', () => {
  const map = parseHeightmap(['0000', '0000', 'x000']);

  it('base reaproveitada: cada pedido traz só quem está onde, e os ocupados só se precisar', () => {
    const base = new GridBase(map, [{ id: 'm', defId: 'mesa', x: 1, y: 0, z: 0, rot: 0 }], defs);
    let asked = 0;
    const occupied = () => {
      asked++;
      return [{ x: 3, y: 1 }];
    };
    const grid = new RoomGrid(base, { occupied });
    // Andar um passo (sem ser destino) não precisa saber quem está onde.
    expect(grid.isWalkable(3, 1, false)).toBe(true);
    expect(grid.heightAt(3, 1)).toBe(0);
    expect(asked).toBe(0);
    expect(grid.isWalkable(3, 1, true)).toBe(false);
    expect(grid.isWalkable(2, 1, true)).toBe(true);
    expect(asked).toBe(1);
    // Outro pedido sobre a mesma base: os móveis continuam lá, os ocupados são outros.
    const other = new RoomGrid(base, { occupied: [] });
    expect(other.isWalkable(1, 0, false)).toBe(false);
    expect(other.isWalkable(3, 1, true)).toBe(true);
  });

  it('móveis bloqueiam o footprint inteiro', () => {
    const grid = new RoomGrid(map, [{ id: 'm', defId: 'mesa', x: 1, y: 0, z: 0, rot: 0 }], defs);
    expect(grid.isWalkable(1, 0, false)).toBe(false);
    expect(grid.isWalkable(2, 0, false)).toBe(false);
    expect(grid.isWalkable(3, 0, false)).toBe(true);
  });

  it('tiles sem piso ou fora da sala não são andáveis', () => {
    const grid = new RoomGrid(map, [], defs);
    expect(grid.isWalkable(0, 2, false)).toBe(false);
    expect(grid.isWalkable(-1, 0, false)).toBe(false);
    expect(grid.isWalkable(4, 0, false)).toBe(false);
  });

  it('cadeira só é andável como destino', () => {
    const grid = new RoomGrid(map, [{ id: 'c', defId: 'cadeira', x: 2, y: 1, z: 0, rot: 2 }], defs);
    expect(grid.isWalkable(2, 1, false)).toBe(false);
    expect(grid.isWalkable(2, 1, true)).toBe(true);
    expect(grid.tile(2, 1)?.seat?.id).toBe('c');
    const noSeats = new RoomGrid(
      map,
      [{ id: 'c', defId: 'cadeira', x: 2, y: 1, z: 0, rot: 2 }],
      defs,
      {
        seatsAsGoal: false,
      },
    );
    expect(noSeats.isWalkable(2, 1, true)).toBe(false);
  });

  it('tapete não bloqueia', () => {
    const grid = new RoomGrid(map, [{ id: 't', defId: 'tapete', x: 0, y: 0, z: 0, rot: 0 }], defs);
    expect(grid.isWalkable(1, 1, false)).toBe(true);
  });

  it('tiles ocupados por avatares não podem ser destino, mas podem ser atravessados', () => {
    const grid = new RoomGrid(map, [], defs, { occupied: [{ x: 1, y: 1 }] });
    expect(grid.isWalkable(1, 1, true)).toBe(false);
    expect(grid.isWalkable(1, 1, false)).toBe(true);
  });

  it('o móvel em que o avatar está (passable) é passagem, mas não destino', () => {
    const mesa = [{ id: 'm', defId: 'mesa', x: 0, y: 0, z: 0, rot: 0 }];
    const grid = new RoomGrid(map, mesa, defs, { passable: [{ x: 1, y: 0 }] });
    expect(grid.isWalkable(1, 0, false)).toBe(true);
    expect(grid.isWalkable(1, 0, true)).toBe(false);
    // Só os tiles passados: o resto da mesa continua bloqueado.
    expect(grid.isWalkable(0, 0, false)).toBe(false);
  });

  it('móveis de definição desconhecida são ignorados', () => {
    const grid = new RoomGrid(
      map,
      [{ id: 'z', defId: 'nao-existe', x: 0, y: 0, z: 0, rot: 0 }],
      defs,
    );
    expect(grid.isWalkable(0, 0, false)).toBe(true);
  });
});
