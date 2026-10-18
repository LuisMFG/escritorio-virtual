import { randomInt } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import {
  adminUserUpdateSchema,
  cargoAssignSchema,
  cargoCreateSchema,
  cargoOrderSchema,
  cargoUpdateSchema,
  ErrorCode,
  inviteSchema,
  kickSchema,
  RECEPTION,
  roomSettingsSchema,
  type AdminOverview,
  type AuditEntry,
  type BackupInfo,
  type BackupList,
  type TempPasswordResponse,
  jiraSiteSchema,
  normalizeJiraSite,
} from '@office/shared';
import type { z } from 'zod';
import { hashPassword } from '../auth/passwords.js';
import type { AuditService } from '../services/AuditService.js';
import { BACKUP_HOUR, type BackupService } from '../services/BackupService.js';
import type { ModerationEvents } from '../services/index.js';
import type { RoomRepository } from '../services/RoomRepository.js';
import type { SettingsService } from '../services/SettingsService.js';
import { fail, team, type AuthDeps, type Caller, type Result } from './auth.js';

export interface AdminDeps extends AuthDeps {
  audit: AuditService;
  settings: SettingsService;
  rooms: RoomRepository;
  moderation: EventEmitter<ModerationEvents>;
  backups: BackupService;
}

type Ok<T> = { ok: true; status: 200; body: T };
const ok = <T>(body: T): Ok<T> => ({ ok: true, status: 200, body });
const done = () => ok({ ok: true as const });

function parse<S extends z.ZodType>(schema: S, input: unknown) {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { data: parsed.data as z.output<S> };
  return {
    error: fail(400, ErrorCode.InvalidPayload, {
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    }),
  };
}

/** Todas as rotas daqui exigem admin. */
function guard(caller: Caller) {
  return caller.user.role === 'admin' ? undefined : fail(403, ErrorCode.Forbidden);
}

/** Senha temporária fácil de ditar: sem 0/O, 1/l/I. */
function tempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => chars[randomInt(chars.length)];
  return Array.from({ length: 3 }, () => Array.from({ length: 4 }, pick).join('')).join('-');
}

export function overview(caller: Caller, deps: AdminDeps): Result<AdminOverview> {
  const denied = guard(caller);
  if (denied) return denied;
  const t = team(deps);
  if (!t.ok) return t;
  const byId = new Map(deps.users.list().map((u) => [u.id, u]));
  return ok({
    inviteCode: deps.settings.inviteCode(),
    jiraSite: deps.settings.jiraSite(),
    jiraSiteLocked: deps.settings.jiraSiteLocked,
    rooms: deps.rooms.list(),
    cargos: t.body.cargos,
    users: t.body.members.map((m) => ({
      ...m,
      disabled: byId.get(m.userId)?.disabled ?? false,
      canEditRooms: byId.get(m.userId)?.canEditRooms ?? false,
      fixedAdmin: Boolean(m.username && deps.adminUsernames.includes(m.username)),
    })),
  });
}

/** Papel, cargo e desativar/reativar. */
export function updateUser(
  caller: Caller,
  userId: string,
  input: unknown,
  deps: AdminDeps,
): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = parse(adminUserUpdateSchema, input);
  if ('error' in p) return p.error!;
  const target = deps.users.findById(userId);
  if (!target) return fail(404, ErrorCode.NotFound);
  const { role, disabled, cargoId, canEditRooms } = p.data;
  const actor = caller.user.id;

  if (role !== undefined && role !== target.role) {
    if (role === 'member' && target.username && deps.adminUsernames.includes(target.username)) {
      return fail(409, ErrorCode.Forbidden, {
        message: 'Esta pessoa é admin pelo ADMIN_USERNAMES do servidor; o papel não muda aqui.',
      });
    }
    if (role === 'member' && target.role === 'admin' && deps.users.countAdmins() <= 1) {
      return fail(409, ErrorCode.Forbidden, {
        message: 'O escritório precisa de pelo menos um admin.',
      });
    }
    deps.users.update(userId, { role });
    deps.audit.log(actor, 'user.role', userId, role === 'admin' ? 'Admin' : 'Membro');
  }

  if (cargoId !== undefined && cargoId !== target.cargoId) {
    const cargo = cargoId === null ? null : deps.users.listCargos().find((c) => c.id === cargoId);
    if (cargo === undefined)
      return fail(404, ErrorCode.NotFound, { message: 'Cargo inexistente.' });
    deps.users.update(userId, { cargoId });
    deps.audit.log(actor, 'user.cargo', userId, cargo?.name ?? 'Sem cargo');
  }

  if (canEditRooms !== undefined && canEditRooms !== target.canEditRooms) {
    deps.users.update(userId, { canEditRooms });
    deps.audit.log(actor, 'user.rooms', userId, canEditRooms ? 'pode' : 'não pode');
  }

  if (disabled !== undefined && disabled !== target.disabled) {
    if (userId === actor) {
      return fail(409, ErrorCode.Forbidden, {
        message: 'Você não pode desativar a própria conta.',
      });
    }
    if (disabled && target.role === 'admin' && deps.users.countAdmins() <= 1) {
      return fail(409, ErrorCode.Forbidden, {
        message: 'O escritório precisa de pelo menos um admin.',
      });
    }
    deps.users.update(userId, { disabled });
    if (disabled) {
      deps.users.deleteAllSessions(userId);
      deps.moderation.emit('kick', { userId, scope: 'office', byName: caller.user.name });
    }
    deps.audit.log(actor, disabled ? 'user.disable' : 'user.enable', userId);
  }
  return done();
}

