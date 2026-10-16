import { CHAT_HISTORY_ON_JOIN, CHAT_KEEP_PER_ROOM, type ChatMessage } from '@office/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chatMessages, type ChatMessageRow, type UserRow } from '../db/schema.js';

/** Histórico de chat por sala no SQLite (guarda só as últimas `CHAT_KEEP_PER_ROOM`). */
export class ChatService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Grava a mensagem (texto já validado/normalizado) e apaga as mais antigas da sala. */
  add(
    roomId: string,
    user: Pick<UserRow, 'id' | 'name'>,
    text: string,
    sessionId = '',
  ): ChatMessage {
    const row = this.db
      .insert(chatMessages)
      .values({ roomId, userId: user.id, nameSnapshot: user.name, text, createdAt: this.now() })
      .returning()
      .get();
    this.prune(roomId);
    return toMessage(row, sessionId);
  }

  /** Últimas mensagens da sala, da mais antiga para a mais nova. */
  recent(roomId: string, limit = CHAT_HISTORY_ON_JOIN): ChatMessage[] {
    return this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.roomId, roomId))
      .orderBy(desc(chatMessages.id))
      .limit(limit)
      .all()
      .reverse()
      .map((row) => toMessage(row, ''));
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

function toMessage(row: ChatMessageRow, sessionId: string): ChatMessage {
  return {
    id: row.id,
    roomId: row.roomId,
    userId: row.userId,
    sessionId,
    name: row.nameSnapshot,
    text: row.text,
    ts: row.createdAt.getTime(),
  };
}
