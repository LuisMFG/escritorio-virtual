import { REACTIONS, type Reaction, type ReactionSummary } from '@office/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chatReactions, dmReactions, users } from '../db/schema.js';

type ReactionTable = typeof chatReactions | typeof dmReactions;

/** Reações de várias mensagens de uma vez: id → lista (na ordem de `REACTIONS`). */
export function summarizeReactions(
  db: Db,
  table: ReactionTable,
  messageIds: number[],
): Map<number, ReactionSummary[]> {
  const out = new Map<number, ReactionSummary[]>();
  if (messageIds.length === 0) return out;
  const rows = db
    .select({ messageId: table.messageId, emoji: table.emoji, userId: users.id, name: users.name })
    .from(table)
    .innerJoin(users, eq(table.userId, users.id))
    .where(inArray(table.messageId, messageIds))
    .orderBy(sql`${table}.rowid`)
    .all();
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    let entry = list.find((x) => x.emoji === r.emoji);
    if (!entry) {
      entry = { emoji: r.emoji as Reaction, users: [] };
      list.push(entry);
    }
    entry.users.push({ userId: r.userId, name: r.name });
    out.set(r.messageId, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
  }
  return out;
}

/** Põe a reação (ou tira, se a pessoa já tinha). Devolve as reações atuais da mensagem. */
export function toggleReaction(
  db: Db,
  table: ReactionTable,
  messageId: number,
  userId: string,
  emoji: Reaction,
): ReactionSummary[] {
  const key = and(eq(table.messageId, messageId), eq(table.userId, userId), eq(table.emoji, emoji));
  const existing = db.select().from(table).where(key).get();
  if (existing) db.delete(table).where(key).run();
  else db.insert(table).values({ messageId, userId, emoji }).run();
  return summarizeReactions(db, table, [messageId]).get(messageId) ?? [];
}
