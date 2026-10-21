import { MAX_PATH_NODES, MAX_STEP_HEIGHT } from './constants.js';
import { DIRECTION_OFFSETS, type TilePoint } from './iso.js';

export interface PathGrid {
  readonly width: number;
  readonly height: number;
  /** `isGoal` permite tiles que só valem como destino (ex.: cadeira para sentar). */
  isWalkable(x: number, y: number, isGoal: boolean): boolean;
  heightAt(x: number, y: number): number;
}

export interface PathOptions {
  maxNodes?: number;
  maxStepHeight?: number;
}

/**
 * A* em grade com 8 vizinhos. Diagonal custa o mesmo que ortogonal (como no Habbo),
 * então a heurística é a distância de Chebyshev. Não corta quinas: um passo diagonal
 * exige que os dois tiles ortogonais vizinhos sejam livres.
 *
 * Devolve os tiles a percorrer **sem** o tile inicial (vazio se já estiver no destino),
 * ou `null` se não houver caminho.
 */
export function findPath(
  grid: PathGrid,
  start: TilePoint,
  goal: TilePoint,
  options: PathOptions = {},
): TilePoint[] | null {
  const maxNodes = options.maxNodes ?? MAX_PATH_NODES;
  const maxStep = options.maxStepHeight ?? MAX_STEP_HEIGHT;
  const { width } = grid;

  if (start.x === goal.x && start.y === goal.y) return [];
  if (!grid.isWalkable(goal.x, goal.y, true)) return null;

  const idx = (x: number, y: number) => y * width + x;
  const startIdx = idx(start.x, start.y);
  const goalIdx = idx(goal.x, goal.y);

  const gScore = new Map<number, number>([[startIdx, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  // Desempate pelo h favorece nós mais perto do destino, o que reduz expansões.
  open.push(startIdx, heuristic(start, goal), heuristic(start, goal));

  let expanded = 0;
  while (open.size > 0) {
    const current = open.pop()!;
    if (current === goalIdx) return reconstruct(cameFrom, current, width);
    if (closed.has(current)) continue;
    closed.add(current);
    if (++expanded > maxNodes) return null;

    const cx = current % width;
    const cy = (current - cx) / width;
    const ch = grid.heightAt(cx, cy);
    const g = gScore.get(current)!;

    for (const d of DIRECTION_OFFSETS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const nIdx = idx(nx, ny);
      if (closed.has(nIdx)) continue;
      const isGoal = nIdx === goalIdx;
      if (!grid.isWalkable(nx, ny, isGoal)) continue;
      if (Math.abs(grid.heightAt(nx, ny) - ch) > maxStep) continue;
      if (d.x !== 0 && d.y !== 0) {
        if (!grid.isWalkable(cx + d.x, cy, false) || !grid.isWalkable(cx, cy + d.y, false))
          continue;
      }
      const tentative = g + 1;
      if (tentative < (gScore.get(nIdx) ?? Infinity)) {
        gScore.set(nIdx, tentative);
        cameFrom.set(nIdx, current);
        const h = heuristic({ x: nx, y: ny }, goal);
        open.push(nIdx, tentative + h, h);
      }
    }
  }
  return null;
}

/**
 * Tile acessível mais próximo de `target` (por distância de Chebyshev ao alvo), útil
 * quando o usuário clica num tile bloqueado. Busca em anéis crescentes até `maxRadius`.
 */
export function findNearestReachable(
  grid: PathGrid,
  start: TilePoint,
  target: TilePoint,
  maxRadius = 3,
  options: PathOptions = {},
): { tile: TilePoint; path: TilePoint[] } | null {
  for (let r = 0; r <= maxRadius; r++) {
    let best: { tile: TilePoint; path: TilePoint[]; dist: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tile = { x: target.x + dx, y: target.y + dy };
        if (tile.x < 0 || tile.y < 0 || tile.x >= grid.width || tile.y >= grid.height) continue;
        // Partindo de um tile que não é de pisar (sentado na cadeira), ele mesmo não serve de
        // destino: o "mais perto" virava ficar em pé dentro da cadeira.
        if (tile.x === start.x && tile.y === start.y && !grid.isWalkable(start.x, start.y, true))
          continue;
        const path = findPath(grid, start, tile, options);
        if (!path) continue;
        // No mesmo anel, prefere o tile mais "reto" em relação ao alvo e depois o caminho mais curto.
        const dist = dx * dx + dy * dy;
        if (!best || dist < best.dist || (dist === best.dist && path.length < best.path.length)) {
          best = { tile, path, dist };
        }
      }
    }
    if (best) return { tile: best.tile, path: best.path };
  }
  return null;
}

function heuristic(a: TilePoint, b: TilePoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function reconstruct(cameFrom: Map<number, number>, end: number, width: number): TilePoint[] {
  const path: TilePoint[] = [];
  let cur: number | undefined = end;
  while (cur !== undefined && cameFrom.has(cur)) {
    path.push({ x: cur % width, y: Math.floor(cur / width) });
    cur = cameFrom.get(cur);
  }
  return path.reverse();
}

/** Heap binário mínimo por (f, h). */
class MinHeap {
  private items: { id: number; f: number; h: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(id: number, f: number, h: number): void {
    this.items.push({ id, f, h });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.less(l, m)) m = l;
        if (r < this.items.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top?.id;
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a]!;
    const y = this.items[b]!;
    return x.f < y.f || (x.f === y.f && x.h < y.h);
  }

  private swap(a: number, b: number): void {
    const t = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = t;
  }
}
