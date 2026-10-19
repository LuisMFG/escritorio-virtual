import {
  ErrorCode,
  LOOK_SLOTS,
  validateFigure,
  type AvatarManifest,
  type SavedLook,
} from '@office/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { userLooks } from '../db/schema.js';
import { fail, type Caller, type Result } from './auth.js';

export interface LookDeps {
  db: Db;
  avatarManifest: AvatarManifest;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });
const lookSchema = z.object({ figure: z.string().max(512), gender: z.enum(['M', 'F']) });

/** Looks salvos da pessoa (só os slots preenchidos). */
export function myLooks(caller: Caller, deps: LookDeps): Result<SavedLook[]> {
  const rows = deps.db.select().from(userLooks).where(eq(userLooks.userId, caller.user.id)).all();
  return ok(
    rows
      .map((r) => ({ slot: r.slot, figure: r.figure, gender: r.gender as 'M' | 'F' }))
      .sort((a, b) => a.slot - b.slot),
  );
}

/** Guarda (ou troca) o look de um slot; o visual é validado como no editor. */
export function saveLook(
  caller: Caller,
  slot: number,
  input: unknown,
  deps: LookDeps,
): Result<SavedLook[]> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= LOOK_SLOTS)
    return fail(404, ErrorCode.NotFound);
  const p = lookSchema.safeParse(input);
  if (!p.success) return fail(400, ErrorCode.InvalidPayload);
  const valid = validateFigure(p.data.figure, p.data.gender, deps.avatarManifest);
  if (!valid.ok) return fail(400, ErrorCode.InvalidFigure, { message: valid.error });
  const row = { figure: valid.figure, gender: p.data.gender, savedAt: new Date() };
  deps.db
    .insert(userLooks)
    .values({ userId: caller.user.id, slot, ...row })
    .onConflictDoUpdate({ target: [userLooks.userId, userLooks.slot], set: row })
    .run();
  return myLooks(caller, deps);
}

export function deleteLook(caller: Caller, slot: number, deps: LookDeps): Result<SavedLook[]> {
  deps.db
    .delete(userLooks)
    .where(and(eq(userLooks.userId, caller.user.id), eq(userLooks.slot, slot)))
    .run();
  return myLooks(caller, deps);
}
