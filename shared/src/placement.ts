import {
  footprint,
  footprintSize,
  type Footprint,
  type FurniDef,
  type PlacedFurni,
} from './furni.js';
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

/**
 * Nada vai em cima: algo desenhado ou jogado por cima (quadros, tabuleiro), a tela da TV e a porta
 * do teleporte.
 */
const NO_TOP_INTERACTIONS = new Set([
  'whiteboard',
  'board',
  'kudos',
  'jira',
  'tictactoe',
  'tv',
  'teleport',
]);
/** Categorias que não servem de base mesmo com altura (as do escritório e as do catálogo). */
const NO_TOP_CATEGORIES = new Set(['plantas', 'luzes']);
/** Abaixo desta altura (tapetes, colchonetes) não é tampo. */
const MIN_TOP = 0.3;
/** Passo do ajuste fino de altura (Fase 56), como a ferramenta do Habbo. */
export const HEIGHT_STEP = 0.1;

/**
 * Dá para colocar objetos em cima deste móvel? Fase 56: todo móvel sólido com altura serve de
 * base, como no Habbo, e também os blocos de pisar (barris, plataformas). Ficam de fora assentos,
 * camas, tapetes e itens de parede, e as exceções: luminárias, plantas, quadros e tabuleiros, TVs
 * e teleportes (e o que a curadoria marca com `hasTop: false`).
 */
export function acceptsOnTop(def: FurniDef): boolean {
  if (def.wall || def.canSit || def.canLay || def.hasTop === false || def.light) return false;
  if (NO_TOP_INTERACTIONS.has(def.interaction ?? '') || NO_TOP_CATEGORIES.has(def.category)) {
    return false;
  }
  return topHeight(def) >= MIN_TOP;
}

/** Altura do tampo (onde o que vai em cima se apoia). */
export function topHeight(def: FurniDef): number {
  return def.stackHeight ?? def.height;
}

/** Tapete e afins: rasteiro e de pisar (fica por baixo de tudo, sem nada em cima). */
export function isRug(def: FurniDef): boolean {
  return def.canWalk && topHeight(def) < MIN_TOP;
}

/** Móveis apoiados diretamente em cima de `base`. */
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
    if (!d || d.wall || isRug(d) || f.z < top - 0.01) return false;
    const fp = footprint(d, f.x, f.y, f.rot);
    return fp.minX <= bfp.maxX && fp.maxX >= bfp.minX && fp.minY <= bfp.maxY && fp.maxY >= bfp.minY;
  });
}

/** A pilha em cima de `base`, direta ou indireta: o que vai junto quando ela se move (Fase 56). */
export function stackGroup(
  base: PlacedFurni,
  furni: readonly PlacedFurni[],
  defs: ReadonlyMap<string, FurniDef>,
): PlacedFurni[] {
  const out: PlacedFurni[] = [];
  const seen = new Set([base.id]);
  const queue = [base];
  while (queue.length) {
    for (const f of stackedOn(queue.shift()!, furni, defs)) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
      queue.push(f);
    }
  }
  return out;
}

/** Rotação do móvel depois de `turns` quartos de volta (a que ele não tiver, fica a de antes). */
function turned(def: FurniDef, rot: number, turns: number): number {
  const want = (rot + 2 * turns) % 8;
  return def.directions.includes(want) || (want === 0 && !def.directions.length) ? want : rot;
}

/**
 * Para onde vai a pilha quando a base vai para `to` (Fase 56): cada coisa mantém o lugar em cima
 * dela e a altura em relação a ela; girando a base, gira junto (e gira a própria coisa, se der).
 * Devolve `null` se alguma coisa sairia de cima da base (uma comprida que não gira).
 */
