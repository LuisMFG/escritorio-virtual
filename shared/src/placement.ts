import { footprint, type Footprint, type FurniDef, type PlacedFurni } from './furni.js';
import { RoomGrid, tileHeight, type Heightmap } from './grid.js';
import { DIRECTION_OFFSETS, tileToScreen, type TilePoint } from './iso.js';
import { TILE_H, TILE_W, Z_UNIT } from './constants.js';
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

/** Altura máxima de uma pilha (base + móvel em cima), em unidades de altura. */
export const MAX_STACK_HEIGHT = 6;

/** Móveis com algo desenhado ou jogado por cima (quadros, tabuleiro): nada vai em cima deles. */
const NO_TOP_INTERACTIONS = new Set(['whiteboard', 'board', 'kudos', 'jira', 'tictactoe']);

/**
 * Dá para colocar objetos em cima deste móvel? Só nos que têm tampo (`hasTop`): mesas,
 * escrivaninhas, balcões, armários, estantes, divisórias — impressora em cima do computador,
 * não. Nunca em assentos, camas, tapetes, itens de parede ou nos quadros/tabuleiros.
 */
export function acceptsOnTop(def: FurniDef): boolean {
  return (
    Boolean(def.hasTop) &&
    !def.wall &&
    !def.canWalk &&
    !def.canSit &&
    !def.canLay &&
    topHeight(def) >= 0.3 &&
    !NO_TOP_INTERACTIONS.has(def.interaction ?? '')
  );
}

/** Altura do tampo (onde o que vai em cima se apoia). */
export function topHeight(def: FurniDef): number {
  return def.stackHeight ?? def.height;
}

