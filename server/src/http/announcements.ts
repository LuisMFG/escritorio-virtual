import { announcementCreateSchema, ErrorCode, type Announcement } from '@office/shared';
import type { AnnouncementService } from '../services/AnnouncementService.js';
import type { AuditService } from '../services/AuditService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface AnnouncementDeps {
  announcements: AnnouncementService;
  audit: AuditService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });
const isAdmin = (c: Caller) => c.user.role === 'admin';

export function listAnnouncements(caller: Caller, deps: AnnouncementDeps): Result<Announcement[]> {
  return ok(deps.announcements.list(caller.user.id, isAdmin(caller)));
}

export function unreadAnnouncements(
  caller: Caller,
  deps: AnnouncementDeps,
): Result<Announcement[]> {
  return ok(deps.announcements.unread(caller.user.id));
}

/** Só admins publicam. */
export function createAnnouncement(
  caller: Caller,
  input: unknown,
  deps: AnnouncementDeps,
): Result<Announcement> {
  if (!isAdmin(caller)) return fail(403, ErrorCode.Forbidden);
  const p = announcementCreateSchema.safeParse(input);
  if (!p.success) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: p.error.issues[0]?.message ?? 'Dados inválidos.',
    });
  }
  const a = deps.announcements.create(caller.user.id, p.data);
  deps.audit.log(caller.user.id, 'announcement.create', null, a.title);
  return ok(a);
}

export function readAnnouncement(
  caller: Caller,
  id: number,
  deps: AnnouncementDeps,
): Result<{ ok: true }> {
  if (!deps.announcements.exists(id)) return fail(404, ErrorCode.NotFound);
  deps.announcements.markRead(id, caller.user.id);
  return ok({ ok: true as const });
}

export function deleteAnnouncement(
  caller: Caller,
  id: number,
  deps: AnnouncementDeps,
): Result<{ ok: true }> {
  if (!isAdmin(caller)) return fail(403, ErrorCode.Forbidden);
  if (!deps.announcements.remove(id)) return fail(404, ErrorCode.NotFound);
  deps.audit.log(caller.user.id, 'announcement.delete', null, `#${id}`);
  return ok({ ok: true as const });
}
