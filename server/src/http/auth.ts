import { timingSafeEqual } from 'node:crypto';
import {
  claimSchema,
  ERROR_MESSAGES,
  ErrorCode,
  loginSchema,
  passwordChangeSchema,
  profileUpdateSchema,
  registerSchema,
  validateFigure,
  type ApiError,
  type AvatarManifest,
  type SessionResponse,
  type TeamResponse,
} from '@office/shared';
import type { z } from 'zod';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/passwords.js';
import type { UserRow } from '../db/schema.js';
import type { PresenceRegistry } from '../services/PresenceRegistry.js';
import type { UserService } from '../services/UserService.js';

export type HttpStatus = 200 | 400 | 401 | 403 | 404 | 409 | 429;
export type Result<T> =
  { ok: true; status: 200; body: T } | { ok: false; status: HttpStatus; body: ApiError };

export interface AuthDeps {
  /** Código atual (o painel Admin pode trocar; o `.env` é o inicial). */
  inviteCode: () => string;
  /** `ADMIN_USERNAMES`: quem é admin sempre. Vazio = a primeira conta vira admin. */
  adminUsernames: readonly string[];
  avatarManifest: AvatarManifest;
  users: UserService;
  presence: PresenceRegistry;
}

/** Quem está fazendo a requisição (token válido do header). */
export interface Caller {
  user: UserRow;
  token: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function fail(
  status: HttpStatus,
  error: ErrorCode,
  extra: Partial<ApiError> = {},
): { ok: false; status: HttpStatus; body: ApiError } {
  return { ok: false, status, body: { error, message: ERROR_MESSAGES[error], ...extra } };
}

function ok<T>(body: T): { ok: true; status: 200; body: T } {
  return { ok: true, status: 200, body };
}

function parse<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { data: z.output<S> } | { error: Result<never> } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { data: parsed.data };
  const message = parsed.error.issues[0]?.message ?? ERROR_MESSAGES.INVALID_PAYLOAD;
  return { error: fail(400, ErrorCode.InvalidPayload, { message }) };
}

/** Papel na hora de entrar: admins do `.env` sempre; sem lista, a primeira conta. */
function roleFor(username: string, current: UserRow | undefined, deps: AuthDeps): UserRow['role'] {
  if (deps.adminUsernames.includes(username)) return 'admin';
  if (current?.role === 'admin') return 'admin';
  if (deps.adminUsernames.length === 0 && !deps.users.hasAdmin()) return 'admin';
  return 'member';
}

function nameTaken(name: string, userId: string | undefined, deps: AuthDeps) {
  if (!deps.presence.isNameTaken(name, userId)) return undefined;
  return fail(409, ErrorCode.NameInUse, { suggestion: deps.presence.suggestName(name, userId) });
}

/** Criar conta: código de convite + usuário + senha + nome exibido (+ visual). */
export async function register(input: unknown, deps: AuthDeps): Promise<Result<SessionResponse>> {
  const p = parse(registerSchema, input);
  if ('error' in p) return p.error;
  const { inviteCode, username, password, name } = p.data;
  if (!safeEqual(inviteCode.trim(), deps.inviteCode())) return fail(401, ErrorCode.InvalidInvite);
  if (deps.users.findByUsername(username)) return fail(409, ErrorCode.UsernameTaken);
  const taken = nameTaken(name, undefined, deps);
  if (taken) return taken;

  const gender = p.data.gender ?? 'M';
  const figure = validateFigure(
    p.data.figure ?? deps.avatarManifest.defaults[gender],
    gender,
    deps.avatarManifest,
  );
  if (!figure.ok) return fail(400, ErrorCode.InvalidFigure, { message: figure.error });

  const { user, token } = deps.users.create({
    name,
    figure: figure.figure,
    gender,
    username,
    passwordHash: await hashPassword(password),
    role: roleFor(username, undefined, deps),
  });
  return ok(deps.users.toSession(user, token));
}

