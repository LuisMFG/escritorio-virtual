import { KUDOS_TYPES, KUDOS_WALL, type Kudos, type KudosType } from '@office/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { EventEmitter } from 'node:events';
import type { Db } from '../db/client.js';
import { kudos, users } from '../db/schema.js';

const from = alias(users, 'from_user');
const to = alias(users, 'to_user');

/** Elogios entre colegas: dar, mural e contagens. */
export class KudosService {
  readonly events = new EventEmitter<{ given: [Kudos] }>();

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events.setMaxListeners(100);
  }

  give(fromUserId: string, data: { toUserId: string; type: KudosType; message: string }): Kudos {
    const row = this.db
      .insert(kudos)
      .values({ fromUserId, ...data, createdAt: this.now() })
      .returning()
      .get();
    const item = this.find(row.id)!;
    this.events.emit('given', item);
    return item;
  }

  /** Quantos a pessoa mandou nas últimas 24 h. */
  sentToday(userId: string): number {
    const since = new Date(this.now().getTime() - 86_400_000);
    return (
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(kudos)
        .where(and(eq(kudos.fromUserId, userId), gte(kudos.createdAt, since)))
        .get()?.n ?? 0
    );
  }

  /** Mural: os mais novos primeiro (de alguém, se `toUserId`). */
  wall(toUserId?: string): Kudos[] {
    const q = this.query().orderBy(desc(kudos.createdAt), desc(kudos.id)).limit(KUDOS_WALL);
    return (toUserId ? q.where(eq(kudos.toUserId, toUserId)) : q).all().map(toApi);
  }

  /** Quantos elogios a pessoa recebeu. */
  receivedCount(userId: string): number {
    return (
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(kudos)
        .where(eq(kudos.toUserId, userId))
        .get()?.n ?? 0
    );
  }

  private find(id: number): Kudos | undefined {
    const row = this.query().where(eq(kudos.id, id)).get();
    return row ? toApi(row) : undefined;
  }

  private query() {
    return this.db
      .select({
        id: kudos.id,
        type: kudos.type,
        message: kudos.message,
        fromUserId: kudos.fromUserId,
        fromName: from.name,
        toUserId: kudos.toUserId,
        toName: to.name,
        createdAt: kudos.createdAt,
      })
      .from(kudos)
      .innerJoin(from, eq(from.id, kudos.fromUserId))
      .innerJoin(to, eq(to.id, kudos.toUserId))
      .$dynamic();
  }
}

function toApi(r: {
  id: number;
  type: string;
  message: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  createdAt: Date;
}): Kudos {
  const type = (KUDOS_TYPES as readonly string[]).includes(r.type) ? (r.type as KudosType) : 'help';
  return { ...r, type, createdAt: r.createdAt.getTime() };
}
