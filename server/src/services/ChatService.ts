import {
  CHAT_HISTORY_ON_JOIN,
  CHAT_KEEP_PER_ROOM,
  CHAT_KINDS,
  type ChatKind,
  replyPreviewText,
  type ChatMessage,
  type Reaction,
  type ReactionSummary,
  type ReplyPreview,
} from '@office/shared';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chatMessages, chatReactions, type ChatMessageRow, type UserRow } from '../db/schema.js';
import { summarizeReactions, toggleReaction } from './reactions.js';
import { attachmentsOf } from './UploadService.js';

/** Histórico de chat por sala no SQLite (guarda só as últimas `CHAT_KEEP_PER_ROOM`). */
export class ChatService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Grava a mensagem (texto já validado/normalizado) e apaga as mais antigas da sala.
   * `replyToId` só vale se a mensagem respondida for da mesma sala.
   */
  add(
    roomId: string,
    user: Pick<UserRow, 'id' | 'name'>,
    text: string,
    sessionId = '',
    replyToId?: number,
    kind: ChatKind = 'text',
    attachmentId: string | null = null,
  ): ChatMessage {
    const reply = replyToId ? this.find(replyToId) : undefined;
    const row = this.db
      .insert(chatMessages)
      .values({
        roomId,
        userId: user.id,
        nameSnapshot: user.name,
        text,
        kind,
        attachmentId,
        replyToId: reply?.roomId === roomId ? reply.id : null,
        createdAt: this.now(),
      })
      .returning()
      .get();
    this.prune(roomId);
    return this.withExtras([row], sessionId)[0]!;
  }

  find(id: number): ChatMessageRow | undefined {
    return this.db.select().from(chatMessages).where(eq(chatMessages.id, id)).get();
  }

  remove(id: number): void {
    this.db.delete(chatMessages).where(eq(chatMessages.id, id)).run();
  }

  /** Últimas mensagens da sala, da mais antiga para a mais nova. */
  recent(roomId: string, limit = CHAT_HISTORY_ON_JOIN): ChatMessage[] {
    const rows = this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.roomId, roomId))
      .orderBy(desc(chatMessages.id))
      .limit(limit)
      .all()
      .reverse();
    return this.withExtras(rows, '');
  }

  react(messageId: number, userId: string, emoji: Reaction): ReactionSummary[] {
    return toggleReaction(this.db, chatReactions, messageId, userId, emoji);
  }

  /** Junta reações e o trecho da mensagem respondida. */
  private withExtras(rows: ChatMessageRow[], sessionId: string): ChatMessage[] {
    const reactions = summarizeReactions(
      this.db,
      chatReactions,
      rows.map((r) => r.id),
    );
    const replyIds = rows.flatMap((r) => (r.replyToId ? [r.replyToId] : []));
    const replies = new Map<number, ReplyPreview>(
      replyIds.length === 0
        ? []
        : this.db
            .select()
            .from(chatMessages)
            .where(inArray(chatMessages.id, replyIds))
            .all()
            .map((r) => [
              r.id,
              { id: r.id, userId: r.userId, name: r.nameSnapshot, text: replyPreviewText(r.text) },
            ]),
    );
    const files = attachmentsOf(
      this.db,
      rows.map((r) => r.attachmentId),
    );
    return rows.map((row) => ({
      id: row.id,
      roomId: row.roomId,
      userId: row.userId,
      sessionId,
      name: row.nameSnapshot,
      text: row.text,
      kind: (CHAT_KINDS as readonly string[]).includes(row.kind) ? (row.kind as ChatKind) : 'text',
      ts: row.createdAt.getTime(),
      reactions: reactions.get(row.id) ?? [],
      replyTo: (row.replyToId && replies.get(row.replyToId)) || null,
      attachment: (row.attachmentId && files.get(row.attachmentId)) || null,
    }));
  }

  private prune(roomId: string): void {
    const cutoff = this.db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.roomId, roomId))
      .orderBy(desc(chatMessages.id))
      .limit(1)
      .offset(CHAT_KEEP_PER_ROOM - 1)
      .get();
    if (cutoff) {
      this.db
        .delete(chatMessages)
        .where(and(eq(chatMessages.roomId, roomId), lt(chatMessages.id, cutoff.id)))
        .run();
    }
  }
}
