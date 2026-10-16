import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FurniDef, PlacedFurni } from './furni.js';
import { parseHeightmap } from './grid.js';
import { parseFurniManifest } from './manifests.js';
import {
  canPlace,
  MAX_FURNI_PER_ROOM,
  nearestSeatTile,
  type PlacementContext,
} from './placement.js';
import type { RoomDoor } from './rooms.js';
import { ROOMS } from './rooms.js';

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
  ['bloco', def({ id: 'bloco' })],
  ['mesa', def({ id: 'mesa', width: 2, depth: 1 })],
  ['tapete', def({ id: 'tapete', width: 2, depth: 2, height: 0, canWalk: true })],
  ['sofa', def({ id: 'sofa', width: 2, depth: 1, canSit: true, sitHeight: 0.5 })],
]);

// Sala 6×5 com porta à esquerda em (0,2).
const door: RoomDoor = { x: 0, y: 2, targetRoomId: 'outra', targetX: 1, targetY: 1, targetDir: 2 };
function ctx(furni: PlacedFurni[] = [], over: Partial<PlacementContext> = {}): PlacementContext {
  return {
    map: parseHeightmap(['x00000', 'x00000', '000000', 'x00000', 'x00011']),
    furni,
    defs,
    doors: [door],
    spawn: { x: 1, y: 2 },
    avatars: [],
    ...over,
  };
}
const f = (id: string, defId: string, x: number, y: number, rot = 0): PlacedFurni => ({
  id,
  defId,
  x,
  y,
  z: 0,
  rot,
});

describe('canPlace', () => {
  it('aceita um lugar livre e devolve a altura do piso', () => {
    expect(canPlace(ctx(), { defId: 'bloco', x: 3, y: 1, rot: 0 })).toEqual({ ok: true, z: 0 });
  });

  it.each([
    [{ defId: 'nao-existe', x: 3, y: 1, rot: 0 }, 'desconhecido'],
    [{ defId: 'bloco', x: 3, y: 1, rot: 1 }, 'Rotação'],
    [{ defId: 'mesa', x: 5, y: 0, rot: 0 }, 'Fora da sala'],
    [{ defId: 'bloco', x: 0, y: 0, rot: 0 }, 'Fora da sala'],
    [{ defId: 'mesa', x: 3, y: 4, rot: 0 }, 'plano'],
    [{ defId: 'bloco', x: 0, y: 2, rot: 0 }, 'porta'],
    [{ defId: 'bloco', x: 1, y: 2, rot: 0 }, 'porta'],
  ])('recusa %o', (req, reason) => {
    const res = canPlace(ctx(), req);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(reason);
  });

  it('respeita o footprint girado', () => {
    // Mesa 2×1 girada ocupa (5,0) e (5,1): cabe; sem girar sairia da sala.
    expect(canPlace(ctx(), { defId: 'mesa', x: 5, y: 0, rot: 2 }).ok).toBe(true);
  });

  it('não sobrepõe sólidos, mas sólido pode ficar em cima de tapete', () => {
    const c = ctx([f('t', 'tapete', 3, 0), f('b', 'bloco', 2, 0)]);
    expect(canPlace(c, { defId: 'bloco', x: 2, y: 0, rot: 0 }).ok).toBe(false);
    expect(canPlace(c, { defId: 'bloco', x: 4, y: 1, rot: 0 }).ok).toBe(true);
    expect(canPlace(c, { defId: 'tapete', x: 4, y: 0, rot: 0 }).ok).toBe(false);
  });

  it('ao mover, o próprio móvel não atrapalha', () => {
    const c = ctx([f('m', 'mesa', 2, 0)]);
    expect(canPlace(c, { defId: 'mesa', x: 3, y: 0, rot: 0 }).ok).toBe(false);
    expect(canPlace(c, { defId: 'mesa', x: 3, y: 0, rot: 0, ignoreId: 'm' }).ok).toBe(true);
  });

  it('sólido não vai em cima de avatar; tapete vai', () => {
    const c = ctx([], { avatars: [{ x: 3, y: 1 }] });
    expect(canPlace(c, { defId: 'bloco', x: 3, y: 1, rot: 0 })).toMatchObject({
      reason: 'Tem alguém nesse lugar.',
    });
    expect(canPlace(c, { defId: 'tapete', x: 3, y: 0, rot: 0 }).ok).toBe(true);
  });

  it('não deixa bloquear o caminho até a porta', () => {
    // Mapa estreito: corredor de 1 tile entre a entrada e a porta do fundo.
    const narrow: PlacementContext = {
      map: parseHeightmap(['xx0x', '0000', 'x0xx', 'x0xx']),
      furni: [],
      defs,
      doors: [
        door,
        { x: 2, y: 0, targetRoomId: 'outra', targetX: 0, targetY: 0, targetDir: 4 },
      ].map((d, i) => (i === 0 ? { ...d, x: 0, y: 1 } : d)),
      spawn: { x: 1, y: 3 },
      avatars: [],
    };
    expect(canPlace(narrow, { defId: 'bloco', x: 1, y: 2, rot: 0 })).toMatchObject({
      ok: false,
      reason: 'Isso bloquearia o caminho até uma porta.',
    });
  });

  it(`limita a ${MAX_FURNI_PER_ROOM} móveis (mover ainda funciona)`, () => {
    const many = Array.from({ length: MAX_FURNI_PER_ROOM }, (_, i) => f(`t${i}`, 'tapete', 99, 99));
    expect(canPlace(ctx(many), { defId: 'bloco', x: 3, y: 1, rot: 0 }).ok).toBe(false);
    expect(canPlace(ctx(many), { defId: 'tapete', x: 3, y: 0, rot: 0, ignoreId: 't0' }).ok).toBe(
      true,
    );
  });
});

describe('nearestSeatTile', () => {
  it('escolhe o lugar do sofá mais perto', () => {
    const sofa = f('s', 'sofa', 2, 3);
    expect(nearestSeatTile(defs.get('sofa')!, sofa, { x: 5, y: 3 })).toEqual({ x: 3, y: 3 });
    expect(nearestSeatTile(defs.get('sofa')!, sofa, { x: 0, y: 3 })).toEqual({ x: 2, y: 3 });
  });
});

describe('salas iniciais', () => {
  const manifest = parseFurniManifest(
    JSON.parse(
      readFileSync(
        new URL('../../client/public/assets/furni/manifest.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const real = new Map(manifest.items.map((i) => [i.id, i]));
  it.each(ROOMS.map((r) => [r.name, r] as const))(
    'cada móvel de %s é uma colocação válida',
    (_n, room) => {
      for (const item of room.furni) {
        const res = canPlace(
          {
            map: parseHeightmap(room.heightmap),
            furni: room.furni,
            defs: real,
            doors: room.doors,
            spawn: room.spawn,
            avatars: [],
          },
          { defId: item.defId, x: item.x, y: item.y, rot: item.rot, ignoreId: item.id },
        );
        expect(res, `${room.id}/${item.id}`).toMatchObject({ ok: true });
      }
    },
  );
});
