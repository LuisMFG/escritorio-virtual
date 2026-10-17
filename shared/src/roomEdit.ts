import { z } from 'zod';
import { footprint, type FurniDef, type PlacedFurni } from './furni.js';
import { parseHeightmap, RoomGrid, tileHeight, type Heightmap } from './grid.js';
import type { TilePoint } from './iso.js';
import { findPath } from './pathfinding.js';

/**
 * Editor de salas (Fase 13). Regras de forma:
 * - a grade tem de 4×4 a `ROOM_MAX_SIZE`; a **linha 0 e a coluna 0 são só para portas**;
 * - o resto é piso (`0`) ou vazio (`x`), em qualquer formato (L, U…), desde que conectado;
 * - porta = tile na linha 0 ou coluna 0 com piso logo "dentro" (em +y ou +x).
 * Para onde cada porta leva (tile de chegada do outro lado) é calculado pelo servidor.
 */
export const ROOM_MIN_SIZE = 4;
export const ROOM_MAX_SIZE = 24;
export const ROOM_MAX_DOORS = 6;
export const ROOM_MIN_FLOOR = 6;
export const MAX_ROOMS = 20;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.');

export const roomNameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Nome da sala muito curto.').max(30, 'Nome da sala muito longo.'));

export const roomEditSchema = z.object({
  name: roomNameSchema,
  /** Linhas com `x` (vazio) e `0` (piso); portas também são `0`. */
  heightmap: z
    .array(z.string().regex(/^[x0]+$/, 'Grade inválida.'))
    .min(ROOM_MIN_SIZE)
    .max(ROOM_MAX_SIZE),
  spawn: z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }),
  floorColor: hexColor,
  wallColor: hexColor,
  doors: z
    .array(
      z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        targetRoomId: z.string().min(1).max(40),
      }),
    )
    .max(ROOM_MAX_DOORS, `No máximo ${ROOM_MAX_DOORS} portas por sala.`),
});
export type RoomEdit = z.infer<typeof roomEditSchema>;

export const roomCreateSchema = z.object({ name: roomNameSchema });

/** Sala na lista (lobby e editor). */
export interface RoomSummary {
  id: string;
  name: string;
}

/** O que o editor carrega para uma sala. */
export interface RoomEditorData extends RoomEdit {
  id: string;
  /** Pessoas na sala agora (para avisar antes de excluir). */
  online: number;
}

/** Tile logo dentro de uma porta e a direção de quem entra por ela. `null` = não é porta válida. */
export function doorInside(
  map: Heightmap,
  x: number,
  y: number,
): (TilePoint & { dir: number }) | null {
  if (tileHeight(map, x, y) === null) return null;
  if (x === 0 && y > 0 && tileHeight(map, 1, y) !== null) return { x: 1, y, dir: 2 };
  if (y === 0 && x > 0 && tileHeight(map, x, 1) !== null) return { x, y: 1, dir: 4 };
  return null;
}

const key = (x: number, y: number) => `${x},${y}`;

export type RoomEditResult =
  { ok: true; map: Heightmap; removedFurni: string[] } | { ok: false; error: string };

/**
 * Confere uma edição de sala. Móveis que não cabem mais (fora do piso ou numa porta) são
 * listados em `removedFurni`; se algum móvel que fica bloquear o caminho até uma porta, recusa.
 */
