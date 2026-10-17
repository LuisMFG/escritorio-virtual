import type { AuditEntry } from '@office/shared';
import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import { auditLog, users } from '../db/schema.js';

/** Registro das ações de administração e moderação (só admins leem). */
export class AuditService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  log(actorId: string, action: string, targetUserId: string | null = null, details = ''): void {
    this.db
      .insert(auditLog)
      .values({ at: this.now(), actorId, action, targetUserId, details })
      .run();
  }

  list(limit = 100): AuditEntry[] {
    const target = alias(users, 'target');
    return this.db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorName: users.name,
        action: auditLog.action,
        targetName: target.name,
        details: auditLog.details,
      })
      .from(auditLog)
      .innerJoin(users, eq(auditLog.actorId, users.id))
      .leftJoin(target, eq(auditLog.targetUserId, target.id))
      .orderBy(desc(auditLog.id))
      .limit(limit)
      .all()
      .map((r) => ({ ...r, at: r.at.getTime() }));
  }
}
