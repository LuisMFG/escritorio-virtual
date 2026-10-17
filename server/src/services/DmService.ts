import {
  DM_KEEP_PER_PAIR,
  DM_PAGE_SIZE,
  type DirectMessage,
  type DmConversation,
} from '@office/shared';
import { and, desc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { directMessages, users, type DirectMessageRow } from '../db/schema.js';

/** Mensagens privadas entre duas pessoas (SQLite). */
export class DmService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  send(fromUserId: string, toUserId: string, text: string): DirectMessage {
    const row = this.db
      .insert(directMessages)
      .values({ fromUserId, toUserId, text, createdAt: this.now() })
      .returning()
      .get();
    this.prune(fromUserId, toUserId);
    return toMessage(row);
  }

  /** Mensagens da conversa, da mais antiga para a mais nova (página antes de `beforeId`). */
  history(a: string, b: string, beforeId?: number, limit = DM_PAGE_SIZE): DirectMessage[] {
    return this.db
      .select()
      .from(directMessages)
      .where(and(pair(a, b), beforeId ? lt(directMessages.id, beforeId) : undefined))
      .orderBy(desc(directMessages.id))
      .limit(limit)
      .all()
      .reverse()
      .map(toMessage);
  }

  /** Conversas de uma pessoa, da mais recente para a mais antiga, com não lidas. */
  conversations(userId: string): DmConversation[] {
    const rows = this.db
      .select()
      .from(directMessages)
      .where(or(eq(directMessages.fromUserId, userId), eq(directMessages.toUserId, userId)))
      .orderBy(desc(directMessages.id))
      .limit(5000)
      .all();
    const byOther = new Map<string, { last: DirectMessageRow; unread: number }>();
    for (const r of rows) {
      const other = r.fromUserId === userId ? r.toUserId : r.fromUserId;
      const entry = byOther.get(other) ?? { last: r, unread: 0 };
      if (r.toUserId === userId && r.readAt === null) entry.unread++;
      byOther.set(other, entry);
    }
    if (byOther.size === 0) return [];
    const people = new Map(
      this.db
        .select({ id: users.id, name: users.name, figure: users.figure })
        .from(users)
        .where(inArray(users.id, [...byOther.keys()]))
        .all()
        .map((u) => [u.id, u]),
    );
    return [...byOther.entries()].flatMap(([other, { last, unread }]) => {
      const person = people.get(other);
      if (!person) return [];
      return [
        {
          userId: other,
          name: person.name,
          figure: person.figure,
          lastText: last.text,
          lastFromMe: last.fromUserId === userId,
          lastAt: last.createdAt.getTime(),
          unread,
        },
      ];
    });
  }

  /** Total de não lidas (para o contador ao entrar). */
  unreadCount(userId: string): number {
    return this.db
      .select({ id: directMessages.id })
      .from(directMessages)
      .where(and(eq(directMessages.toUserId, userId), isNull(directMessages.readAt)))
      .all().length;
  }

  /**
   * `reader` abriu a conversa com `other`: marca como lidas as que `other` mandou.
   * Devolve o id da última marcada (para o aviso de "visto"), ou `null` se não havia nenhuma.
   */
  markRead(reader: string, other: string): number | null {
    const unread = and(
      eq(directMessages.fromUserId, other),
      eq(directMessages.toUserId, reader),
      isNull(directMessages.readAt),
    );
    const last = this.db
      .select({ id: directMessages.id })
      .from(directMessages)
      .where(unread)
      .orderBy(desc(directMessages.id))
      .get();
    if (!last) return null;
    this.db
      .update(directMessages)
      .set({ readAt: this.now() })
      .where(and(unread, lte(directMessages.id, last.id)))
      .run();
    return last.id;
  }

  private prune(a: string, b: string): void {
    const cutoff = this.db
      .select({ id: directMessages.id })
      .from(directMessages)
      .where(pair(a, b))
      .orderBy(desc(directMessages.id))
      .limit(1)
      .offset(DM_KEEP_PER_PAIR - 1)
      .get();
    if (cutoff) {
      this.db
        .delete(directMessages)
        .where(and(pair(a, b), lt(directMessages.id, cutoff.id)))
        .run();
    }
  }
}

function pair(a: string, b: string) {
  return or(
    and(eq(directMessages.fromUserId, a), eq(directMessages.toUserId, b)),
    and(eq(directMessages.fromUserId, b), eq(directMessages.toUserId, a)),
  );
}

function toMessage(r: DirectMessageRow): DirectMessage {
  return {
    id: r.id,
    fromUserId: r.fromUserId,
    toUserId: r.toUserId,
    text: r.text,
    ts: r.createdAt.getTime(),
    readAt: r.readAt?.getTime() ?? null,
  };
}