/** Móveis apoiados em cima de `base` (para não mover nem tirar a base com coisas em cima). */
export function stackedOn(
  base: PlacedFurni,
  furni: readonly PlacedFurni[],
  defs: ReadonlyMap<string, FurniDef>,
): PlacedFurni[] {
  const bd = defs.get(base.defId);
  if (!bd || !acceptsOnTop(bd)) return [];
  const bfp = footprint(bd, base.x, base.y, base.rot);
  const top = base.z + topHeight(bd);
  return furni.filter((f) => {
    if (f.id === base.id) return false;
    const d = defs.get(f.defId);
    if (!d || d.wall || d.canWalk || f.z < top - 0.01) return false;
    const fp = footprint(d, f.x, f.y, f.rot);
    return fp.minX <= bfp.maxX && fp.maxX >= bfp.minX && fp.minY <= bfp.maxY && fp.maxY >= bfp.minY;
  });
}

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
 * - não se sobrepõe a outro tapete; sólido em cima de sólido só se o de baixo tem tampo
 *   (`acceptsOnTop`) e o apoio é plano — aí fica na altura do tampo (empilhar, como no Habbo);
 *   assentos e camas só no chão; uma base com coisas em cima não se move;
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
  const moving = req.ignoreId ? ctx.furni.find((f) => f.id === req.ignoreId) : undefined;
  // O que está em cima de quem se move (só pode girar no lugar): fica acima, não embaixo.
  const above = new Set<string>();
  if (moving) {
    const md = ctx.defs.get(moving.defId);
    const mfp = md ? footprint(md, moving.x, moving.y, moving.rot) : null;
    // Alguém sentado ou deitado nele (o servidor também recusava; o fantasma ficava verde).
    if (md && mfp && !md.canWalk && ctx.avatars.some((a) => inFootprint(a, mfp))) {
      return { ok: false, reason: 'Tem alguém sentado aí.' };
    }
    // Uma base com coisas em cima não sai do lugar (elas ficariam flutuando), mas gira se os
    // tiles continuam os mesmos (base quadrada, ou meia-volta).
    const top = stackedOn(moving, ctx.furni, ctx.defs);
    if (top.length && !(mfp && sameFootprint(mfp, fp))) {
      return { ok: false, reason: 'Tire o que está em cima primeiro.' };
    }
    for (const t of top) above.add(t.id);
  }

  const reserved = reservedTiles(ctx);
  const avatars = new Set(ctx.avatars.map((a) => key(a.x, a.y)));
  /** O que já ocupa cada tile: tapete, ou sólido (com o tampo, se aceita coisas em cima). */
  const occupied = new Map<string, { solid: boolean; top: number | null }[]>();
  for (const f of others) {
    const d = ctx.defs.get(f.defId);
    if (!d || d.wall || above.has(f.id)) continue;
    const ofp = footprint(d, f.x, f.y, f.rot);
    const top = acceptsOnTop(d) ? f.z + topHeight(d) : null;
    for (let y = ofp.minY; y <= ofp.maxY; y++) {
      for (let x = ofp.minX; x <= ofp.maxX; x++) {
        const list = occupied.get(key(x, y)) ?? [];
        list.push({ solid: !d.canWalk, top });
        occupied.set(key(x, y), list);
      }
    }
  }
  /** Assentos e camas só no chão (o avatar senta na altura do piso). */
  const stackable = !def.canSit && !def.canLay;

  let z: number | null = null;
  let floorZ: number | null = null;
  for (let y = fp.minY; y <= fp.maxY; y++) {
    for (let x = fp.minX; x <= fp.maxX; x++) {
      const h = tileHeight(ctx.map, x, y);
      if (h === null) return { ok: false, reason: 'Fora da sala.' };
      if (floorZ === null) floorZ = h;
      else if (h !== floorZ) return { ok: false, reason: 'O piso precisa ser plano.' };
      if (reserved.has(key(x, y)))
        return { ok: false, reason: 'Deixe a porta e a entrada livres.' };
      const here = occupied.get(key(x, y)) ?? [];
      let base = h;
      if (def.canWalk) {
        // Tapete: no chão, sem outro tapete embaixo.
        if (here.some((o) => !o.solid)) return { ok: false, reason: 'Já tem um móvel aí.' };
      } else {
        const solids = here.filter((o) => o.solid);
        if (solids.length) {
          // Em cima de outro móvel: só se ele tem tampo (e o que vai em cima não é assento).
          if (!stackable || solids.some((o) => o.top === null))
            return { ok: false, reason: 'Já tem um móvel aí.' };
          base = Math.max(...solids.map((o) => o.top!));
        }
        if (avatars.has(key(x, y))) return { ok: false, reason: 'Tem alguém nesse lugar.' };
      }
      if (z === null) z = base;
      else if (Math.abs(base - z) > 0.01)
        return { ok: false, reason: 'Precisa de um apoio plano embaixo (ficaria torto).' };
    }
  }
  if (z !== null && floorZ !== null && z - floorZ + def.height > MAX_STACK_HEIGHT) {
    return { ok: false, reason: 'Alto demais para empilhar.' };
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

function inFootprint(t: TilePoint, fp: Footprint): boolean {
  return t.x >= fp.minX && t.x <= fp.maxX && t.y >= fp.minY && t.y <= fp.maxY;
}

function sameFootprint(a: Footprint, b: Footprint): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

/**
 * Altura da superfície de cada tile, onde um objeto colocado ali se apoiaria: o piso ou, se houver,
 * o tampo mais alto de um móvel que aceita coisas em cima. `ignoreId`: o móvel sendo arrastado.
 */
export function surfaceHeights(
  ctx: Pick<PlacementContext, 'map' | 'furni' | 'defs'>,
  ignoreId?: string,
): (x: number, y: number) => number | null {
  const tops = new Map<string, number>();
  for (const f of ctx.furni) {
    const d = f.id === ignoreId ? undefined : ctx.defs.get(f.defId);
    if (!d || !acceptsOnTop(d)) continue;
    const fp = footprint(d, f.x, f.y, f.rot);
    const top = f.z + topHeight(d);
    for (let y = fp.minY; y <= fp.maxY; y++) {
      for (let x = fp.minX; x <= fp.maxX; x++) {
        tops.set(key(x, y), Math.max(tops.get(key(x, y)) ?? top, top));
      }
    }
  }
  return (x, y) => {
    const floor = tileHeight(ctx.map, x, y);
    return floor === null ? null : Math.max(floor, tops.get(key(x, y)) ?? floor);
  };
}

/** Distância "de losango" entre o ponto e o centro do tile: até 1 = dentro dele. */
function diamondDistance(sx: number, sy: number, x: number, y: number, z: number): number {
  const c = tileToScreen(x, y, z);
  return Math.abs(sx - c.sx) / (TILE_W / 2) + Math.abs(sy - c.sy) / (TILE_H / 2);
}

/**
 * O ponto cai no "bloco" do tile: algum losango entre o piso (`floor`) e a superfície (`top`)
 * o contém. Num tile plano é o próprio losango; numa mesa, o tampo e a frente dela.
 */
function inBlock(sx: number, sy: number, x: number, y: number, floor: number, top: number) {
  const c = tileToScreen(x, y, 0);
  const dx = Math.abs(sx - c.sx) / (TILE_W / 2);
  if (dx >= 1) return false;
  const r = (TILE_H / 2) * (1 - dx);
  return sy >= c.sy - top * Z_UNIT - r && sy <= c.sy - floor * Z_UNIT + r;
}

/** Tile apontado no Decorar. `face`: o ponto está na frente/lateral de um tampo, não em cima. */
export type SurfaceTile = TilePoint & { z: number; face?: true };

/**
 * Tile apontado no Decorar, olhando a altura de cada superfície (Fase 53). Só vale "em cima" de
 * uma mesa quem aponta para o tampo dela. A frente e a lateral de um tampo escondem o piso de
 * trás. Ali não vale nem o piso escondido nem subir na mesa: volta o tampo com `face`, e o
 * arrasto fica onde estava. Sem nada sob o ponto (a borda da sala), vale o tile mais perto,
 * para o fantasma não sumir.
 */
export function surfaceTileAt(
  ctx: Pick<PlacementContext, 'map' | 'furni' | 'defs'>,
  sx: number,
  sy: number,
  ignoreId?: string,
): SurfaceTile | null {
  const heightAt = surfaceHeights(ctx, ignoreId);
  let hit: SurfaceTile | null = null;
  let face: SurfaceTile | null = null;
  let near: { x: number; y: number; z: number; d: number } | null = null;
  const ahead = (t: SurfaceTile | null, x: number, y: number, z: number) =>
    !t || x + y > t.x + t.y || (x + y === t.x + t.y && z > t.z);
  for (let y = 0; y < ctx.map.height; y++) {
    for (let x = 0; x < ctx.map.width; x++) {
      const floor = tileHeight(ctx.map, x, y);
      if (floor === null) continue;
      const z = heightAt(x, y) ?? floor;
      const d = diamondDistance(sx, sy, x, y, z);
      if (d <= 1) {
        if (ahead(hit, x, y, z)) hit = { x, y, z };
      } else if (z > floor && inBlock(sx, sy, x, y, floor, z)) {
        if (ahead(face, x, y, z)) face = { x, y, z, face: true };
      } else if (!near || d < near.d) {
        near = { x, y, z, d };
      }
    }
  }
  // A frente de um tampo mais à frente esconde o que estaria atrás dela.
  if (face && (!hit || face.x + face.y > hit.x + hit.y)) return face;
  if (hit) return hit;
  return near && near.d <= 2 ? { x: near.x, y: near.y, z: near.z } : null;
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
