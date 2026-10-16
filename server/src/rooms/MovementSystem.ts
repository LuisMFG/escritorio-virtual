import {
  directionBetween,
  findNearestReachable,
  findPath,
  STEP_MS,
  type PathGrid,
  type TilePoint,
} from '@office/shared';

/** Campos do jogador que o movimento controla (o `Player` do estado satisfaz isto). */
export interface Mover {
  x: number;
  y: number;
  z: number;
  nextX: number;
  nextY: number;
  dir: number;
  action: string;
}

interface Walk {
  path: TilePoint[];
  /** Tempo decorrido no passo atual. */
  elapsed: number;
}

export type MoveResult = { ok: true; dest: TilePoint } | { ok: false };

/**
 * Movimento autoritativo. O cliente só pede um destino; o servidor calcula o caminho
 * (A* compartilhado), anda um tile a cada `STEP_MS` e publica `nextX/nextY` no início de
 * cada passo e `x/y` no fim. Um pedido novo no meio de um passo só vale depois que ele termina.
 */
export class MovementSystem {
  private readonly walks = new Map<string, Walk>();

  /**
   * @param gridFor grade da sala vista por um jogador (os outros avatares contam como ocupados).
   * @param onStepEnd chamado quando um passo termina; devolver `true` faz o avatar parar ali (ex.: porta).
   */
  constructor(
    private readonly gridFor: (id: string) => PathGrid,
    private readonly onStepEnd?: (id: string, m: Mover) => boolean | void,
  ) {}

  request(id: string, m: Mover, goal: TilePoint): MoveResult {
    const grid = this.gridFor(id);
    const start = this.isStepping(m) ? { x: m.nextX, y: m.nextY } : { x: m.x, y: m.y };
    let dest = goal;
    let path = findPath(grid, start, goal);
    if (!path) {
      const near = findNearestReachable(grid, start, goal, 2);
      if (!near) return { ok: false };
      dest = near.tile;
      path = near.path;
    }
    const walk = this.walks.get(id) ?? { path: [], elapsed: 0 };
    walk.path = path;
    this.walks.set(id, walk);
    if (!this.isStepping(m)) this.startStep(id, m, walk);
    return { ok: true, dest };
  }

  /** Destino final de quem está andando (para outros não escolherem o mesmo tile). */
  destinationOf(id: string, m: Mover): TilePoint {
    const walk = this.walks.get(id);
    const last = walk?.path.at(-1);
    if (last) return last;
    return this.isStepping(m) ? { x: m.nextX, y: m.nextY } : { x: m.x, y: m.y };
  }

  tick(dtMs: number, movers: Iterable<[string, Mover]>): void {
    for (const [id, m] of movers) {
      const walk = this.walks.get(id);
      if (!walk || !this.isStepping(m)) continue;
      walk.elapsed += dtMs;
      while (walk.elapsed >= STEP_MS && this.isStepping(m)) {
        walk.elapsed -= STEP_MS;
        m.x = m.nextX;
        m.y = m.nextY;
        m.z = this.gridFor(id).heightAt(m.x, m.y);
        if (this.onStepEnd?.(id, m) === true) {
          this.walks.delete(id);
          // O gancho pode ter definido outra ação (ex.: 'sit'); só "parado" se ainda andava.
          if (m.action === 'walk') m.action = 'idle';
          break;
        }
        this.startStep(id, m, walk);
      }
    }
  }

  remove(id: string): void {
    this.walks.delete(id);
  }

  private isStepping(m: Mover): boolean {
    return m.nextX !== m.x || m.nextY !== m.y;
  }

  private startStep(id: string, m: Mover, walk: Walk): void {
    const next = walk.path.shift();
    // Revalida o próximo tile: algo pode ter mudado desde o cálculo do caminho.
    if (!next || !this.gridFor(id).isWalkable(next.x, next.y, walk.path.length === 0)) {
      this.walks.delete(id);
      m.action = 'idle';
      return;
    }
    m.dir = directionBetween({ x: m.x, y: m.y }, next, m.dir);
    m.nextX = next.x;
    m.nextY = next.y;
    m.action = 'walk';
  }
}
