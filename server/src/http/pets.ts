import { ErrorCode, petSchema, type PetInfo } from '@office/shared';
import type { PetService } from '../services/PetService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface PetDeps {
  pets: PetService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });

export function getMyPet(caller: Caller, deps: PetDeps): Result<{ pet: PetInfo | null }> {
  return ok({ pet: deps.pets.get(caller.user.id) });
}

export function saveMyPet(caller: Caller, input: unknown, deps: PetDeps): Result<PetInfo> {
  const p = petSchema.safeParse(input);
  if (!p.success) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: p.error.issues[0]?.message ?? 'Dados inválidos.',
    });
  }
  return ok(deps.pets.save(caller.user.id, p.data));
}

export function releaseMyPet(caller: Caller, deps: PetDeps): Result<{ ok: true }> {
  deps.pets.remove(caller.user.id);
  return ok({ ok: true as const });
}
