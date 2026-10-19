import { ErrorCode, type FurniManifestEntry, type TeleportInfo } from '@office/shared';
import { z } from 'zod';
import type { FurniService } from '../services/FurniService.js';
import type { RoomRepository } from '../services/RoomRepository.js';
import { fail, type Caller, type Result } from './auth.js';

export interface TeleportDeps {
  furni: FurniService;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
  rooms: RoomRepository;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });
const linkSchema = z.object({ targetId: z.string().min(1).max(40).nullable() });

/** Todos os teleportes colocados, em todas as salas (Fase 37). */
export function listTeleports(deps: TeleportDeps): Result<TeleportInfo[]> {
  const ids = [...deps.furniDefs.values()]
    .filter((d) => d.interaction === 'teleport')
    .map((d) => d.id);
  const rooms = new Map(deps.rooms.list().map((r) => [r.id, r.name]));
  return ok(
    deps.furni
      .listByDefs(ids)
      .filter((f) => rooms.has(f.roomId))
      .map((f) => ({
        id: f.id,
        roomId: f.roomId,
        roomName: rooms.get(f.roomId)!,
        name: deps.furniDefs.get(f.defId)?.name ?? f.defId,
        x: f.x,
        y: f.y,
        linkedTo: deps.furni.linkedTo(f.id),
      })),
  );
}

/**
 * Liga um teleporte a outro (ou desliga, com `targetId: null`). Vale a mesma regra de decorar:
 * em sala com a decoração travada, só admin.
 */
export function linkTeleport(
  caller: Caller,
  id: string,
  input: unknown,
  deps: TeleportDeps,
): Result<TeleportInfo[]> {
  const p = linkSchema.safeParse(input);
  if (!p.success) return fail(400, ErrorCode.InvalidPayload);
  const isTeleport = (furniId: string) => {
    const f = deps.furni.locate(furniId);
    return f && deps.furniDefs.get(f.defId)?.interaction === 'teleport' ? f : undefined;
  };
  const from = isTeleport(id);
  const to = p.data.targetId ? isTeleport(p.data.targetId) : undefined;
  if (!from || (p.data.targetId && (!to || to.id === from.id))) {
    return fail(404, ErrorCode.NotFound, { message: 'Teleporte não encontrado.' });
  }
  // Mexe também no par atual de cada um (a ligação antiga se desfaz).
  const partners = [from.id, to?.id]
    .map((t) => t && deps.furni.linkedTo(t))
    .map((t) => (t ? deps.furni.locate(t) : undefined));
  const locked = [from, to, ...partners].some((f) => f && deps.rooms.isDecorLocked(f.roomId));
  if (locked && caller.user.role !== 'admin') return fail(403, ErrorCode.DecorLocked);
  if (to) deps.furni.link(from.id, to.id);
  else deps.furni.unlink(from.id);
  return listTeleports(deps);
}
