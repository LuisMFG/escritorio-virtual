import { Callbacks, Client, CloseCode, type Room } from '@colyseus/sdk';
import {
  LOBBY_ROOM,
  LobbyClientMessage,
  LobbyServerMessage,
  LobbyState,
  type DirectMessage,
  type DmConversation,
  type DmReadReceipt,
  type ErrorMessage,
  type Reaction,
  type ReactionsUpdate,
  type RoomSummary,
  MeetingMessage,
  type MeetingNotice,
  AchievementMessage,
  type AchievementUnlocked,
  AnnouncementMessage,
  type AnnouncementNotice,
  KudosMessage,
  type KudosNotice,
  CallMessage,
  type CallInvite,
  type CallInviteResult,
  type CallMedia,
  type CallSignalData,
  type CallState,
  type IceServer,
} from '@office/shared';
import { isSessionError, serverEndpoint } from './OfficeConnection.js';

export interface OnlineInfo {
  userId: string;
  name: string;
  roomId: string;
  status: string;
  /** Atividade fora do escritório (VS Code, Visual Studio…). */
  activity: string;
}

interface LobbyHandlers {
  dm(msg: DirectMessage): void;
  receipt(r: DmReadReceipt): void;
  reactions(update: ReactionsUpdate): void;
  error(err: ErrorMessage): void;
  /** Quem está online mudou (entrou, saiu, trocou de sala ou de status). */
  people(list: OnlineInfo[]): void;
  /** Lista de salas mudou (criada, renomeada, excluída, reunião começou/acabou). */
  rooms(list: RoomSummary[]): void;
  meetingsChanged(): void;
  meetingInvite(n: MeetingNotice): void;
  meetingReminder(n: MeetingNotice): void;
  achievement(n: AchievementUnlocked): void;
  announcement(n: AnnouncementNotice): void;
  announcementRemoved(id: number): void;
  kudosReceived(n: KudosNotice): void;
  kudosChanged(): void;
  /** O canal global (re)conectou: hora de recarregar conversas e não lidas. */
  ready(): void;
}

/** Mensagens das chamadas (Fase 49), ligadas depois pelo `CallManager`. */
export interface CallHandlers {
  invited(invite: CallInvite): void;
  inviteGone(inviteId: string): void;
  result(result: CallInviteResult): void;
  state(state: CallState | null): void;
  signal(fromUserId: string, data: CallSignalData): void;
}

const REJOIN_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Conexão com o canal global (`lobby`): mensagens privadas e presença ao vivo. Fica aberta
 * enquanto a pessoa está no escritório, em qualquer sala. Cai e volta sozinha.
 */
export class LobbyConnection {
  private readonly client = new Client(serverEndpoint());
  private room: Room<unknown, LobbyState> | null = null;
  private leaving = false;
  private rejoining = false;
  private calls: CallHandlers | null = null;

  constructor(
    private readonly token: string,
    private readonly on: LobbyHandlers,
  ) {}