export function groupMoves(
  ctx: Pick<PlacementContext, 'furni' | 'defs'>,
  base: PlacedFurni,
  to: { x: number; y: number; z: number; rot: number },
): PlacedFurni[] | null {
  const bd = ctx.defs.get(base.defId);
  if (!bd) return null;
  const turns = ((((to.rot - base.rot) / 2) % 4) + 4) % 4;
  const start = footprintSize(bd, base.rot);
  const end = footprintSize(bd, to.rot);
  const out: PlacedFurni[] = [];
  for (const g of stackGroup(base, ctx.furni, ctx.defs)) {
    const gd = ctx.defs.get(g.defId);
    if (!gd) return null;
    const size = footprintSize(gd, g.rot);
    // O centro da coisa dentro da base, girado como a base: (x, y) → (D − 1 − y, x) por quarto.
    let cx = g.x - base.x + (size.w - 1) / 2;
    let cy = g.y - base.y + (size.d - 1) / 2;
    let grid = start;
    for (let i = 0; i < turns; i++) {
      [cx, cy] = [grid.d - 1 - cy, cx];
      grid = { w: grid.d, d: grid.w };
    }
    const rot = turned(gd, g.rot, turns);
    const now = footprintSize(gd, rot);
    const rx = Math.round(cx - (now.w - 1) / 2);
    const ry = Math.round(cy - (now.d - 1) / 2);
    if (rx < 0 || ry < 0 || rx + now.w > end.w || ry + now.d > end.d) return null;
    out.push({ ...g, x: to.x + rx, y: to.y + ry, z: to.z + (g.z - base.z), rot });
  }
  return out;
}

/** Alguém sentado, deitado ou em pé em cima deste móvel (tapete não conta). */
function someoneOn(ctx: Pick<PlacementContext, 'avatars' | 'defs'>, f: PlacedFurni): boolean {
  const d = ctx.defs.get(f.defId);
  if (!d || isRug(d) || d.wall) return false;
  const fp = footprint(d, f.x, f.y, f.rot);
  return ctx.avatars.some((a) => inFootprint(a, fp));
}

/**
 * Ajuste fino de altura (Fase 56), como a ferramenta do Habbo: o móvel sobe ou desce em passos
 * de `HEIGHT_STEP`, levando junto o que está em cima. Vai do apoio (o piso ou o tampo de baixo:
 * afundar no móvel de baixo desfaria a pilha) até `MAX_STACK_HEIGHT` acima do piso.
 */
export function canSetHeight(
  ctx: PlacementContext,
  furniId: string,
  z: number,
): { ok: true; moves: PlacedFurni[] } | { ok: false; reason: string } {
  const f = ctx.furni.find((p) => p.id === furniId);
  const def = f && ctx.defs.get(f.defId);
  if (!f || !def) return { ok: false, reason: 'Esse móvel não existe mais.' };
  if (def.wall) return { ok: false, reason: 'Item de parede sobe e desce arrastando na parede.' };
  if (someoneOn(ctx, f)) return { ok: false, reason: 'Tem alguém em cima.' };
  const floor = tileHeight(ctx.map, f.x, f.y) ?? 0;
  const target = Math.round(z / HEIGHT_STEP) * HEIGHT_STEP;
  const group = stackGroup(f, ctx.furni, ctx.defs);
  if (group.some((g) => someoneOn(ctx, g))) return { ok: false, reason: 'Tem alguém em cima.' };
  const dz = target - f.z;
  const highest = Math.max(target, ...group.map((g) => g.z + dz));
  const support = supportHeight(ctx, f, def, new Set([f.id, ...group.map((g) => g.id)]));
  if (target < support - 0.001) {
    const reason = support > floor + 0.001 ? 'Está apoiado no móvel de baixo.' : 'Já está no chão.';
    return { ok: false, reason };
  }
  if (highest - floor > MAX_STACK_HEIGHT + 0.001) {
    return { ok: false, reason: `Mais alto não dá (até ${MAX_STACK_HEIGHT}).` };
  }
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    ok: true,
    moves: [{ ...f, z: round(target) }, ...group.map((g) => ({ ...g, z: round(g.z + dz) }))],
  };
}

