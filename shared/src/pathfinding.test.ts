import { describe, expect, it } from 'vitest';
import type { FurniDef, PlacedFurni } from './furni.js';
import { parseHeightmap, RoomGrid } from './grid.js';
import type { TilePoint } from './iso.js';
import { findNearestReachable, findPath } from './pathfinding.js';

const block: FurniDef = {
  id: 'bloco',
  name: 'bloco',
  category: 'teste',
  width: 1,
  depth: 1,
  height: 1,
  canSit: false,
  canWalk: false,
  sitHeight: 0,
  directions: [0],
};
const seat: FurniDef = { ...block, id: 'cadeira', canSit: true, sitHeight: 0.5 };
const defs = new Map([
  [block.id, block],
  [seat.id, seat],
]);

/** Monta uma grade a partir de um desenho: `.` = livre, `#` = bloco, `x` = sem piso, `c` = cadeira, dígito = altura. */
function gridFrom(drawing: string[], occupied: TilePoint[] = []): RoomGrid {
  const furni: PlacedFurni[] = [];
  const rows = drawing.map((row, y) =>
    [...row]
      .map((ch, x) => {
        if (ch === '#' || ch === 'c') {
          furni.push({
            id: `${x},${y}`,
            defId: ch === '#' ? 'bloco' : 'cadeira',
            x,
            y,
            z: 0,
            rot: 0,
          });
          return '0';
        }
        return ch === '.' ? '0' : ch;
      })
      .join(''),
  );
  return new RoomGrid(parseHeightmap(rows), furni, defs, { occupied });
}

function isContiguous(start: TilePoint, path: TilePoint[]): boolean {
  let prev = start;
  for (const p of path) {
    if (Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y)) !== 1) return false;
    prev = p;
  }
  return true;
}

describe('findPath', () => {
  it('anda em linha reta', () => {
    const grid = gridFrom(['.....']);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('usa diagonais com o mesmo custo', () => {
    const grid = gridFrom(['....', '....', '....', '....']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 3, y: 3 })!;
    expect(path).toHaveLength(3);
    expect(path.at(-1)).toEqual({ x: 3, y: 3 });
  });

  it('devolve vazio quando já está no destino', () => {
    const grid = gridFrom(['..']);
    expect(findPath(grid, { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });

  it('desvia de obstáculos', () => {
    const grid = gridFrom([
      '.....', //
      '.###.',
      '.....',
    ]);
    const start = { x: 0, y: 1 };
    const path = findPath(grid, start, { x: 4, y: 1 })!;
    expect(path).not.toBeNull();
    expect(path.at(-1)).toEqual({ x: 4, y: 1 });
    expect(isContiguous(start, path)).toBe(true);
    for (const p of path) expect(grid.isWalkable(p.x, p.y, false)).toBe(true);
  });

  it('não corta quinas na diagonal', () => {
    const grid = gridFrom([
      '.#', //
      '..',
    ]);
    // Ir de (0,0) para (1,1) na diagonal passaria rente ao bloco em (1,0).
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('devolve null quando não há caminho', () => {
    const grid = gridFrom([
      '..#..', //
      '..#..',
      '..#..',
    ]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
  });

  it('não entra em tiles sem piso', () => {
    const grid = gridFrom(['..x..']);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
  });

  it('não sobe degraus altos demais', () => {
    const grid = gridFrom(['0033', '0123']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 3, y: 0 })!;
    // Precisa usar a rampa da segunda linha.
    expect(path.some((p) => p.y === 1)).toBe(true);
    expect(findPath(gridFrom(['003']), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });

  it('destino ocupado por outro avatar é recusado, mas dá para passar por ele', () => {
    const grid = gridFrom(['...'], [{ x: 1, y: 0 }]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toHaveLength(2);
  });

  it('cadeira pode ser destino, mas não passagem', () => {
    const grid = gridFrom(['.c.']);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });

  it('respeita o limite de nós expandidos', () => {
    const grid = gridFrom(Array.from({ length: 30 }, () => '.'.repeat(30)));
    expect(findPath(grid, { x: 0, y: 0 }, { x: 29, y: 29 }, { maxNodes: 5 })).toBeNull();
  });
});

describe('findNearestReachable', () => {
  it('acha o tile livre mais próximo de um alvo bloqueado', () => {
    const grid = gridFrom([
      '.....', //
      '..#..',
      '.....',
    ]);
    const res = findNearestReachable(grid, { x: 0, y: 1 }, { x: 2, y: 1 })!;
    expect(Math.max(Math.abs(res.tile.x - 2), Math.abs(res.tile.y - 1))).toBe(1);
    expect(res.tile).toEqual({ x: 1, y: 1 });
  });

  it('devolve null se nada estiver ao alcance', () => {
    const grid = gridFrom(['.x###']);
    expect(findNearestReachable(grid, { x: 0, y: 0 }, { x: 4, y: 0 }, 1)).toBeNull();
  });

  it('partindo de uma cadeira, não escolhe ficar em pé dentro dela', () => {
    // Sentado em (1,0) e clicando na própria cadeira: o mais perto é um vizinho, não o início.
    const chair: PlacedFurni = { id: 'c', defId: 'cadeira', x: 1, y: 0, z: 0, rot: 0 };
    const grid = new RoomGrid(parseHeightmap(['000']), [chair], defs, { seatsAsGoal: false });
    const res = findNearestReachable(grid, { x: 1, y: 0 }, { x: 1, y: 0 })!;
    expect(res.tile).not.toEqual({ x: 1, y: 0 });
    expect(res.path).toEqual([res.tile]);
  });
});
