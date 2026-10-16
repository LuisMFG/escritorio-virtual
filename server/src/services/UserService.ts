import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users, type UserRow } from '../db/schema.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class UserService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  findByToken(token: string | undefined): UserRow | undefined {
    if (!token) return undefined;
    return this.db
      .select()
      .from(users)
      .where(eq(users.sessionTokenHash, hashToken(token)))
      .get();
  }

  findById(id: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }

  /** Cria um usuário novo com um token aleatório (devolvido só aqui, em texto puro). */
  create(name: string, figure: string, gender: 'M' | 'F' = 'M'): { user: UserRow; token: string } {
    const token = randomBytes(24).toString('base64url');
    const now = this.now();
    const user = this.db
      .insert(users)
      .values({
        id: randomUUID(),
        name,
        figure,
        gender,
        sessionTokenHash: hashToken(token),
        createdAt: now,
        lastSeenAt: now,
      })
      .returning()
      .get();
    return { user, token };
  }

  update(id: string, changes: Partial<Pick<UserRow, 'name' | 'figure' | 'gender'>>): UserRow {
    return this.db
      .update(users)
      .set({ ...changes, lastSeenAt: this.now() })
      .where(eq(users.id, id))
      .returning()
      .get();
  }

  touch(id: string): void {
    this.db.update(users).set({ lastSeenAt: this.now() }).where(eq(users.id, id)).run();
  }
}
