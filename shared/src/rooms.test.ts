import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { footprint } from './furni.js';
import { parseHeightmap, RoomGrid, tileHeight } from './grid.js';
import { parseFurniManifest } from './manifests.js';
import { findPath } from './pathfinding.js';
import { findRoom, ROOMS } from './rooms.js';

const manifest = parseFurniManifest(
  JSON.parse(
    readFileSync(
      new URL('../../client/public/assets/furni/manifest.json', import.meta.url),
      'utf8',
    ),
  ),
);
const defs = new Map(manifest.items.map((i) => [i.id, i]));

describe.each(ROOMS.map((r) => [r.name, r] as const))('sala %s', (_name, room) => {
  const map = parseHeightmap(room.heightmap);
  const grid = new RoomGrid(map, room.furni, defs, { seatsAsGoal: false });

  it('móveis existem no manifesto, cabem na sala e não se sobrepõem', () => {
    const used = new Set<string>();
    for (const f of room.furni) {
      const def = defs.get(f.defId);
      expect(def, f.defId).toBeDefined();
      const fp = footprint(def!, f.x, f.y, f.rot);
      for (let y = fp.minY; y <= fp.maxY; y++) {
        for (let x = fp.minX; x <= fp.maxX; x++) {
          expect(tileHeight(map, x, y), `${f.id} em ${x},${y}`).not.toBeNull();
          expect(
            room.doors.some((d) => d.x === x && d.y === y),
            `${f.id} na porta`,
          ).toBe(false);
          if (!def!.canWalk) {
            expect(used.has(`${x},${y}`), `${f.id} sobreposto em ${x},${y}`).toBe(false);
            used.add(`${x},${y}`);
          }
        }
      }
    }
  });

  it('a entrada é livre e todas as portas são alcançáveis a partir dela', () => {
    expect(grid.isWalkable(room.spawn.x, room.spawn.y, true)).toBe(true);
    for (const door of room.doors) {
      expect(tileHeight(map, door.x, door.y)).not.toBeNull();
      expect(findPath(grid, room.spawn, door), `porta ${door.x},${door.y}`).not.toBeNull();
    }
  });

  it('cada porta leva a um tile livre de outra sala que tem porta de volta', () => {
    for (const door of room.doors) {
      const target = findRoom(door.targetRoomId);
      expect(target, door.targetRoomId).toBeDefined();
      const tGrid = new RoomGrid(parseHeightmap(target!.heightmap), target!.furni, defs, {
        seatsAsGoal: false,
      });
      expect(tGrid.isWalkable(door.targetX, door.targetY, true)).toBe(true);
      expect(target!.doors.some((d) => d.targetRoomId === room.id)).toBe(true);
    }
  });
});

it('ids de sala são únicos', () => {
  expect(new Set(ROOMS.map((r) => r.id)).size).toBe(ROOMS.length);
});