  async connect(): Promise<void> {
    const room: Room<unknown, LobbyState> = await this.client.joinOrCreate(
      LOBBY_ROOM,
      { token: this.token },
      LobbyState,
    );
    this.room = room;
    room.onMessage(LobbyServerMessage.DmMessage, (m: DirectMessage) => this.on.dm(m));
    room.onMessage(LobbyServerMessage.DmReadReceipt, (r: DmReadReceipt) => this.on.receipt(r));
    room.onMessage(LobbyServerMessage.Error, (e: ErrorMessage) => this.on.error(e));
    room.onMessage(LobbyServerMessage.DmReactions, (u: ReactionsUpdate) => this.on.reactions(u));
    room.onMessage(MeetingMessage.Changed, () => this.on.meetingsChanged());
    room.onMessage(MeetingMessage.Invited, (n: MeetingNotice) => this.on.meetingInvite(n));
    room.onMessage(MeetingMessage.Reminder, (n: MeetingNotice) => this.on.meetingReminder(n));
    room.onMessage(AchievementMessage.Unlocked, (n: AchievementUnlocked) => this.on.achievement(n));
    room.onMessage(AnnouncementMessage.New, (n: AnnouncementNotice) => this.on.announcement(n));
    room.onMessage(KudosMessage.Received, (n: KudosNotice) => this.on.kudosReceived(n));
    room.onMessage(KudosMessage.Changed, () => this.on.kudosChanged());
    room.onMessage(AnnouncementMessage.Removed, (n: { id: number }) =>
      this.on.announcementRemoved(n.id),
    );
    room.onMessage(CallMessage.Invited, (i: CallInvite) => this.calls?.invited(i));
    room.onMessage(CallMessage.InviteGone, (m: { inviteId: string }) =>
      this.calls?.inviteGone(m.inviteId),
    );
    room.onMessage(CallMessage.InviteResult, (r: CallInviteResult) => this.calls?.result(r));
    room.onMessage(CallMessage.State, (st: CallState | null) => this.calls?.state(st));
    room.onMessage(CallMessage.Signal, (m: { fromUserId: string; data: CallSignalData }) =>
      this.calls?.signal(m.fromUserId, m.data),
    );
    const cb = Callbacks.get(room);
    const emit = () => this.on.people(this.people());
    cb.onAdd('people', (person) => {
      cb.onChange(person, emit);
      emit();
    });
    cb.onRemove('people', emit);
    const emitRooms = () =>
      this.on.rooms(
        [...room.state.rooms.values()]
          .sort((a, b) => a.sort - b.sort)
          .map((r) => ({ id: r.id, name: r.name, meeting: r.meeting || undefined })),
      );
    cb.onAdd('rooms', (entry) => {
      cb.onChange(entry, emitRooms);
      emitRooms();
    });
    cb.onRemove('rooms', emitRooms);
    room.onReconnect(() => this.on.ready());
    room.onLeave((code) => {
      if (this.leaving || code === CloseCode.CONSENTED) return;
      void this.rejoinLoop();
    });
    this.on.ready();
  }

  people(): OnlineInfo[] {
    return [...(this.room?.state.people.values() ?? [])].map((p) => ({
      userId: p.userId,
      name: p.name,
      roomId: p.roomId,
      status: p.status,
      activity: p.activity,
    }));
  }

  send(toUserId: string, text: string, replyToId?: number, attachmentId?: string): void {
    this.room?.send(LobbyClientMessage.DmSend, { toUserId, text, replyToId, attachmentId });
  }

  react(id: number, emoji: Reaction): void {
    this.room?.send(LobbyClientMessage.DmReact, { id, emoji });
  }

  markRead(withUserId: string): void {
    this.room?.send(LobbyClientMessage.DmRead, { withUserId });
  }

  async conversations(): Promise<DmConversation[]> {
    if (!this.room) return [];
    return (await this.room.request(LobbyClientMessage.DmConversations)) as DmConversation[];
  }

  async history(withUserId: string, beforeId?: number): Promise<DirectMessage[]> {
    if (!this.room) return [];
    return (await this.room.request(LobbyClientMessage.DmHistory, {
      withUserId,
      beforeId,
    })) as DirectMessage[];
  }

  // ---------- Chamadas (Fase 49) ----------

  onCalls(handlers: CallHandlers): void {
    this.calls = handlers;
  }

  callInvite(toUserId: string, reason: string): void {
    this.room?.send(CallMessage.Invite, { toUserId, reason });
  }

  callAnswer(inviteId: string, accept: boolean): void {
    this.room?.send(CallMessage.Answer, { inviteId, accept });
  }

  callLeave(): void {
    this.room?.send(CallMessage.Leave, {});
  }

  callSignal(toUserId: string, data: CallSignalData): void {
    this.room?.send(CallMessage.Signal, { toUserId, data });
  }

  callMedia(media: CallMedia): void {
    this.room?.send(CallMessage.Media, media);
  }

  async iceServers(): Promise<IceServer[]> {
    if (!this.room) return [];
    return (await this.room.request(CallMessage.Ice)) as IceServer[];
  }

  async leave(): Promise<void> {
    this.leaving = true;
    await this.room?.leave(true);
  }

  private async rejoinLoop(): Promise<void> {
    if (this.rejoining) return;
    this.rejoining = true;
    this.room = null;
    for (let attempt = 0; !this.leaving; attempt++) {
      await new Promise((r) =>
        setTimeout(r, REJOIN_DELAYS_MS[Math.min(attempt, REJOIN_DELAYS_MS.length - 1)]),
      );
      try {
        await this.connect();
        break;
      } catch (err) {
        // Sessão recusada: a conexão da sala trata (volta para a entrada).
        if (isSessionError(err)) break;
      }
    }
    this.rejoining = false;
  }
}
