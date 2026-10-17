import { CloseCode, Room, ServerError, validate, type Client } from '@colyseus/core';
import {
  dmHistorySchema,
  dmReadSchema,
  dmSendSchema,
  reactSchema,
  type ReactionsUpdate,
  ERROR_MESSAGES,
  ErrorCode,
  LobbyClientMessage,
  LobbyServerMessage,
  LobbyState,
  OnlinePerson,
  RoomEntry,
  MeetingMessage,
  type DirectMessage,
  type Meeting,
  type MeetingNotice,
  type DmReadReceipt,
  type ErrorMessage,
} from '@office/shared';
import { z } from 'zod';
import type { UserRow } from '../db/schema.js';
import { services, type ModerationEvents } from '../services/index.js';
import { KeyedRateLimiter } from '../util/rateLimiter.js';

type LobbyClient = Client<{ auth: UserRow }>;

const RECONNECT_SECONDS = 30;
const lobbyJoinSchema = z.object({ token: z.string().min(1).max(200) });

/**
 * Canal global: todo mundo conectado fica aqui, em qualquer sala física. Leva as mensagens
 * privadas (DMs) e a presença ao vivo (`state.people`: quem está online, onde e o status).
 */
export class LobbyRoom extends Room<{ state: LobbyState; client: LobbyClient }> {
  override maxClients = 200;
  override maxMessagesPerSecond = 20;

  /** DMs: 5 seguidas, depois 1 por segundo. */
  private readonly dmLimiter = new KeyedRateLimiter(5, 1);
  private readonly reactLimiter = new KeyedRateLimiter(10, 3);

  override messages = {
    [LobbyClientMessage.DmSend]: validate(dmSendSchema, (client, msg) =>
      this.handleSend(client as LobbyClient, msg.toUserId, msg.text, msg.replyToId),
    ),
    [LobbyClientMessage.DmReact]: validate(reactSchema, (client, msg) => {
      const me = (client as LobbyClient).auth;
      if (!me) return;
      if (!this.reactLimiter.tryTake(client.sessionId)) {
        return this.sendError(client as LobbyClient, ErrorCode.RateLimit);
      }
      const res = services().dms.react(msg.id, me.id, msg.emoji);
      if (!res) return;
      const update: ReactionsUpdate = { id: msg.id, reactions: res.reactions };
      const targets = new Set([
        ...this.clientsOf(res.message.fromUserId),
        ...this.clientsOf(res.message.toUserId),
      ]);
      for (const c of targets) c.send(LobbyServerMessage.DmReactions, update);
    }),
    [LobbyClientMessage.DmConversations]: (client: Client) => {
      const me = (client as LobbyClient).auth;
      return me ? services().dms.conversations(me.id) : [];
    },
    [LobbyClientMessage.DmHistory]: (client: Client, input: unknown) => {
      const p = dmHistorySchema.safeParse(input);
      const me = (client as LobbyClient).auth;
      if (!p.success || !me) return [];
      return services().dms.history(me.id, p.data.withUserId, p.data.beforeId);
    },
    [LobbyClientMessage.DmRead]: validate(dmReadSchema, (client, msg) =>
      this.handleRead(client as LobbyClient, msg.withUserId),
    ),
  };

  private readonly syncPeople = (): void => {
    // Uma entrada por pessoa (a conexão mais recente vence se houver duas abas).
    const latest = new Map<string, { name: string; roomId: string; status: string }>();
    for (const e of services().presence.list()) {
      latest.set(e.userId, { name: e.name, roomId: e.roomId, status: e.status ?? 'available' });
    }
    for (const id of [...this.state.people.keys()]) {
      if (!latest.has(id)) this.state.people.delete(id);
    }
    for (const [userId, info] of latest) {
      const person = this.state.people.get(userId) ?? new OnlinePerson();
      Object.assign(person, { userId, ...info });
      if (!this.state.people.has(userId)) this.state.people.set(userId, person);
    }
  };

  /** Lista de salas (nomes e ordem) para todos. */
  private readonly syncRooms = (): void => {
    const list = services().rooms.list();
    const busy = services().meetings.currentByRoom();
    const ids = new Set(list.map((r) => r.id));
    for (const id of [...this.state.rooms.keys()]) if (!ids.has(id)) this.state.rooms.delete(id);
    list.forEach((r, sort) => {
      const entry = this.state.rooms.get(r.id) ?? new RoomEntry();
      Object.assign(entry, { id: r.id, name: r.name, sort, meeting: busy.get(r.id) ?? '' });
      if (!this.state.rooms.has(r.id)) this.state.rooms.set(r.id, entry);
    });
  };