export function validateRoomEdit(
  edit: RoomEdit,
  ctx: {
    selfId: string;
    roomIds: ReadonlySet<string>;
    furni: readonly PlacedFurni[];
    defs: ReadonlyMap<string, FurniDef>;
  },
): RoomEditResult {
  const map = parseHeightmap(edit.heightmap);
  if (map.width < ROOM_MIN_SIZE || map.width > ROOM_MAX_SIZE) {
    return { ok: false, error: `A largura vai de ${ROOM_MIN_SIZE} a ${ROOM_MAX_SIZE}.` };
  }
  if (edit.heightmap.some((r) => r.length !== map.width)) {
    return { ok: false, error: 'Todas as linhas da grade precisam ter o mesmo tamanho.' };
  }

  const doorKeys = new Set(edit.doors.map((d) => key(d.x, d.y)));
  if (doorKeys.size !== edit.doors.length)
    return { ok: false, error: 'Duas portas no mesmo lugar.' };
  for (const d of edit.doors) {
    if (!doorInside(map, d.x, d.y)) {
      return {
        ok: false,
        error: 'Porta precisa ficar na primeira linha ou coluna, encostada no piso.',
      };
    }
    if (d.targetRoomId === ctx.selfId || !ctx.roomIds.has(d.targetRoomId)) {
      return { ok: false, error: 'Uma porta leva para uma sala que não existe.' };
    }
  }
  // Linha 0 e coluna 0: só portas.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if ((x === 0 || y === 0) && tileHeight(map, x, y) !== null && !doorKeys.has(key(x, y))) {
        return { ok: false, error: 'A primeira linha e a primeira coluna são só para portas.' };
      }
    }
  }

  const floor: TilePoint[] = [];
  for (let y = 1; y < map.height; y++) {
    for (let x = 1; x < map.width; x++) if (tileHeight(map, x, y) !== null) floor.push({ x, y });
  }
  if (floor.length < ROOM_MIN_FLOOR) {
    return { ok: false, error: `A sala precisa de pelo menos ${ROOM_MIN_FLOOR} tiles de piso.` };
  }
  const { spawn } = edit;
  if (tileHeight(map, spawn.x, spawn.y) === null || doorKeys.has(key(spawn.x, spawn.y))) {
    return { ok: false, error: 'A entrada precisa ficar no piso.' };
  }

  // Piso todo conectado (andando em 4 direções, sem contar móveis).
  const seen = new Set([key(spawn.x, spawn.y)]);
  const queue: TilePoint[] = [spawn];
  while (queue.length > 0) {
    const t = queue.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: t.x + dx, y: t.y + dy };
      if (n.x < 1 || n.y < 1 || seen.has(key(n.x, n.y)) || tileHeight(map, n.x, n.y) === null) {
        continue;
      }
      seen.add(key(n.x, n.y));
      queue.push(n);
    }
  }
  if (seen.size !== floor.length) {
    return { ok: false, error: 'Todo o piso precisa estar ligado (sem ilhas soltas).' };
  }

  // Móveis que não cabem mais saem; os que ficam não podem bloquear entrada e portas.
  const removedFurni: string[] = [];
  const kept: PlacedFurni[] = [];
  for (const f of ctx.furni) {
    const def = ctx.defs.get(f.defId);
    if (!def) continue;
    const fp = footprint(def, f.x, f.y, f.rot);
    let fits = true;
    for (let y = fp.minY; y <= fp.maxY && fits; y++) {
      for (let x = fp.minX; x <= fp.maxX && fits; x++) {
        if (x < 1 || y < 1 || tileHeight(map, x, y) === null || doorKeys.has(key(x, y))) {
          fits = false;
        }
      }
    }
    if (fits) kept.push(f);
    else removedFurni.push(f.id);
  }
  const grid = new RoomGrid(map, kept, ctx.defs, { seatsAsGoal: false });
  if (!grid.isWalkable(spawn.x, spawn.y, true)) {
    return { ok: false, error: 'Tem um móvel em cima da entrada.' };
  }
  for (const d of edit.doors) {
    if (!findPath(grid, spawn, d)) {
      return { ok: false, error: 'Um móvel bloqueia o caminho até uma porta.' };
    }
  }
  return { ok: true, map, removedFurni };
}

/**
 * Lugar para uma porta nova (a "porta de volta"): na linha/coluna 0, encostada no piso,
 * alcançável a partir da entrada, o mais perto dela possível. `null` se não couber.
 */
export function findDoorSpot(
  heightmap: readonly string[],
  spawn: TilePoint,
  takenDoors: readonly TilePoint[],
  furni: readonly PlacedFurni[],
  defs: ReadonlyMap<string, FurniDef>,
): TilePoint | null {
  const taken = new Set(takenDoors.map((d) => key(d.x, d.y)));
  const candidates: TilePoint[] = [];
  const rows = heightmap.map((r) => [...r]);
  for (let y = 1; y < rows.length; y++) {
    if (rows[y]![1] === '0' && !taken.has(key(0, y))) candidates.push({ x: 0, y });
  }
  for (let x = 1; x < (rows[0]?.length ?? 0); x++) {
    if (rows[1]?.[x] === '0' && !taken.has(key(x, 0))) candidates.push({ x, y: 0 });
  }
  candidates.sort(
    (a, b) =>
      Math.abs(a.x - spawn.x) +
      Math.abs(a.y - spawn.y) -
      Math.abs(b.x - spawn.x) -
      Math.abs(b.y - spawn.y),
  );
  for (const c of candidates) {
    const withDoor = rows.map((r, y) =>
      r.map((ch, x) => (x === c.x && y === c.y ? '0' : ch)).join(''),
    );
    const map = parseHeightmap(withDoor);
    const grid = new RoomGrid(map, furni, defs, { seatsAsGoal: false });
    if (findPath(grid, spawn, c)) return c;
  }
  return null;
}

/** Heightmap padrão de uma sala nova: piso `w×h` com a porta na coluna 0, ao lado da entrada. */
export function defaultRoomHeightmap(
  w = 8,
  h = 6,
): { heightmap: string[]; door: TilePoint; spawn: TilePoint } {
  const doorY = 1 + Math.floor(h / 2);
  const heightmap = ['x'.repeat(w + 1)];
  for (let y = 1; y <= h; y++) heightmap.push((y === doorY ? '0' : 'x') + '0'.repeat(w));
  return { heightmap, door: { x: 0, y: doorY }, spawn: { x: 1, y: doorY } };
}
