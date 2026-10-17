import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHeightmap } from './grid.js';
import { parseFurniManifest } from './manifests.js';
import {
  defaultRoomHeightmap,
  doorInside,
  findDoorSpot,
  validateRoomEdit,
  type RoomEdit,
} from './roomEdit.js';
import { ROOMS } from './rooms.js';

const defs = new Map(
  parseFurniManifest(
    JSON.parse(
      readFileSync(
        new URL('../../client/public/assets/furni/manifest.json', import.meta.url),
        'utf8',
      ),
    ),
  ).items.map((i) => [i.id, i]),
);
const roomIds = new Set(['reception', 'meeting', 'pantry']);

const base: RoomEdit = {
  name: 'Sala do TI',
  heightmap: ['xxxxx', 'x0000', '00000', 'x0000'],
  spawn: { x: 1, y: 2 },
  floorColor: '#aabbcc',
  wallColor: '#ccbbaa',
  doors: [{ x: 0, y: 2, targetRoomId: 'reception' }],
};
const check = (edit: Partial<RoomEdit>, furni = []) =>
  validateRoomEdit({ ...base, ...edit }, { selfId: 'ti', roomIds, furni, defs });

describe('validateRoomEdit', () => {
  it('as salas iniciais seguem as regras do editor', () => {
    for (const r of ROOMS) {
      const res = validateRoomEdit(
        { ...r, spawn: r.spawn, doors: r.doors },
        { selfId: r.id, roomIds, furni: r.furni, defs },
      );
      expect(res, r.id).toMatchObject({ ok: true, removedFurni: [] });
    }
  });

  it('aceita sala em L e recusa ilhas soltas', () => {
    expect(check({ heightmap: ['xxxxx', 'x00xx', '0000x', 'x0000'] }).ok).toBe(true);
    expect(check({ heightmap: ['xxxxx', 'x0x00', '00x00', 'x0x00'] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('ilhas'),
    });
  });

  it('linha/coluna 0 só para portas; porta precisa encostar no piso', () => {
    expect(check({ heightmap: ['x0xxx', 'x0000', '00000', 'x0000'] })).toMatchObject({
      ok: false,
    });
    expect(check({ doors: [{ x: 0, y: 2, targetRoomId: 'nao-existe' }] }).ok).toBe(false);
    expect(check({ doors: [{ x: 0, y: 2, targetRoomId: 'ti' }] }).ok).toBe(false);
    expect(check({ doors: [{ x: 2, y: 2, targetRoomId: 'reception' }] }).ok).toBe(false);
  });

  it('entrada no piso e tamanho mínimo', () => {
    expect(check({ spawn: { x: 0, y: 2 } }).ok).toBe(false);
    expect(check({ heightmap: ['xxxxx', 'x00xx', '000xx', 'xxxxx'] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('pelo menos'),
    });
  });

  it('móveis fora do piso novo saem; móvel bloqueando a porta recusa', () => {
    const plant = { id: 'p1', defId: 'plant_yukka', x: 4, y: 3, z: 0, rot: 0 };
    const res = check({ heightmap: ['xxxxx', 'x000x', '0000x', 'x000x'] }, [plant] as never);
    expect(res).toMatchObject({ ok: true, removedFurni: ['p1'] });

    // Planta ocupando o único caminho (corredor de 1 tile) até a porta.
    const blocker = { id: 'p2', defId: 'plant_yukka', x: 2, y: 2, z: 0, rot: 0 };
    const corridor = {
      heightmap: ['xxxxx', 'xxx00', '00000', 'xxx00'],
      spawn: { x: 4, y: 2 },
    };
    expect(check(corridor, [blocker] as never)).toMatchObject({
      ok: false,
      error: expect.stringContaining('bloqueia'),
    });
  });
});

describe('portas', () => {
  it('doorInside: tile de dentro e direção de quem entra', () => {
    const map = parseHeightmap(['xx0xx', 'x0000', '00000']);
    expect(doorInside(map, 0, 2)).toEqual({ x: 1, y: 2, dir: 2 });
    expect(doorInside(map, 2, 0)).toEqual({ x: 2, y: 1, dir: 4 });
    expect(doorInside(map, 2, 2)).toBeNull();
  });

  it('findDoorSpot acha o lugar livre mais perto da entrada', () => {
    const spot = findDoorSpot(['xxxxx', 'x0000', 'x0000', 'x0000'], { x: 3, y: 1 }, [], [], defs);
    expect(spot).toEqual({ x: 3, y: 0 });
    expect(
      findDoorSpot(['xxxx', 'x00x', 'x00x'], { x: 1, y: 1 }, [{ x: 1, y: 0 }], [], defs),
    ).toEqual({ x: 0, y: 1 });
  });

  it('sala nova padrão passa na validação', () => {
    const d = defaultRoomHeightmap();
    const res = validateRoomEdit(
      {
        ...base,
        heightmap: d.heightmap,
        spawn: d.spawn,
        doors: [{ ...d.door, targetRoomId: 'reception' }],
      },
      { selfId: 'nova', roomIds, furni: [], defs },
    );
    expect(res.ok).toBe(true);
  });
});
