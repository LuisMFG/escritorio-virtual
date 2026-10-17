import {
  apiTokenCreateSchema,
  codeShareSchema,
  ErrorCode,
  editorHeartbeatSchema,
  type ActivitySettings,
  type ApiTokenCreated,
  type CodeShare,
} from '@office/shared';
import type { ActivityService } from '../services/ActivityService.js';
import type { ApiTokenService } from '../services/ApiTokenService.js';
import type { UserService } from '../services/UserService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface ActivityDeps {
  users: UserService;
  apiTokens: ApiTokenService;
  activity: ActivityService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });
const invalid = (issues: { message: string }[]) =>
  fail(400, ErrorCode.InvalidPayload, { message: issues[0]?.message ?? 'Dados inválidos.' });

export function getSettings(caller: Caller, deps: ActivityDeps): Result<ActivitySettings> {
  return ok({
    codeShare: caller.user.codeShare as CodeShare,
    tokens: deps.apiTokens.list(caller.user.id),
  });
}

export function setCodeShare(
  caller: Caller,
  input: unknown,
  deps: ActivityDeps,
): Result<{ codeShare: CodeShare }> {
  const p = codeShareSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  deps.users.update(caller.user.id, { codeShare: p.data.codeShare });
  deps.activity.refresh(caller.user.id);
  return ok(p.data);
}

export function createToken(
  caller: Caller,
  input: unknown,
  deps: ActivityDeps,
): Result<ApiTokenCreated> {
  const p = apiTokenCreateSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  const created = deps.apiTokens.create(caller.user.id, p.data.name);
  if (!created) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: 'Você já tem o máximo de tokens. Revogue um antes de criar outro.',
    });
  }
  return ok(created);
}

export function revokeToken(caller: Caller, id: number, deps: ActivityDeps): Result<{ ok: true }> {
  if (!deps.apiTokens.revoke(caller.user.id, id)) return fail(404, ErrorCode.NotFound);
  return ok({ ok: true as const });
}

/** Sinal das extensões (VS Code, Visual Studio), autenticado pelo token pessoal, não pela sessão. */
export function editorHeartbeat(
  apiToken: string,
  input: unknown,
  deps: ActivityDeps,
): Result<{ ok: true }> {
  const userId = deps.apiTokens.verify(apiToken);
  const user = userId ? deps.users.findById(userId) : undefined;
  if (!user || user.disabled) {
    return fail(401, ErrorCode.InvalidSession, {
      message: 'Token inválido ou revogado. Gere outro no Perfil do escritório.',
    });
  }
  const p = editorHeartbeatSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  deps.activity.editor(user.id, p.data);
  return ok({ ok: true as const });
}
