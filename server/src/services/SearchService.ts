import type { SearchHit } from '@office/shared';
import { and, desc, eq, or, sql, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import { chatMessages, directMessages, rooms, uploads, users } from '../db/schema.js';

/** `%termo%` com `%`, `_` e `\` escapados (o termo é procurado como texto, não como padrão). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const like = (col: SQLWrapper, pattern: string) => sql`${col} LIKE ${pattern} ESCAPE '\\'`;

/** Busca no chat das salas (que qualquer pessoa vê ao entrar) e nas DMs da própria pessoa. */
export class SearchService {
  constructor(private readonly db: Db) {}

  search(userId: string, q: string, limit: number): SearchHit[] {
    const pattern = likePattern(q);
    const roomHits = this.db
      .select({
        id: chatMessages.id,
        where: chatMessages.roomId,
        whereName: rooms.name,
        name: chatMessages.nameSnapshot,
        text: chatMessages.text,
        file: uploads.name,
        ts: chatMessages.createdAt,
      })
      .from(chatMessages)
      .innerJoin(rooms, eq(rooms.id, chatMessages.roomId))
      .leftJoin(uploads, eq(uploads.id, chatMessages.attachmentId))
      .where(
        and(
          eq(chatMessages.kind, 'text'),
          or(like(chatMessages.text, pattern), like(uploads.name, pattern)),
        ),
      )
      .orderBy(desc(chatMessages.id))
      .limit(limit)
      .all()
      .map((r): SearchHit => ({
        kind: 'room',
        ...r,
        text: hitText(r.text, r.file),
        ts: r.ts.getTime(),
      }));

    const from = alias(users, 'from_user');
    const to = alias(users, 'to_user');
    const dmHits = this.db
      .select({
        id: directMessages.id,
        fromId: directMessages.fromUserId,
        toId: directMessages.toUserId,
        fromName: from.name,
        toName: to.name,
        text: directMessages.text,
        file: uploads.name,
        ts: directMessages.createdAt,
      })
      .from(directMessages)
      .innerJoin(from, eq(from.id, directMessages.fromUserId))
      .innerJoin(to, eq(to.id, directMessages.toUserId))
      .leftJoin(uploads, eq(uploads.id, directMessages.attachmentId))
      .where(
        and(
          or(eq(directMessages.fromUserId, userId), eq(directMessages.toUserId, userId)),
          or(like(directMessages.text, pattern), like(uploads.name, pattern)),
        ),
      )
      .orderBy(desc(directMessages.id))
      .limit(limit)
      .all()
      .map((r): SearchHit => {
        const mine = r.fromId === userId;
        return {
          kind: 'dm',
          id: r.id,
          where: mine ? r.toId : r.fromId,
          whereName: mine ? r.toName : r.fromName,
          name: r.fromName,
          text: hitText(r.text, r.file),
          ts: r.ts.getTime(),
        };
      });

    return [...roomHits, ...dmHits].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
}

function hitText(text: string, file: string | null): string {
  if (!file) return text;
  return text ? `${text} 📎 ${file}` : `📎 ${file}`;
}