/** Atalho usado pela aba Equipe (só o cargo). */
export function assignCargo(
  caller: Caller,
  userId: string,
  input: unknown,
  deps: AdminDeps,
): Result<{ ok: true }> {
  const p = parse(cargoAssignSchema, input);
  if ('error' in p) return p.error!;
  return updateUser(caller, userId, { cargoId: p.data.cargoId }, deps);
}

/** Gera uma senha temporária (mostrada uma vez) e desconecta os aparelhos da pessoa. */
export async function resetPassword(
  caller: Caller,
  userId: string,
  deps: AdminDeps,
): Promise<Result<TempPasswordResponse>> {
  const denied = guard(caller);
  if (denied) return denied;
  const target = deps.users.findById(userId);
  if (!target?.username) {
    return fail(404, ErrorCode.NotFound, { message: 'Esta pessoa ainda não tem usuário.' });
  }
  const password = tempPassword();
  deps.users.update(userId, { passwordHash: await hashPassword(password) });
  if (userId !== caller.user.id) deps.users.deleteAllSessions(userId);
  else deps.users.deleteAllSessions(userId, caller.token);
  deps.audit.log(caller.user.id, 'user.password', userId);
  return ok({ password });
}

/** Tira da sala (vai para a Recepção) ou do escritório (precisa entrar de novo). */
export function kick(
  caller: Caller,
  userId: string,
  input: unknown,
  deps: AdminDeps,
): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = parse(kickSchema, input);
  if ('error' in p) return p.error!;
  if (userId === caller.user.id) {
    return fail(409, ErrorCode.Forbidden, { message: 'Você não pode tirar a si mesmo.' });
  }
  const online = deps.presence.list().find((e) => e.userId === userId);
  if (!online) return fail(404, ErrorCode.NotFound, { message: 'Esta pessoa não está online.' });
  const { scope } = p.data;
  if (scope === 'room' && online.roomId === RECEPTION.id) {
    return fail(409, ErrorCode.Forbidden, {
      message: 'Já está na Recepção. Para tirar, use "tirar do escritório".',
    });
  }
  if (scope === 'office') deps.users.deleteAllSessions(userId);
  deps.moderation.emit('kick', { userId, scope, roomId: online.roomId, byName: caller.user.name });
  const roomName = deps.rooms.list().find((r) => r.id === online.roomId)?.name ?? online.roomId;
  deps.audit.log(
    caller.user.id,
    'user.kick',
    userId,
    scope === 'room' ? `da sala ${roomName}` : 'do escritório',
  );
  return done();
}

export function setInvite(caller: Caller, input: unknown, deps: AdminDeps): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = parse(inviteSchema, input);
  if ('error' in p) return p.error!;
  deps.settings.setInviteCode(p.data.inviteCode);
  deps.audit.log(caller.user.id, 'invite.change');
  return done();
}

/** Endereço do Jira Cloud (vazio desliga). */
export function setJiraSite(
  caller: Caller,
  input: unknown,
  deps: AdminDeps,
): Result<{ site: string | null }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = parse(jiraSiteSchema, input);
  if ('error' in p) return p.error!;
  if (deps.settings.jiraSiteLocked) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: 'O endereço do Jira está definido no servidor (JIRA_SITE).',
    });
  }
  const raw = p.data.site.trim();
  const site = raw ? normalizeJiraSite(raw) : null;
  if (raw && !site) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: 'Use o endereço do Jira Cloud, por exemplo suaempresa.atlassian.net.',
    });
  }
  deps.settings.setJiraSite(site);
  deps.audit.log(caller.user.id, 'jira.site', null, site ?? 'desligado');
  return ok({ site });
}

