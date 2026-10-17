import { ErrorCode, showcaseSchema, type AchievementsResponse } from '@office/shared';
import type { AchievementService } from '../services/AchievementService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface AchievementDeps {
  achievements: AchievementService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });

export function myAchievements(
  caller: Caller,
  deps: AchievementDeps,
): Result<AchievementsResponse> {
  return ok(deps.achievements.get(caller.user.id));
}

/** Escolhe até 3 emblemas desbloqueados para exibir no cartão. */
export function setShowcase(
  caller: Caller,
  input: unknown,
  deps: AchievementDeps,
): Result<{ showcase: string[] }> {
  const p = showcaseSchema.safeParse(input);
  if (!p.success) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: p.error.issues[0]?.message ?? 'Dados inválidos.',
    });
  }
  const showcase = deps.achievements.setShowcase(caller.user.id, p.data.ids);
  if (!showcase) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: 'Só dá para exibir emblemas que você já conquistou.',
    });
  }
  return ok({ showcase });
}
