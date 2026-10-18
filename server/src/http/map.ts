import type { MapRoom } from '@office/shared';
import type { RoomRepository } from '../services/RoomRepository.js';
import type { Caller, Result } from './auth.js';

export interface MapDeps {
  rooms: RoomRepository;
}

/** Salas e as portas entre elas, para o minimapa (qualquer pessoa logada). */
export function officeMap(_caller: Caller, deps: MapDeps): Result<MapRoom[]> {
  const rooms = deps.rooms.list().flatMap((r): MapRoom[] => {
    const layout = deps.rooms.getLayout(r.id);
    if (!layout) return [];
    return [
      {
        id: r.id,
        name: r.name,
        links: layout.doors.map((d) => ({ to: d.targetRoomId, side: d.x === 0 ? 'left' : 'top' })),
      },
    ];
  });
  return { ok: true, status: 200, body: rooms };
}
