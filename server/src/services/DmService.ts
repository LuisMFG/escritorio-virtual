import {
  DM_KEEP_PER_PAIR,
  DM_PAGE_SIZE,
  replyPreviewText,
  type DirectMessage,
  type DmConversation,
  type Reaction,
  type ReactionSummary,
  type ReplyPreview,
} from '@office/shared';
import { and, desc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { directMessages, dmReactions, users, type DirectMessageRow } from '../db/schema.js';
import { summarizeReactions, toggleReaction } from './reactions.js';
import { attachmentsOf } from './UploadService.js';

/** Mensagens privadas entre duas pessoas (SQLite). */
export class DmService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** `replyToId` só vale se a mensagem respondida for desta conversa. */
  send(
    fromUserId: string,
    toUserId: string,
    text: string,
    replyToId?: number,
    attachmentId: string | null = null,
  ): DirectMessage {
    const reply = replyToId ? this.find(replyToId) : undefined;
    const inPair =
      reply &&
      [reply.fromUserId, reply.toUserId].sort().join() === [fromUserId, toUserId].sort().join();
    const row = this.db
      .insert(directMessages)
      .values({
        fromUserId,
        toUserId,
        text,
        attachmentId,
        replyToId: inPair ? reply.id : null,
        createdAt: this.now(),
      })
      .returning()
      .get();
    this.prune(fromUserId, toUserId);
    return this.withExtras([row])[0]!;
  }

  find(id: number): DirectMessageRow | undefined {
    return this.db.select().from(directMessages).where(eq(directMessages.id, id)).get();
  }

  /** Reage a uma DM; só quem participa da conversa. `null` = não pode. */
  react(
    messageId: number,
    userId: string,
    emoji: Reaction,
  ): { message: DirectMessageRow; reactions: ReactionSummary[] } | null {
    const message = this.find(messageId);
    if (!message || (message.fromUserId !== userId && message.toUserId !== userId)) return null;
    return { message, reactions: toggleReaction(this.db, dmReactions, messageId, userId, emoji) };
  }

  /** Mensagens da conversa, da mais antiga para a mais nova (página antes de `beforeId`). */
  history(a: string, b: string, beforeId?: number, limit = DM_PAGE_SIZE): DirectMessage[] {
    const rows = this.db
      .select()
      .from(directMessages)
      .where(and(pair(a, b), beforeId ? lt(directMessages.id, beforeId) : undefined))
      .orderBy(desc(directMessages.id))
      .limit(limit)
      .all()
      .reverse();
    return this.withExtras(rows);
  }

  private withExtras(rows: DirectMessageRow[]): DirectMessage[] {
    const reactions = summarizeReactions(
      this.db,
      dmReactions,
      rows.map((r) => r.id),
    );
    const replyIds = rows.flatMap((r) => (r.replyToId ? [r.replyToId] : []));
    const replyRows =
      replyIds.length === 0
        ? []
        : this.db
            .select({ m: directMessages, name: users.name })
            .from(directMessages)
            .innerJoin(users, eq(directMessages.fromUserId, users.id))
            .where(inArray(directMessages.id, replyIds))
            .all();
    const replies = new Map<number, ReplyPreview>(
      replyRows.map(({ m, name }) => [
        m.id,
        { id: m.id, userId: m.fromUserId, name, text: replyPreviewText(m.text) },
      ]),
    );
    const files = attachmentsOf(
      this.db,
      rows.map((r) => r.attachmentId),
    );
    return rows.map((r) => ({
      ...toMessage(r),
      reactions: reactions.get(r.id) ?? [],
      replyTo: (r.replyToId && replies.get(r.replyToId)) || null,
      attachment: (r.attachmentId && files.get(r.attachmentId)) || null,
    }));
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
          lastText: last.text || (last.attachmentId ? '📎 Anexo' : ''),
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

function toMessage(r: DirectMessageRow): Omit<DirectMessage, 'reactions' | 'replyTo'> {
  return {
    id: r.id,
    fromUserId: r.fromUserId,
    toUserId: r.toUserId,
    text: r.text,
    ts: r.createdAt.getTime(),
    readAt: r.readAt?.getTime() ?? null,
  };
}
