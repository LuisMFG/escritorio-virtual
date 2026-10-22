import type { Client } from '@colyseus/core';
import type { UserRow } from '../../db/schema.js';
import type { ChatMessage, PollCreate, PollUpdated } from '@office/shared';
import {
  ErrorCode,
  ServerMessage,
} from '@office/shared';
import { services } from '../../services/index.js';
import type { KeyedRateLimiter } from '../../util/rateLimiter.js';

export type OfficeClient = Client<{ auth: UserRow }>;

export interface PollHost {
  roomId: string;
  clients: Iterable<OfficeClient>;
  hasPlayer(sessionId: string): boolean;
  sendError(client: OfficeClient, code: ErrorCode, message?: string): void;
  chatLimiter: KeyedRateLimiter;
  reactLimiter: KeyedRateLimiter;
}

export class PollHandler {
  constructor(private readonly host: PollHost) {}

  createPoll(client: OfficeClient, data: Required<PollCreate>, limit = true): void {
    if (!client.auth || !this.host.hasPlayer(client.sessionId)) return;
    if (limit && !this.host.chatLimiter.tryTake(client.sessionId)) {
      return this.host.sendError(client, ErrorCode.RateLimit);
    }
    const message = services().chat.add(
      this.host.roomId,
      client.auth,
      `📊 Enquete: ${data.question}`,
      client.sessionId,
      undefined,
      'poll',
    );
    const poll = services().polls.create(message.id, this.host.roomId, client.auth.id, data);
    for (const c of this.host.clients) {
      c.send(ServerMessage.Chat, {
        ...message,
        poll: services().polls.view(poll.id, c.auth?.id ?? '') ?? undefined,
      } satisfies ChatMessage);
    }
    services().achievements.bump(client.auth.id, 'chat');
  }

  broadcastPoll(pollId: number): void {
    for (const c of this.host.clients) {
      const poll = services().polls.view(pollId, c.auth?.id ?? '');
      if (poll) c.send(ServerMessage.PollUpdated, { poll } satisfies PollUpdated);
    }
  }

  withPolls(messages: ChatMessage[], viewerId: string): ChatMessage[] {
    const ids = messages.filter((m) => m.kind === 'poll').map((m) => m.id);
    const views = services().polls.forMessages(ids, viewerId);
    return messages.map((m) => (views.has(m.id) ? { ...m, poll: views.get(m.id) } : m));
  }

  handleVote(client: OfficeClient, pollId: number, option: number): void {
    const poll = services().polls.find(pollId);
    if (!client.auth || !poll || poll.roomId !== this.host.roomId) return;
    if (!this.host.reactLimiter.tryTake(client.sessionId)) {
      return this.host.sendError(client, ErrorCode.RateLimit);
    }
    const problem = services().polls.vote(pollId, client.auth.id, option);
    if (problem) return this.host.sendError(client, ErrorCode.Forbidden, problem);
    this.broadcastPoll(pollId);
  }

  handleClose(client: OfficeClient, pollId: number): void {
    const poll = services().polls.find(pollId);
    if (!client.auth || !poll || poll.roomId !== this.host.roomId) return;
    if (poll.createdBy !== client.auth.id && client.auth.role !== 'admin') {
      return this.host.sendError(
        client,
        ErrorCode.Forbidden,
        'Só quem criou (ou um admin) encerra.',
      );
    }
    services().polls.close(pollId);
    this.broadcastPoll(pollId);
  }
}
