import { API_TOKEN_MAX, type ApiTokenCreated, type ApiTokenInfo } from '@office/shared';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/client.js';
import { apiTokens } from '../db/schema.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** `lastUsedAt` só é regravado depois deste intervalo (sinal a cada minuto). */
const TOUCH_MS = 5 * 60_000;

/** Tokens pessoais das integrações. Valem só para mandar atividade, não abrem sessão. */
export class ApiTokenService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Cria e devolve o token em texto (a única vez); `null` se já tem o máximo. */
  create(userId: string, name: string): ApiTokenCreated | null {
    const count =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(apiTokens)
        .where(eq(apiTokens.userId, userId))
        .get()?.n ?? 0;
    if (count >= API_TOKEN_MAX) return null;
    const token = `esc_${randomBytes(24).toString('base64url')}`;
    const row = this.db
      .insert(apiTokens)
      .values({ userId, name, tokenHash: sha256(token), createdAt: this.now() })
      .returning()
      .get();
    return { ...toInfo(row), token };
  }

  list(userId: string): ApiTokenInfo[] {
    return this.db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).all().map(toInfo);
  }

  revoke(userId: string, id: number): boolean {
    const res = this.db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
      .run();
    return res.changes > 0;
  }

  /** Dono do token (ou `null`). */
  verify(token: string): string | null {
    if (!token.startsWith('esc_')) return null;
    const row = this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, sha256(token)))
      .get();
    if (!row) return null;
    const now = this.now();
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_MS) {
      this.db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id)).run();
    }
    return row.userId;
  }
}

function toInfo(r: typeof apiTokens.$inferSelect): ApiTokenInfo {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.getTime(),
    lastUsedAt: r.lastUsedAt?.getTime() ?? null,
  };
}
