import { footprint, type FurniDef, type PlacedFurni } from './furni.js';
import { RoomGrid, tileHeight, type Heightmap } from './grid.js';
import { DIRECTION_OFFSETS, type TilePoint } from './iso.js';
import { Z_UNIT } from './constants.js';
import { findPath } from './pathfinding.js';
import type { RoomDoor } from './rooms.js';

/** Limite de móveis por sala (desempenho do sort de profundidade e do estado). */
export const MAX_FURNI_PER_ROOM = 150;
export const VALID_ROTATIONS = [0, 2, 4, 6] as const;

export interface PlacementContext {
  map: Heightmap;
  furni: readonly PlacedFurni[];
  defs: ReadonlyMap<string, FurniDef>;
  doors: readonly RoomDoor[];
  spawn: TilePoint;
  /** Tiles com avatares (parados ou no destino). */
  avatars: readonly TilePoint[];
}

export interface PlacementRequest {
  defId: string;
  x: number;
  y: number;
  rot: number;
  /** Itens de parede: altura acima do piso (em unidades de altura). */
  z?: number;
  /** Ao mover/girar, o próprio móvel não conta como obstáculo. */
  ignoreId?: string;
}

export type PlacementResult = { ok: true; z: number } | { ok: false; reason: string };

const key = (x: number, y: number) => `${x},${y}`;

/** Altura das paredes desenhadas (px) e em unidades de altura: limite dos itens de parede. */
export const WALL_PX = 116;
export const WALL_HEIGHT = WALL_PX / Z_UNIT;
/**
 * Direções dos itens de parede no Habbo: 2 = parede da direita (aresta de cima-direita do tile,
 * onde o vizinho em y-1 não existe); 4 = parede da esquerda (vizinho em x-1).
 */
export const WALL_ROTATIONS = [2, 4] as const;

/** O tile tem parede no lado `rot` (2 ou 4)? A abertura de uma porta não conta como parede. */
export function hasWall(
  ctx: Pick<PlacementContext, 'map' | 'doors'>,
  x: number,
  y: number,
  rot: number,
): boolean {
  const isDoor = (tx: number, ty: number) => ctx.doors.some((d) => d.x === tx && d.y === ty);
  const solid = (tx: number, ty: number) => tileHeight(ctx.map, tx, ty) !== null && !isDoor(tx, ty);
  if (!solid(x, y)) return false;
  const [nx, ny] = rot === 2 ? [x, y - 1] : rot === 4 ? [x - 1, y] : [x, y];
  if (nx === x && ny === y) return false;
  return !solid(nx, ny) && !isDoor(nx, ny);
}

/** Item de parede: precisa de parede no lado escolhido e altura dentro da parede. */
function canPlaceWall(ctx: PlacementContext, req: PlacementRequest): PlacementResult {
  if (
    !(WALL_ROTATIONS as readonly number[]).includes(req.rot) ||
    !hasWall(ctx, req.x, req.y, req.rot)
  ) {
    return { ok: false, reason: 'Isso vai na parede.' };
  }
  const h = req.z ?? 1;
  if (!(h >= 0 && h <= WALL_HEIGHT)) return { ok: false, reason: 'Fora da parede.' };
  const floor = tileHeight(ctx.map, req.x, req.y) ?? 0;
  return { ok: true, z: floor + Math.round(h * 32) / 32 };
}

/** Tiles que precisam ficar livres: portas, o tile logo dentro de cada porta e a entrada. */
export function reservedTiles(ctx: Pick<PlacementContext, 'map' | 'doors' | 'spawn'>): Set<string> {
  const reserved = new Set<string>([key(ctx.spawn.x, ctx.spawn.y)]);
  for (const d of ctx.doors) {
    reserved.add(key(d.x, d.y));
    for (const o of DIRECTION_OFFSETS) {
      if (o.x !== 0 && o.y !== 0) continue;
      const nx = d.x + o.x;
      const ny = d.y + o.y;
      if (tileHeight(ctx.map, nx, ny) !== null) reserved.add(key(nx, ny));
    }
  }
  return reserved;
}

