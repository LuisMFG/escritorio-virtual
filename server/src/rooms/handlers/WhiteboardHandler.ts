import type { Client } from '@colyseus/core';
import type { UserRow } from '../../db/schema.js';
import type {
  WbDraft,
  WbRemovedMessage,
  WbStrokeMessage,
} from '@office/shared';
import {
  ErrorCode,
  ServerMessage,
  WB_MAX_STROKES,
  wbDraftSchema,
  wbStrokeSchema,
} from '@office/shared';
import type { z } from 'zod';
import { services } from '../../services/index.js';
import type { KeyedRateLimiter } from '../../util/rateLimiter.js';

export type OfficeClient = Client<{ auth: UserRow }>;

export interface WhiteboardHost {
  isWhiteboard(furniId: string): boolean;
  sendError(client: OfficeClient, code: ErrorCode, message?: string): void;
  broadcast<T>(type: string | number, message: T, options?: { except?: Client }): void;
  wbLimiter: KeyedRateLimiter;
  draftLimiter: KeyedRateLimiter;
}

export class WhiteboardHandler {
  constructor(private readonly host: WhiteboardHost) {}

  handleLoad(furniId: string): unknown[] {
    return this.host.isWhiteboard(furniId) ? services().whiteboards.list(furniId) : [];
  }

  handleStroke(client: OfficeClient, msg: z.infer<typeof wbStrokeSchema>): void {
    if (!client.auth || !this.host.isWhiteboard(msg.furniId)) return;
    if (!this.host.wbLimiter.tryTake(client.sessionId)) {
      return this.host.sendError(client, ErrorCode.RateLimit);
    }
    if (services().whiteboards.count(msg.furniId) >= WB_MAX_STROKES) {
      return this.host.sendError(
        client,
        ErrorCode.Forbidden,
        'O quadro está cheio. Limpe antes de continuar.',
      );
    }
    const stroke = services().whiteboards.add(msg.furniId, client.auth.id, msg.stroke);
    services().achievements.unlock(client.auth.id, 'artist');
    this.host.broadcast(ServerMessage.WbStroke, {
      furniId: msg.furniId,
      stroke,
      draftId: msg.draftId,
      sessionId: client.sessionId,
    } satisfies WbStrokeMessage);
  }

  handleDraft(client: OfficeClient, msg: z.infer<typeof wbDraftSchema>): void {
    if (!this.host.isWhiteboard(msg.furniId) || !this.host.draftLimiter.tryTake(client.sessionId)) {
      return;
    }
    this.host.broadcast(
      ServerMessage.WbDraft,
      { ...msg, sessionId: client.sessionId } satisfies WbDraft,
      { except: client },
    );
  }

  handleUndo(client: OfficeClient, furniId: string): void {
    if (!client.auth || !this.host.isWhiteboard(furniId)) return;
    if (!this.host.wbLimiter.tryTake(client.sessionId)) return;
    const id = services().whiteboards.undo(furniId, client.auth.id);
    if (id !== null) {
      this.host.broadcast(ServerMessage.WbRemoved, {
        furniId,
        ids: [id],
      } satisfies WbRemovedMessage);
    }
  }

  handleClear(client: OfficeClient, furniId: string): void {
    if (!client.auth || !this.host.isWhiteboard(furniId)) return;
    services().whiteboards.clear(furniId);
    this.host.broadcast(ServerMessage.WbCleared, { furniId });
  }
}
