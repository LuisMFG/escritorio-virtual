import { timingSafeEqual } from 'node:crypto';
import {
  ERROR_MESSAGES,
  ErrorCode,
  sessionRequestSchema,
  validateFigure,
  type ApiError,
  type AvatarManifest,
  type SessionResponse,
} from '@office/shared';
import type { UserRow } from '../db/schema.js';
import type { PresenceRegistry } from '../services/PresenceRegistry.js';
import type { UserService } from '../services/UserService.js';

export type SessionResult =
  | { ok: true; status: 200; body: SessionResponse }
  | { ok: false; status: 400 | 401 | 409; body: ApiError };

export interface SessionDeps {
  inviteCode: string;
  avatarManifest: AvatarManifest;
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

function toResponse(user: UserRow, token: string): SessionResponse {
  return { userId: user.id, token, name: user.name, figure: user.figure, gender: user.gender };
}

/**
 * Entrada no escritório. Com um token válido do navegador, reaproveita o usuário (o código
 * de convite não é pedido de novo); sem token, exige o código de convite e cria um usuário.
 * O visual enviado é validado contra o manifesto do avatar.
 */
export function createSession(input: unknown, deps: SessionDeps): SessionResult {
  const parsed = sessionRequestSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? ERROR_MESSAGES.INVALID_PAYLOAD;
    return fail(400, ErrorCode.InvalidPayload, { message });
  }
  const { name, inviteCode, token } = parsed.data;
  const existing = deps.users.findByToken(token);

  if (!existing && !safeEqual(inviteCode?.trim() ?? '', deps.inviteCode)) {
    return fail(401, ErrorCode.InvalidInvite);
  }
  if (deps.presence.isNameTaken(name, existing?.id)) {
    return fail(409, ErrorCode.NameInUse, {
      suggestion: deps.presence.suggestName(name, existing?.id),
    });
  }

  const gender = parsed.data.gender ?? existing?.gender ?? 'M';
  const requested = parsed.data.figure ?? existing?.figure ?? deps.avatarManifest.defaults[gender];
  const figure = validateFigure(requested, gender, deps.avatarManifest);
  if (!figure.ok) return fail(400, ErrorCode.InvalidFigure, { message: figure.error });

  if (existing) {
    const user = deps.users.update(existing.id, { name, figure: figure.figure, gender });
    return { ok: true, status: 200, body: toResponse(user, token!) };
  }
  const created = deps.users.create(name, figure.figure, gender);
  return { ok: true, status: 200, body: toResponse(created.user, created.token) };
}
