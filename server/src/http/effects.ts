import {
  EFFECT_IDS,
  effectSchema,
  effectUnlocked,
  ErrorCode,
  type EffectId,
  type EffectsResponse,
} from '@office/shared';
import type { AchievementService } from '../services/AchievementService.js';
import type { UserService } from '../services/UserService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface EffectDeps {
  achievements: AchievementService;
  users: UserService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });

/** Efeitos de cada um: quais estão liberados e o que está em uso. */
export function myEffects(caller: Caller, deps: EffectDeps): Result<EffectsResponse> {
  const progress = deps.achievements.get(caller.user.id);
  const user = deps.users.findById(caller.user.id);
  const current = (EFFECT_IDS as readonly string[]).includes(user?.effect ?? '')
    ? (user!.effect as EffectId)
    : null;
  return ok({
    current,
    effects: EFFECT_IDS.map((id) => ({ id, unlocked: effectUnlocked(id, progress) })),
  });
}

/** Usar um efeito liberado (ou nenhum). As salas atualizam o avatar na hora. */
export function setEffect(
  caller: Caller,
  input: unknown,
  deps: EffectDeps,
): Result<EffectsResponse> {
  const p = effectSchema.safeParse(input);
  if (!p.success) return fail(400, ErrorCode.InvalidPayload, { message: 'Efeito desconhecido.' });
  const id = p.data.effect;
  if (id && !effectUnlocked(id, deps.achievements.get(caller.user.id))) {
    return fail(403, ErrorCode.Forbidden, { message: 'Esse efeito ainda não foi liberado.' });
  }
  deps.users.update(caller.user.id, { effect: id ?? '' });
  return myEffects(caller, deps);
}