/** Entrar com usuário e senha (em qualquer aparelho). */
export async function login(input: unknown, deps: AuthDeps): Promise<Result<SessionResponse>> {
  const p = parse(loginSchema, input);
  if ('error' in p) return p.error;
  const user = deps.users.findByUsername(p.data.username);
  // Confere mesmo sem usuário, para o tempo de resposta não revelar quem existe.
  const valid = await verifyPassword(p.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) return fail(401, ErrorCode.InvalidCredentials);
  if (user.disabled) return fail(403, ErrorCode.AccountDisabled);
  const role = roleFor(user.username!, user, deps);
  const current = role === user.role ? user : deps.users.update(user.id, { role });
  return ok(deps.users.toSession(current, deps.users.createSession(user.id)));
}

/** Volta com o token salvo no navegador (sem tela de entrada). */
export function me(caller: Caller, deps: AuthDeps): Result<SessionResponse> {
  deps.users.touchSession(caller.token);
  return ok(deps.users.toSession(caller.user, caller.token));
}

/** Conta antiga (só token) escolhe usuário e senha. */
export async function claim(
  caller: Caller,
  input: unknown,
  deps: AuthDeps,
): Promise<Result<SessionResponse>> {
  if (caller.user.username) return fail(409, ErrorCode.AccountExists);
  const p = parse(claimSchema, input);
  if ('error' in p) return p.error;
  if (deps.users.findByUsername(p.data.username)) return fail(409, ErrorCode.UsernameTaken);
  const user = deps.users.update(caller.user.id, {
    username: p.data.username,
    passwordHash: await hashPassword(p.data.password),
    role: roleFor(p.data.username, caller.user, deps),
  });
  return ok(deps.users.toSession(user, caller.token));
}

/** Nome exibido, bio e aniversário. O cargo só um admin muda. */
export function updateProfile(
  caller: Caller,
  input: unknown,
  deps: AuthDeps,
): Result<SessionResponse> {
  const p = parse(profileUpdateSchema, input);
  if ('error' in p) return p.error;
  const { name, bio, birthday } = p.data;
  if (name !== undefined) {
    const taken = nameTaken(name, caller.user.id, deps);
    if (taken) return taken;
  }
  const user = deps.users.update(caller.user.id, {
    ...(name !== undefined && { name }),
    ...(bio !== undefined && { bio }),
    ...(birthday !== undefined && { birthday }),
  });
  return ok(deps.users.toSession(user, caller.token));
}

/** Troca a senha e encerra as sessões dos outros aparelhos. */
export async function changePassword(
  caller: Caller,
  input: unknown,
  deps: AuthDeps,
): Promise<Result<{ ok: true }>> {
  const p = parse(passwordChangeSchema, input);
  if ('error' in p) return p.error;
  if (!(await verifyPassword(p.data.current, caller.user.passwordHash))) {
    return fail(403, ErrorCode.WrongPassword);
  }
  deps.users.update(caller.user.id, { passwordHash: await hashPassword(p.data.next) });
  deps.users.deleteAllSessions(caller.user.id, caller.token);
  return ok({ ok: true as const });
}

export function logout(caller: Caller, all: boolean, deps: AuthDeps): Result<{ ok: true }> {
  if (all) deps.users.deleteAllSessions(caller.user.id);
  else deps.users.deleteSession(caller.token);
  return ok({ ok: true as const });
}

/** Aba Equipe: todo mundo, online ou não, e a lista de cargos. */
export function team(deps: AuthDeps): Result<TeamResponse> {
  const online = new Map(deps.presence.list().map((e) => [e.userId, e.roomId]));
  const cargos = deps.users.listCargos();
  const byId = new Map(cargos.map((c) => [c.id, c]));
  return ok({
    cargos,
    members: deps.users.list().map((u) => ({
      userId: u.id,
      username: u.username,
      name: u.name,
      figure: u.figure,
      role: u.role,
      cargo: u.cargoId === null ? null : (byId.get(u.cargoId) ?? null),
      bio: u.bio,
      birthday: u.birthday,
      lastSeenAt: u.lastSeenAt.getTime(),
      roomId: online.get(u.id) ?? null,
    })),
  });
}
