import { ErrorCode, KUDOS_PER_DAY, kudosCreateSchema, type Kudos } from '@office/shared';
import type { AchievementService } from '../services/AchievementService.js';
import type { KudosService } from '../services/KudosService.js';
import type { UserService } from '../services/UserService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface KudosDeps {
  kudos: KudosService;
  users: UserService;
  achievements: AchievementService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });

export function giveKudos(caller: Caller, input: unknown, deps: KudosDeps): Result<Kudos> {
  const p = kudosCreateSchema.safeParse(input);
  if (!p.success) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: p.error.issues[0]?.message ?? 'Dados inválidos.',
    });
  }
  if (p.data.toUserId === caller.user.id) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: 'Elogie um colega (não dá para se elogiar).',
    });
  }
  const target = deps.users.findById(p.data.toUserId);
  if (!target || target.disabled) return fail(404, ErrorCode.NotFound);
  if (deps.kudos.sentToday(caller.user.id) >= KUDOS_PER_DAY) {
    return fail(429, ErrorCode.RateLimit, {
      message: `Você já mandou ${KUDOS_PER_DAY} elogios hoje. Amanhã tem mais!`,
    });
  }
  const k = deps.kudos.give(caller.user.id, p.data);
  deps.achievements.bump(caller.user.id, 'kudosGiven');
  deps.achievements.bump(target.id, 'kudosReceived');
  return ok(k);
}

/** Mural (de todos, ou só os recebidos por alguém com `?para=`). */
export function kudosWall(
  _caller: Caller,
  query: { para?: unknown },
  deps: KudosDeps,
): Result<Kudos[]> {
  return ok(deps.kudos.wall(typeof query.para === 'string' ? query.para : undefined));
}
