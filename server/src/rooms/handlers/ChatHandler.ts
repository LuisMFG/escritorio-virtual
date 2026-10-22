import { randomInt } from 'node:crypto';
import type { Client } from '@colyseus/core';
import type { UserRow } from '../../db/schema.js';
import type {
  ChatKind,
  ChatDeletedMessage,
  PetInfo,
  Player,
  ReactionsUpdate,
  ReactRequest,
  PetCommand,
} from '@office/shared';
import {
  ErrorCode,
  ServerMessage,
  parsePetCommand,
  parsePollCommand,
  parseQuickCommand,
  petCommandText,
  pollCreateSchema,
  quickCommandText,
} from '@office/shared';
import { services } from '../../services/index.js';
import type { KeyedRateLimiter } from '../../util/rateLimiter.js';
import type { PollHandler } from './PollHandler.js';

export type OfficeClient = Client<{ auth: UserRow }>;

export interface ChatHost {
  roomId: string;
  getPlayer(sessionId: string): Player | undefined;
  getPet(userId: string): PetInfo | undefined;
  commandPet(userId: string, cmd: PetCommand): void;
  sendError(client: OfficeClient, code: ErrorCode, message?: string): void;
  broadcast<T>(type: string | number, message: T): void;
  chatLimiter: KeyedRateLimiter;
  reactLimiter: KeyedRateLimiter;
  pollHandler: PollHandler;
}

export class ChatHandler {
  constructor(private readonly host: ChatHost) {}

  handleChat(
    client: OfficeClient,
    msg: { text: string; replyToId?: number; attachmentId?: string },
  ): void {
    const player = this.host.getPlayer(client.sessionId);
    if (!client.auth || !player) return;
    if (!this.host.chatLimiter.tryTake(client.sessionId)) {
      return this.host.sendError(client, ErrorCode.RateLimit);
    }
    // Anexo: só um arquivo que a própria pessoa enviou.
    if (msg.attachmentId && !services().uploads.owns(msg.attachmentId, client.auth.id)) {
      return this.host.sendError(client, ErrorCode.InvalidChat, 'Anexo não encontrado.');
    }
    // `/enquete Pergunta? | opção 1 | opção 2`: vira enquete (o limite de mensagens já foi gasto).
    const poll = parsePollCommand(msg.text);
    if (poll) {
      if ('error' in poll) return this.host.sendError(client, ErrorCode.InvalidChat, poll.error);
      const parsed = pollCreateSchema.safeParse(poll);
      if (!parsed.success) {
        return this.host.sendError(client, ErrorCode.InvalidChat, parsed.error.issues[0]?.message);
      }
      return this.host.pollHandler.createPoll(client, parsed.data, false);
    }
    // `/senta`, `/deita`, `/vem`: comando para o próprio pet (aparece no chat como fala do dono).
    const petCmd = parsePetCommand(msg.text);
    let text = msg.text;
    if (petCmd) {
      const pet = this.host.getPet(client.auth.id);
      if (!pet) {
        return this.host.sendError(
          client,
          ErrorCode.Forbidden,
          'Você não tem um pet. Adote um no seu Perfil (👤).',
        );
      }
      text = petCommandText(petCmd, pet.name);
      this.host.commandPet(client.auth.id, petCmd);
    }
    // `/dado` e `/moeda`: o servidor sorteia, para ninguém escolher o resultado.
    const cmd = parseQuickCommand(msg.text);
    let kind: ChatKind = 'text';
    if (cmd) {
      const roll = cmd === 'dice' ? randomInt(1, 7) : randomInt(0, 2);
      text = quickCommandText(cmd, roll);
      kind = cmd;
      if (cmd === 'dice' && roll === 6) services().achievements.unlock(client.auth.id, 'lucky');
    } else {
      services().achievements.bump(client.auth.id, 'chat');
    }
    // Só quem está nesta sala recebe (cada sala física é uma instância separada).
    const message = services().chat.add(
      this.host.roomId,
      client.auth,
      text,
      client.sessionId,
      cmd ? undefined : msg.replyToId,
      kind,
      cmd || petCmd ? null : (msg.attachmentId ?? null),
    );
    this.host.broadcast(ServerMessage.Chat, message);
    player.typing = false;
  }

  handleReact(client: OfficeClient, id: number, emoji: ReactRequest['emoji']): void {
    const user = client.auth;
    const msg = services().chat.find(id);
    if (!user || !msg || msg.roomId !== this.host.roomId) return;
    if (!this.host.reactLimiter.tryTake(client.sessionId)) {
      return this.host.sendError(client, ErrorCode.RateLimit);
    }
    const reactions = services().chat.react(id, user.id, emoji);
    services().achievements.bump(user.id, 'reactions');
    this.host.broadcast(ServerMessage.ChatReactions, { id, reactions } satisfies ReactionsUpdate);
  }

  handleChatDelete(client: OfficeClient, id: number): void {
    const user = client.auth;
    const msg = services().chat.find(id);
    if (!user || !msg || msg.roomId !== this.host.roomId) return;
    const own = msg.userId === user.id;
    if (!own && user.role !== 'admin') {
      return this.host.sendError(client, ErrorCode.Forbidden);
    }
    services().chat.remove(id);
    this.host.broadcast(ServerMessage.ChatDeleted, { id } satisfies ChatDeletedMessage);
    if (!own) {
      const preview = msg.text.length > 60 ? `${msg.text.slice(0, 60)}…` : msg.text;
      services().audit.log(user.id, 'chat.delete', msg.userId, `“${preview}”`);
    }
  }
}
