import { timingSafeEqual } from 'node:crypto';
import {
  ERROR_MESSAGES,
  ErrorCode,
  sessionRequestSchema,
  type ApiError,
  type SessionResponse,
} from '@office/shared';
import type { PresenceRegistry } from '../services/PresenceRegistry.js';
import type { UserService } from '../services/UserService.js';

export type SessionResult =
  | { ok: true; status: 200; body: SessionResponse }
  | { ok: false; status: 400 | 401 | 409; body: ApiError };

export interface SessionDeps {
  inviteCode: string;
  defaultFigure: string;
  users: UserService;
  presence: PresenceRegistry;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function fail(
  status: 400 | 401 | 409,
  error: ErrorCode,
  extra: Partial<ApiError> = {},
): SessionResult {
  return { ok: false, status, body: { error, message: ERROR_MESSAGES[error], ...extra } };
}

/**
 * Entrada no escritório. Com um token válido do navegador, reaproveita o usuário (o código
 * de convite não é pedido de novo); sem token, exige o código de convite e cria um usuário.
 */
export function createSession(input: unknown, deps: SessionDeps): SessionResult {
  const parsed = sessionRequestSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? ERROR_MESSAGES.INVALID_PAYLOAD;
    return fail(400, ErrorCode.InvalidPayload, { message });
  }
  const { name, inviteCode, figure, token } = parsed.data;
  const existing = deps.users.findByToken(token);

  if (!existing && !safeEqual(inviteCode?.trim() ?? '', deps.inviteCode)) {
    return fail(401, ErrorCode.InvalidInvite);
  }
  if (deps.presence.isNameTaken(name, existing?.id)) {
    return fail(409, ErrorCode.NameInUse, {
      suggestion: deps.presence.suggestName(name, existing?.id),
    });
  }

  if (existing) {
    const user = deps.users.update(existing.id, { name, figure: figure ?? existing.figure });
    return {
      ok: true,
      status: 200,
      body: { userId: user.id, token: token!, name: user.name, figure: user.figure },
    };
  }
  const created = deps.users.create(name, figure ?? deps.defaultFigure);
  return {
    ok: true,
    status: 200,
    body: {
      userId: created.user.id,
      token: created.token,
      name: created.user.name,
      figure: created.user.figure,
    },
  };
}
