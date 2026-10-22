import type { Client } from '@colyseus/core';
import type { UserRow } from '../../db/schema.js';
import { ErrorCode, NOTES_PER_BOARD, ServerMessage } from '@office/shared';
import { services } from '../../services/index.js';
import type { KeyedRateLimiter } from '../../util/rateLimiter.js';

export type OfficeClient = Client<{ auth: UserRow }>;

export interface BoardHost {
  boardFurni(furniId: string): boolean;
  sendError(client: OfficeClient, code: ErrorCode, message?: string): void;
  broadcast<T>(type: string | number, message: T): void;
  boardLimiter: KeyedRateLimiter;
}

export class BoardHandler {
  constructor(private readonly host: BoardHost) {}

  handleLoad(furniId: string): unknown[] {
    return this.host.boardFurni(furniId) ? services().boards.notes(furniId) : [];
  }

  handleAdd(
    client: OfficeClient,
    msg: { furniId: string; text: string; color: 'yellow' | 'pink' | 'blue' | 'green' },
  ): void {
    if (!client.auth || !this.host.boardFurni(msg.furniId)) return;
    if (!this.host.boardLimiter.tryTake(client.sessionId)) {
      return this.host.sendError(client, ErrorCode.RateLimit);
    }
    if (services().boards.count(msg.furniId) >= NOTES_PER_BOARD) {
      return this.host.sendError(
        client,
        ErrorCode.Forbidden,
        'O mural está cheio. Tire um recado antes.',
      );
    }
    services().boards.add(msg.furniId, client.auth.id, msg.text, msg.color);
    services().achievements.unlock(client.auth.id, 'board_note');
    this.host.broadcast(ServerMessage.BoardChanged, { furniId: msg.furniId });
  }

  handleRemove(client: OfficeClient, noteId: number): void {
    const note = services().boards.find(noteId);
    if (!client.auth || !note || !this.host.boardFurni(note.furniId)) return;
    if (note.userId !== client.auth.id && client.auth.role !== 'admin') {
      return this.host.sendError(
        client,
        ErrorCode.Forbidden,
        'Só quem escreveu (ou um admin) tira o recado.',
      );
    }
    services().boards.remove(note.id);
    this.host.broadcast(ServerMessage.BoardChanged, { furniId: note.furniId });
  }
}