/** Onde o móvel se apoia: o piso ou o tampo mais alto embaixo dele (sem contar `skip`). */
function supportHeight(
  ctx: Pick<PlacementContext, 'map' | 'furni' | 'defs'>,
  f: PlacedFurni,
  def: FurniDef,
  skip: ReadonlySet<string>,
): number {
  const fp = footprint(def, f.x, f.y, f.rot);
  let support = tileHeight(ctx.map, f.x, f.y) ?? 0;
  for (const o of ctx.furni) {
    const d = skip.has(o.id) ? undefined : ctx.defs.get(o.defId);
    if (!d || !acceptsOnTop(d)) continue;
    const top = o.z + topHeight(d);
    const ofp = footprint(d, o.x, o.y, o.rot);
    const overlap =
      ofp.minX <= fp.maxX && ofp.maxX >= fp.minX && ofp.minY <= fp.maxY && ofp.maxY >= fp.minY;
    // Só o que está embaixo: um tampo acima do móvel é de outra pilha (ou dele mesmo).
    if (overlap && top <= f.z + 0.01) support = Math.max(support, top);
  }
  return support;
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
 *   camas só no chão; uma base que se move leva junto o que está em cima (Fase 56);
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
  // O que está em cima de quem se move vai junto (Fase 56): não é obstáculo, mas ninguém pode
  // estar sentado nem em pé nele.
  const group = moving ? stackGroup(moving, ctx.furni, ctx.defs) : [];
  if (moving && (someoneOn(ctx, moving) || group.some((g) => someoneOn(ctx, g)))) {
    return { ok: false, reason: 'Tem alguém sentado aí.' };
  }
  const carried = new Set(group.map((g) => g.id));
  const reserved = reservedTiles(ctx);
  const avatars = new Set(ctx.avatars.map((a) => key(a.x, a.y)));
  /** O que já ocupa cada tile: tapete, ou outra coisa (com o tampo, se aceita coisas em cima). */
  const occupied = new Map<string, { rug: boolean; top: number | null }[]>();
  for (const f of others) {
    const d = ctx.defs.get(f.defId);
    if (!d || d.wall || carried.has(f.id)) continue;
    const ofp = footprint(d, f.x, f.y, f.rot);
    const top = acceptsOnTop(d) ? f.z + topHeight(d) : null;
    for (let y = ofp.minY; y <= ofp.maxY; y++) {
      for (let x = ofp.minX; x <= ofp.maxX; x++) {
        const list = occupied.get(key(x, y)) ?? [];
        list.push({ rug: isRug(d), top });
        occupied.set(key(x, y), list);
      }
    }
  }
  const rug = isRug(def);
  /** Camas só no chão; assentos já vão em cima de plataformas e blocos (Fase 56). */
  const stackable = !def.canLay;

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
      if (rug) {
        // Tapete: no chão, sem outro tapete embaixo.
        if (here.some((o) => o.rug)) return { ok: false, reason: 'Já tem um móvel aí.' };
      } else {
        const things = here.filter((o) => !o.rug);
        if (things.length) {
          // Em cima de outra coisa: só se ela tem tampo (e o que vai em cima não é cama).
          if (!stackable || things.some((o) => o.top === null))
            return { ok: false, reason: 'Já tem um móvel aí.' };
          base = Math.max(...things.map((o) => o.top!));
        }
        if (avatars.has(key(x, y))) return { ok: false, reason: 'Tem alguém nesse lugar.' };
      }
      if (z === null) z = base;
      else if (Math.abs(base - z) > 0.01)
        return { ok: false, reason: 'Precisa de um apoio plano embaixo (ficaria torto).' };
    }
  }
  // A pilha conta: o mais alto do que vai junto não pode passar do limite.
  const tallest = Math.max(
    def.height,
    ...group.map((g) => g.z - moving!.z + (ctx.defs.get(g.defId)?.height ?? 0)),
  );
  if (z !== null && floorZ !== null && z - floorZ + tallest > MAX_STACK_HEIGHT) {
    return { ok: false, reason: 'Alto demais para empilhar.' };
  }
  let carriedTo: PlacedFurni[] = [];
  if (moving && group.length) {
    const to = { x: req.x, y: req.y, z: z ?? 0, rot: req.rot };
    const moves = groupMoves(ctx, moving, to);
    if (!moves) return { ok: false, reason: 'O que está em cima não cabe girado. Tire antes.' };
    carriedTo = moves;
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
    const after = [...others.filter((f) => !carried.has(f.id)), placed, ...carriedTo];
    const grid = new RoomGrid(ctx.map, after, ctx.defs, { seatsAsGoal: false });
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