  // ---------- Agenda ----------

  private readonly onMeetingsChanged = (): void => {
    this.broadcast(MeetingMessage.Changed, {});
  };

  private readonly onInvited = (meeting: Meeting, userIds: string[]): void => {
    for (const id of userIds) {
      for (const c of this.clientsOf(id))
        c.send(MeetingMessage.Invited, { meeting } satisfies MeetingNotice);
    }
  };

  private readonly onReminder = (meeting: Meeting): void => {
    for (const a of meeting.attendees) {
      if (a.response === 'no') continue;
      for (const c of this.clientsOf(a.userId)) {
        c.send(MeetingMessage.Reminder, { meeting } satisfies MeetingNotice);
      }
    }
  };

  private readonly onAutoDm = (msg: DirectMessage): void => {
    const targets = new Set([...this.clientsOf(msg.fromUserId), ...this.clientsOf(msg.toUserId)]);
    for (const c of targets) c.send(LobbyServerMessage.DmMessage, msg);
  };

  /** Tirado do escritório (ou conta desativada): o canal global também fecha. */
  private readonly onKick = ({ userId, scope }: ModerationEvents['kick'][0]): void => {
    if (scope !== 'office') return;
    for (const c of this.clients) if (c.auth?.id === userId) c.leave(CloseCode.CONSENTED);
  };

  override onCreate(): void {
    this.state = new LobbyState();
    this.syncPeople();
    this.syncRooms();
    services().presence.events.on('changed', this.syncPeople);
    services().moderation.on('rooms', this.syncRooms);
    const ev = services().meetings.events;
    ev.on('changed', this.onMeetingsChanged);
    ev.on('invited', this.onInvited);
    ev.on('reminder', this.onReminder);
    ev.on('dm', this.onAutoDm);
    ev.on('tick', this.syncRooms);
    services().moderation.on('kick', this.onKick);
  }

  override onDispose(): void {
    services().presence.events.off('changed', this.syncPeople);
    services().moderation.off('rooms', this.syncRooms);
    const ev = services().meetings.events;
    ev.off('changed', this.onMeetingsChanged);
    ev.off('invited', this.onInvited);
    ev.off('reminder', this.onReminder);
    ev.off('dm', this.onAutoDm);
    ev.off('tick', this.syncRooms);
    services().moderation.off('kick', this.onKick);
  }

  override onAuth(_client: Client, options: unknown): UserRow {
    const parsed = lobbyJoinSchema.safeParse(options);
    const user = parsed.success ? services().users.findByToken(parsed.data.token) : undefined;
    if (!user) throw new ServerError(401, ERROR_MESSAGES.INVALID_SESSION);
    return user;
  }

  override onDrop(client: LobbyClient): void {
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => undefined);
  }

  override onLeave(client: LobbyClient): void {
    this.dmLimiter.delete(client.sessionId);
    this.reactLimiter.delete(client.sessionId);
  }

  /** Todas as conexões (abas/aparelhos) de uma pessoa. */
  private clientsOf(userId: string): LobbyClient[] {
    return this.clients.filter((c) => c.auth?.id === userId);
  }

  private handleSend(
    client: LobbyClient,
    toUserId: string,
    text: string,
    replyToId?: number,
  ): void {
    const from = client.auth;
    if (!from) return;
    if (!this.dmLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
    const to = services().users.findById(toUserId);
    if (!to || to.disabled || to.id === from.id) {
      return this.sendError(
        client,
        ErrorCode.NotFound,
        'Não dá para mandar mensagem para essa pessoa.',
      );
    }
    const message = services().dms.send(from.id, to.id, text, replyToId);
    const targets = new Set([...this.clientsOf(from.id), ...this.clientsOf(to.id)]);
    for (const c of targets) c.send(LobbyServerMessage.DmMessage, message);
  }

  private handleRead(client: LobbyClient, otherId: string): void {
    const me = client.auth;
    if (!me) return;
    const upToId = services().dms.markRead(me.id, otherId);
    if (upToId === null) return;
    const receipt: DmReadReceipt = { readerId: me.id, writerId: otherId, upToId };
    // Quem mandou vê "visto"; as outras abas de quem leu zeram o contador.
    for (const c of [...this.clientsOf(otherId), ...this.clientsOf(me.id)]) {
      c.send(LobbyServerMessage.DmReadReceipt, receipt);
    }
  }

  private sendError(client: LobbyClient, code: ErrorCode, message = ERROR_MESSAGES[code]): void {
    client.send(LobbyServerMessage.Error, { code, message } satisfies ErrorMessage);
  }
}
