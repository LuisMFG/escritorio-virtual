import {
  ErrorCode,
  meetingCreateSchema,
  meetingResponseSchema,
  type Meeting,
} from '@office/shared';
import type { MeetingService } from '../services/MeetingService.js';
import { fail, type Caller, type Result } from './auth.js';
import type { RoomDeps } from './rooms.js';

export interface MeetingDeps extends RoomDeps {
  meetings: MeetingService;
  now?: () => number;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });
const DAY = 86_400_000;

/** Agenda do escritório: de ontem até as próximas duas semanas (ou o intervalo pedido). */
export function listMeetings(
  query: { from?: unknown; to?: unknown },
  deps: MeetingDeps,
): Result<Meeting[]> {
  const now = deps.now?.() ?? Date.now();
  const from = Number(query.from) || now - DAY;
  const to = Number(query.to) || now + 14 * DAY;
  if (to - from > 62 * DAY) {
    return fail(400, ErrorCode.InvalidPayload, { message: 'Intervalo grande demais.' });
  }
  return ok(deps.meetings.list(from, to));
}

export function createMeeting(caller: Caller, input: unknown, deps: MeetingDeps): Result<Meeting> {
  const p = meetingCreateSchema.safeParse(input);
  if (!p.success) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: p.error.issues[0]?.message ?? 'Dados inválidos.',
    });
  }
  const m = p.data;
  const now = deps.now?.() ?? Date.now();
  // Até 15 min no passado: dá para marcar "a reunião que está começando agora" (horas de 5 em 5 min).
  if (m.startsAt < now - 15 * 60_000) {
    return fail(400, ErrorCode.InvalidPayload, { message: 'Escolha um horário no futuro.' });
  }
  if (!deps.rooms.exists(m.roomId)) {
    return fail(404, ErrorCode.NotFound, { message: 'Sala inexistente.' });
  }
  const invalid = m.attendeeIds.find((id) => {
    const u = deps.users.findById(id);
    return !u || u.disabled;
  });
  if (invalid) return fail(404, ErrorCode.NotFound, { message: 'Um dos convidados não existe.' });
  const clash = deps.meetings.conflict(m.roomId, m.startsAt, m.durationMin);
  if (clash) {
    return fail(409, ErrorCode.Forbidden, {
      message: `A sala já tem “${clash.title}” nesse horário.`,
    });
  }
  const meeting = deps.meetings.create({ ...m, createdBy: caller.user.id });
  const invited = meeting.attendees.map((a) => a.userId).filter((id) => id !== caller.user.id);
  deps.meetings.events.emit('changed');
  if (invited.length > 0) deps.meetings.events.emit('invited', meeting, invited);
  return ok(meeting);
}

export function respondMeeting(
  caller: Caller,
  id: number,
  input: unknown,
  deps: MeetingDeps,
): Result<Meeting> {
  const p = meetingResponseSchema.safeParse(input);
  if (!p.success) return fail(400, ErrorCode.InvalidPayload);
  if (!deps.meetings.respond(id, caller.user.id, p.data.response)) {
    return fail(404, ErrorCode.NotFound, { message: 'Você não foi convidado para essa reunião.' });
  }
  deps.meetings.events.emit('changed');
  return ok(deps.meetings.get(id)!);
}

/** Cancelar: quem marcou ou um admin. */
export function cancelMeeting(caller: Caller, id: number, deps: MeetingDeps): Result<{ ok: true }> {
  const m = deps.meetings.get(id);
  if (!m) return fail(404, ErrorCode.NotFound);
  if (m.createdBy !== caller.user.id && caller.user.role !== 'admin') {
    return fail(403, ErrorCode.Forbidden, { message: 'Só quem marcou (ou um admin) cancela.' });
  }
  deps.meetings.cancel(id);
  deps.meetings.events.emit('changed');
  return ok({ ok: true as const });
}