/**
 * Pode colocar (ou mover/girar) este móvel aqui? Regras:
 * - o móvel existe no catálogo e a rotação é 0/2/4/6;
 * - todo o footprint está dentro da sala, num piso plano;
 * - não cobre portas, a entrada nem o tile logo dentro de uma porta;
 * - não se sobrepõe a outro móvel do mesmo tipo (tapete com tapete, sólido com sólido —
 *   móveis sólidos podem ficar em cima de tapetes);
 * - móveis sólidos não ficam em cima de avatares;
 * - depois de colocado, todas as portas continuam alcançáveis a partir da entrada.
 */
export function canPlace(ctx: PlacementContext, req: PlacementRequest): PlacementResult {
  const def = ctx.defs.get(req.defId);
  if (!def) return { ok: false, reason: 'Móvel desconhecido.' };
  if (!(VALID_ROTATIONS as readonly number[]).includes(req.rot)) {
    return { ok: false, reason: 'Rotação inválida.' };
  }
  const others = ctx.furni.filter((f) => f.id !== req.ignoreId);
  if (!req.ignoreId && others.length >= MAX_FURNI_PER_ROOM) {
    return { ok: false, reason: `Limite de ${MAX_FURNI_PER_ROOM} móveis na sala.` };
  }
  if (def.wall) return canPlaceWall(ctx, req);

  const fp = footprint(def, req.x, req.y, req.rot);
  const reserved = reservedTiles(ctx);
  const avatars = new Set(ctx.avatars.map((a) => key(a.x, a.y)));
  const occupied = new Map<string, { solid: boolean }[]>();
  for (const f of others) {
    const d = ctx.defs.get(f.defId);
    if (!d || d.wall) continue;
    const ofp = footprint(d, f.x, f.y, f.rot);
    for (let y = ofp.minY; y <= ofp.maxY; y++) {
      for (let x = ofp.minX; x <= ofp.maxX; x++) {
        const list = occupied.get(key(x, y)) ?? [];
        list.push({ solid: !d.canWalk });
        occupied.set(key(x, y), list);
      }
    }
  }

  let z: number | null = null;
  for (let y = fp.minY; y <= fp.maxY; y++) {
    for (let x = fp.minX; x <= fp.maxX; x++) {
      const h = tileHeight(ctx.map, x, y);
      if (h === null) return { ok: false, reason: 'Fora da sala.' };
      if (z === null) z = h;
      else if (h !== z) return { ok: false, reason: 'O piso precisa ser plano.' };
      if (reserved.has(key(x, y)))
        return { ok: false, reason: 'Deixe a porta e a entrada livres.' };
      const here = occupied.get(key(x, y)) ?? [];
      if (here.some((o) => o.solid === !def.canWalk))
        return { ok: false, reason: 'Já tem um móvel aí.' };
      if (!def.canWalk && avatars.has(key(x, y)))
        return { ok: false, reason: 'Tem alguém nesse lugar.' };
    }
  }

  if (!def.canWalk) {
    const placed: PlacedFurni = {
      id: '__novo__',
      defId: req.defId,
      x: req.x,
      y: req.y,
      z: z ?? 0,
      rot: req.rot,
    };
    const grid = new RoomGrid(ctx.map, [...others, placed], ctx.defs, { seatsAsGoal: false });
    for (const door of ctx.doors) {
      if (!findPath(grid, ctx.spawn, door))
        return { ok: false, reason: 'Isso bloquearia o caminho até uma porta.' };
    }
  }
  return { ok: true, z: z ?? 0 };
}

/** Assento do móvel mais perto de um ponto (sofás têm mais de um lugar). */
export function nearestSeatTile(def: FurniDef, f: PlacedFurni, from: TilePoint): TilePoint {
  const fp = footprint(def, f.x, f.y, f.rot);
  let best: TilePoint = { x: fp.minX, y: fp.minY };
  let bestDist = Infinity;
  for (let y = fp.minY; y <= fp.maxY; y++) {
    for (let x = fp.minX; x <= fp.maxX; x++) {
      const d = Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
      if (d < bestDist) {
        best = { x, y };
        bestDist = d;
      }
    }
  }
  return best;
}
