import { footprint, type FurniDef, type PlacedFurni } from './furni.js';
import type { TilePoint } from './iso.js';
import type { PathGrid } from './pathfinding.js';

export interface Heightmap {
  width: number;
  height: number;
  /** `heights[y][x]`; `null` = sem tile (vazio/parede). */
  heights: (number | null)[][];
}

/**
 * Lê um heightmap no formato do Habbo: uma linha por y, um caractere por x.
 * `x` = sem tile, `0`–`9` = altura 0–9, `a`–`z` = altura 10–35.
 */
export function parseHeightmap(rows: readonly string[]): Heightmap {
  const lines = rows.map((r) => r.trim()).filter((r) => r.length > 0);
  const width = Math.max(0, ...lines.map((l) => l.length));
  const heights = lines.map((line) => {
    const row: (number | null)[] = [];
    for (let x = 0; x < width; x++) row.push(parseHeightChar(line[x] ?? 'x'));
    return row;
  });
  return { width, height: lines.length, heights };
}

function parseHeightChar(c: string): number | null {
  const ch = c.toLowerCase();
  if (ch === 'x') return null;
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 97 + 10;
  throw new Error(`Caractere inválido no heightmap: "${c}"`);
}

export function tileHeight(map: Heightmap, x: number, y: number): number | null {
  return map.heights[y]?.[x] ?? null;
}

export interface RoomGridOptions {
  /**
   * Tiles que não podem ser pisados (ex.: posição de outros avatares parados). Pode ser uma
   * função: só é chamada quando alguém pergunta por um destino (andar um passo não precisa).
   */
  occupied?: readonly TilePoint[] | (() => readonly TilePoint[]);
  /** Permite usar assentos como destino (para sentar). Padrão: true. */
  seatsAsGoal?: boolean;
  /**
   * Tiles bloqueados que este avatar pode atravessar, sem parar neles: os do móvel em que ele
   * está (cama, sofá), como no Habbo. Sem isso, deitado numa cama encostada em outros móveis, não
   * havia como sair dela.
   */
  passable?: readonly TilePoint[];
}

/** Estado de cada tile, considerando o piso e os móveis posicionados. */
export interface TileInfo {
  floor: number | null;
  /** Altura da superfície em que um avatar fica (piso + tapetes). */
  standHeight: number;
  /** Bloqueado por um móvel que não é de andar por cima. */
  blocked: boolean;
  /** Móvel de sentar que ocupa este tile, se houver. */
  seat: PlacedFurni | null;
}

/**
 * A parte fixa da grade: o piso e os móveis. Só muda quando eles mudam, então dá para montar
 * uma vez e reaproveitar em cada pedido (o servidor perguntava a cada passo de cada pessoa).
 */
export class GridBase {
  readonly width: number;
  readonly height: number;
  private readonly tiles: TileInfo[];

  constructor(
    readonly map: Heightmap,
    furni: readonly PlacedFurni[],
    defs: ReadonlyMap<string, FurniDef>,
  ) {
    this.width = map.width;
    this.height = map.height;
    this.tiles = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const floor = tileHeight(map, x, y);
        this.tiles.push({ floor, standHeight: floor ?? 0, blocked: false, seat: null });
      }
    }
    for (const f of furni) {
      const def = defs.get(f.defId);
      // Itens de parede não ocupam o piso.
      if (!def || def.wall) continue;
      const fp = footprint(def, f.x, f.y, f.rot);
      for (let y = fp.minY; y <= fp.maxY; y++) {
        for (let x = fp.minX; x <= fp.maxX; x++) {
          const t = this.tile(x, y);
          if (!t) continue;
          if (def.canWalk) {
            t.standHeight = Math.max(t.standHeight, f.z + def.height);
          } else {
            t.blocked = true;
            if (def.canSit || def.canLay) t.seat = f;
          }
        }
      }
    }
  }

  tile(x: number, y: number): TileInfo | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined;
    return this.tiles[y * this.width + x];
  }
}

/**
 * Grade da sala pronta para o pathfinding e para a validação de posições: a base (piso e
 * móveis) mais o que é de cada pedido (quem está onde, o que dá para atravessar).
 */
export class RoomGrid implements PathGrid {
  readonly width: number;
  readonly height: number;
  readonly map: Heightmap;
  readonly base: GridBase;
  private occupiedSet: Set<string> | null = null;
  private readonly occupiedSource: RoomGridOptions['occupied'];
  private readonly passable = new Set<string>();
  private readonly seatsAsGoal: boolean;

  constructor(
    map: Heightmap,
    furni: readonly PlacedFurni[],
    defs: ReadonlyMap<string, FurniDef>,
    options?: RoomGridOptions,
  );
  constructor(base: GridBase, options?: RoomGridOptions);
  constructor(
    mapOrBase: Heightmap | GridBase,
    furniOrOptions?: readonly PlacedFurni[] | RoomGridOptions,
    defs?: ReadonlyMap<string, FurniDef>,
    options: RoomGridOptions = {},
  ) {
    if (mapOrBase instanceof GridBase) {
      this.base = mapOrBase;
      options = (furniOrOptions as RoomGridOptions | undefined) ?? {};
    } else {
      this.base = new GridBase(mapOrBase, furniOrOptions as readonly PlacedFurni[], defs!);
    }
    this.map = this.base.map;
    this.width = this.base.width;
    this.height = this.base.height;
    this.occupiedSource = options.occupied;
    for (const p of options.passable ?? []) this.passable.add(key(p.x, p.y));
    this.seatsAsGoal = options.seatsAsGoal ?? true;
  }

  tile(x: number, y: number): TileInfo | undefined {
    return this.base.tile(x, y);
  }

  heightAt(x: number, y: number): number {
    return this.tile(x, y)?.standHeight ?? 0;
  }

  /** Tile existe e está livre de móveis bloqueantes. Assentos só valem como destino final. */
  isWalkable(x: number, y: number, isGoal: boolean): boolean {
    const t = this.tile(x, y);
    if (!t || t.floor === null) return false;
    if (t.blocked && !isGoal && this.passable.has(key(x, y))) return true;
    if (t.blocked && !(isGoal && t.seat && this.seatsAsGoal)) return false;
    if (isGoal && this.occupied().has(key(x, y))) return false;
    return true;
  }

  private occupied(): Set<string> {
    if (!this.occupiedSet) {
      const src = this.occupiedSource;
      const list = typeof src === 'function' ? src() : (src ?? []);
      this.occupiedSet = new Set(list.map((p) => key(p.x, p.y)));
    }
    return this.occupiedSet;
  }
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}
