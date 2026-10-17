import {
  ErrorCode,
  MAX_ROOMS,
  RECEPTION,
  roomCreateSchema,
  roomEditSchema,
  validateRoomEdit,
  type FurniManifestEntry,
  type RoomEditorData,
  type RoomSummary,
} from '@office/shared';
import type { FurniService } from '../services/FurniService.js';
import type { AdminDeps } from './admin.js';
import { fail, type Caller, type Result } from './auth.js';

export interface RoomDeps extends AdminDeps {
  furni: FurniService;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });

/** Admins e quem eles liberaram. */
function guard(caller: Caller) {
  const allowed = caller.user.role === 'admin' || caller.user.canEditRooms;
  return allowed
    ? undefined
    : fail(403, ErrorCode.Forbidden, { message: 'Você não tem permissão para editar salas.' });
}

function parseError(issues: { message: string }[]) {
  return fail(400, ErrorCode.InvalidPayload, { message: issues[0]?.message ?? 'Dados inválidos.' });
}

/** Avisa as salas abertas que o layout mudou e o lobby que a lista mudou. */
function announce(deps: RoomDeps, affected: readonly string[]): void {
  for (const roomId of affected) deps.moderation.emit('layout', { roomId });
  deps.moderation.emit('rooms');
}

const onlineIn = (deps: RoomDeps, roomId: string) =>
  deps.presence.list().filter((e) => e.roomId === roomId).length;

export function listRooms(deps: RoomDeps): Result<RoomSummary[]> {
  return ok(deps.rooms.list().map(({ id, name }) => ({ id, name })));
}

export function getRoom(caller: Caller, roomId: string, deps: RoomDeps): Result<RoomEditorData> {
  const denied = guard(caller);
  if (denied) return denied;
  const data = deps.rooms.editorData(roomId, onlineIn(deps, roomId));
  return data ? ok(data) : fail(404, ErrorCode.NotFound, { message: 'Sala inexistente.' });
}

export function createRoom(caller: Caller, input: unknown, deps: RoomDeps): Result<{ id: string }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = roomCreateSchema.safeParse(input);
  if (!p.success) return parseError(p.error.issues);
  if (deps.rooms.list().length >= MAX_ROOMS) {
    return fail(409, ErrorCode.Forbidden, { message: `O escritório já tem ${MAX_ROOMS} salas.` });
  }
  const { id, affected } = deps.rooms.create(p.data.name, deps.furniDefs);
  deps.audit.log(caller.user.id, 'room.create', null, p.data.name);
  announce(deps, affected);
  return ok({ id });
}

export function updateRoom(
  caller: Caller,
  roomId: string,
  input: unknown,
  deps: RoomDeps,
): Result<{ removedFurni: number }> {
  const denied = guard(caller);
  if (denied) return denied;
  if (!deps.rooms.exists(roomId)) return fail(404, ErrorCode.NotFound);
  const p = roomEditSchema.safeParse(input);
  if (!p.success) return parseError(p.error.issues);
  const res = validateRoomEdit(p.data, {
    selfId: roomId,
    roomIds: new Set(deps.rooms.list().map((r) => r.id)),
    furni: deps.furni.list(roomId),
    defs: deps.furniDefs,
  });
  if (!res.ok) return fail(400, ErrorCode.InvalidPayload, { message: res.error });
  const affected = deps.rooms.update(roomId, p.data, res.removedFurni, deps.furniDefs);
  deps.audit.log(caller.user.id, 'room.update', null, p.data.name);
  announce(deps, affected);
  return ok({ removedFurni: res.removedFurni.length });
}

export function deleteRoom(caller: Caller, roomId: string, deps: RoomDeps): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  if (roomId === RECEPTION.id) {
    return fail(409, ErrorCode.Forbidden, { message: 'A Recepção não pode ser excluída.' });
  }
  const room = deps.rooms.list().find((r) => r.id === roomId);
  if (!room) return fail(404, ErrorCode.NotFound);
  if (onlineIn(deps, roomId) > 0) {
    return fail(409, ErrorCode.Forbidden, {
      message: 'Tem gente nessa sala. Ela precisa estar vazia para ser excluída.',
    });
  }
  const affected = deps.rooms.delete(roomId);
  deps.audit.log(caller.user.id, 'room.delete', null, room.name);
  announce(deps, affected);
  return ok({ ok: true as const });
}