export function setRoom(
  caller: Caller,
  roomId: string,
  input: unknown,
  deps: AdminDeps,
): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = parse(roomSettingsSchema, input);
  if ('error' in p) return p.error!;
  if (!deps.rooms.setDecorLocked(roomId, p.data.decorLocked)) return fail(404, ErrorCode.NotFound);
  deps.moderation.emit('room', { roomId, decorLocked: p.data.decorLocked });
  const name = deps.rooms.list().find((r) => r.id === roomId)?.name ?? roomId;
  deps.audit.log(
    caller.user.id,
    'room.decor',
    null,
    `${name}: ${p.data.decorLocked ? 'só admins' : 'todos'}`,
  );
  return done();
}

// ---------- Cargos ----------

function cargoNameTaken(name: string, exceptId: number | undefined, deps: AdminDeps) {
  const key = name.toLocaleLowerCase('pt-BR');
  return deps.users
    .listCargos()
    .some((c) => c.id !== exceptId && c.name.toLocaleLowerCase('pt-BR') === key);
}

export function createCargo(caller: Caller, input: unknown, deps: AdminDeps): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = parse(cargoCreateSchema, input);
  if ('error' in p) return p.error!;
  if (cargoNameTaken(p.data.name, undefined, deps)) {
    return fail(409, ErrorCode.Forbidden, { message: 'Já existe um cargo com esse nome.' });
  }
  deps.users.createCargo(p.data.name, p.data.color);
  deps.audit.log(caller.user.id, 'cargo.create', null, p.data.name);
  return done();
}

export function updateCargo(
  caller: Caller,
  id: number,
  input: unknown,
  deps: AdminDeps,
): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = parse(cargoUpdateSchema, input);
  if ('error' in p) return p.error!;
  const cargo = deps.users.listCargos().find((c) => c.id === id);
  if (!cargo) return fail(404, ErrorCode.NotFound);
  if (p.data.name && cargoNameTaken(p.data.name, id, deps)) {
    return fail(409, ErrorCode.Forbidden, { message: 'Já existe um cargo com esse nome.' });
  }
  deps.users.updateCargo(id, p.data);
  deps.audit.log(
    caller.user.id,
    'cargo.update',
    null,
    p.data.name && p.data.name !== cargo.name ? `${cargo.name} → ${p.data.name}` : cargo.name,
  );
  return done();
}

export function deleteCargo(caller: Caller, id: number, deps: AdminDeps): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  const cargo = deps.users.listCargos().find((c) => c.id === id);
  if (!cargo) return fail(404, ErrorCode.NotFound);
  deps.users.deleteCargo(id);
  deps.audit.log(caller.user.id, 'cargo.delete', null, cargo.name);
  return done();
}

export function reorderCargos(
  caller: Caller,
  input: unknown,
  deps: AdminDeps,
): Result<{ ok: true }> {
  const denied = guard(caller);
  if (denied) return denied;
  const p = parse(cargoOrderSchema, input);
  if ('error' in p) return p.error!;
  const known = new Set(deps.users.listCargos().map((c) => c.id));
  if (p.data.ids.length !== known.size || !p.data.ids.every((id) => known.has(id))) {
    return fail(400, ErrorCode.InvalidPayload, { message: 'Lista de cargos desatualizada.' });
  }
  deps.users.reorderCargos(p.data.ids);
  deps.audit.log(caller.user.id, 'cargo.order');
  return done();
}

export function auditList(caller: Caller, deps: AdminDeps): Result<AuditEntry[]> {
  const denied = guard(caller);
  if (denied) return denied;
  return ok(deps.audit.list(200));
}

// ---------- Backups ----------

export function listBackups(caller: Caller, deps: AdminDeps): Result<BackupList> {
  const denied = guard(caller);
  if (denied) return denied;
  return ok({ backups: deps.backups.list(), keep: deps.backups.keep, dailyHour: BACKUP_HOUR });
}

export async function createBackup(caller: Caller, deps: AdminDeps): Promise<Result<BackupInfo>> {
  const denied = guard(caller);
  if (denied) return denied;
  const backup = await deps.backups.create();
  deps.audit.log(caller.user.id, 'backup.create', null, backup.name);
  return ok(backup);
}

/** Caminho do arquivo para baixar (só admin; registra no log). */
export function backupFile(caller: Caller, name: string, deps: AdminDeps): Result<string> {
  const denied = guard(caller);
  if (denied) return denied;
  const path = deps.backups.pathOf(name);
  if (!path) return fail(404, ErrorCode.NotFound);
  deps.audit.log(caller.user.id, 'backup.download', null, name);
  return ok(path);
}
