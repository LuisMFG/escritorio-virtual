/** Minimapa do escritório (Fase 28): salas e as portas que as ligam. */

/** De que parede sai a porta: esquerda (coluna 0) ou fundo (linha 0). */
export type DoorSide = 'left' | 'top';

export interface MapRoom {
  id: string;
  name: string;
  links: { to: string; side: DoorSide }[];
}

export interface MapCell {
  col: number;
  row: number;
}

/**
 * Posição de cada sala no mapa a partir das portas: porta na parede esquerda põe a sala
 * vizinha à esquerda; porta no fundo põe a vizinha acima. Começa pela primeira sala (a
 * Recepção) e anda pelas portas; se o lugar já estiver ocupado, usa o livre mais perto.
 * Salas sem porta para as outras vão para uma linha embaixo.
 */
export function layoutMap(rooms: readonly MapRoom[]): Map<string, MapCell> {
  const pos = new Map<string, MapCell>();
  const taken = new Set<string>();
  const key = (c: MapCell) => `${c.col},${c.row}`;
  const place = (id: string, want: MapCell) => {
    let best = want;
    for (let r = 0; taken.has(key(best)); r++) {
      const ring: MapCell[] = [];
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) === r)
            ring.push({ col: want.col + dc, row: want.row + dr });
        }
      }
      best = ring.find((c) => !taken.has(key(c))) ?? best;
    }
    pos.set(id, best);
    taken.add(key(best));
  };
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const first = rooms[0];
  if (!first) return pos;
  place(first.id, { col: 0, row: 0 });
  const queue = [first.id];
  while (queue.length) {
    const id = queue.shift()!;
    const here = pos.get(id)!;
    for (const link of byId.get(id)?.links ?? []) {
      if (pos.has(link.to) || !byId.has(link.to)) continue;
      place(
        link.to,
        link.side === 'left'
          ? { col: here.col - 1, row: here.row }
          : { col: here.col, row: here.row - 1 },
      );
      queue.push(link.to);
    }
  }
  // Salas soltas: uma linha abaixo de tudo.
  const loose = rooms.filter((r) => !pos.has(r.id));
  if (loose.length) {
    const bottom = Math.max(...[...pos.values()].map((c) => c.row)) + 1;
    const left = Math.min(...[...pos.values()].map((c) => c.col));
    loose.forEach((r, i) => place(r.id, { col: left + i, row: bottom }));
  }
  // Começa em (0,0) no canto de cima à esquerda.
  const minCol = Math.min(...[...pos.values()].map((c) => c.col));
  const minRow = Math.min(...[...pos.values()].map((c) => c.row));
  for (const [id, c] of pos) pos.set(id, { col: c.col - minCol, row: c.row - minRow });
  return pos;
}
