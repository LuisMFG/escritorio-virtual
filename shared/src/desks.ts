/**
 * Minha mesa (Fase 42): cada pessoa escolhe uma estação de trabalho na Recepção. A estação é
 * identificada pela cadeira (`…-cadeira`), que tem uma mesa com o mesmo prefixo (`…-mesa`),
 * como as montadas em `rooms.ts`.
 */
export const DESK_ROOM_ID = 'reception';

const SEAT_SUFFIX = '-cadeira';
const DESK_SUFFIX = '-mesa';

/** Id da mesa que acompanha a cadeira (`r-fila-1-cadeira` → `r-fila-1-mesa`). */
export function deskOfSeat(seatId: string): string | null {
  return seatId.endsWith(SEAT_SUFFIX) ? seatId.slice(0, -SEAT_SUFFIX.length) + DESK_SUFFIX : null;
}

/** Cadeiras de estação entre os móveis: as que têm a mesa correspondente na sala. */
export function deskSeatIds(furniIds: Iterable<string>): Set<string> {
  const ids = new Set(furniIds);
  const out = new Set<string>();
  for (const id of ids) {
    const desk = deskOfSeat(id);
    if (desk && ids.has(desk)) out.add(id);
  }
  return out;
}
