import { Client, CloseCode, type Room } from '@colyseus/sdk';
import {
  ClientMessage,
  OFFICE_ROOM,
  OfficeState,
  ServerMessage,
  type ChatMessage,
  type ChatDeletedMessage,
  type KickedMessage,
  type EmoteId,
  type EmoteMessage,
  type Status,
  type ErrorMessage,
  type FurniMoveMessage,
  type FurniPlaceMessage,
  type JoinOptions,
  type MoveMessage,
  type UpdateAvatarMessage,
  type RoomLayoutMessage,
  type RoomTransferMessage,
} from '@office/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';
export type OfficeRoomClient = Room<unknown, OfficeState>;

/** Atrasos entre tentativas de reentrar depois que a reconexão automática desiste. */
const REJOIN_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

function serverEndpoint(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  // Em dev o cliente está no Vite (5173) e o servidor na 2567; em produção, mesma origem.
  return import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin;
}

interface Handlers {
  status: (status: ConnectionStatus, detail?: string) => void;
  /** Entrou (ou reentrou) numa sala: a cena deve ser (re)montada. */
  joined: (room: OfficeRoomClient, layout: RoomLayoutMessage) => void;
  serverError: (err: ErrorMessage) => void;
  chat: (msg: ChatMessage) => void;
  emote: (msg: EmoteMessage) => void;
  chatDeleted: (msg: ChatDeletedMessage) => void;
  /** Um admin tirou você (da sala: vem um transfer em seguida; do escritório: fim). */
  kicked: (msg: KickedMessage) => void;
  /** Vai trocar de sala por uma porta (hora de escurecer a tela). */
  transferStart: (targetRoomId: string) => void;
  /** Sessão recusada pelo servidor: voltar para a tela de entrada. */
  sessionInvalid: () => void;
}

/**
 * Conexão com o servidor em tempo real. A reconexão curta (queda de Wi-Fi) é feita pelo
 * SDK do Colyseus (`onDrop` → `onReconnect`). Se ela desistir — por exemplo, o servidor
 * reiniciou e a sala sumiu — esta classe reentra do zero com o mesmo token, com backoff.
 */
export class OfficeConnection {
  private readonly client = new Client(serverEndpoint());
  private room: OfficeRoomClient | null = null;
  private roomId = '';
  private token = '';
  private leaving = false;
  private rejoining = false;
  private switching = false;
  /** Ticket da porta, usado só na próxima entrada. */
  private ticket: string | undefined;

  constructor(private readonly on: Handlers) {}

  async join(roomId: string, token: string): Promise<void> {
    this.roomId = roomId;
    this.token = token;
    this.on.status('connecting');
    await this.connectOnce();
  }

  /** Sala física atual (`reception`, `meeting`…). */
  get currentRoomId(): string {
    return this.roomId;
  }

  move(msg: MoveMessage): void {
    this.room?.send(ClientMessage.Move, msg);
  }

  interact(furniId: string): void {
    this.room?.send(ClientMessage.Interact, { furniId });
  }

  placeFurni(msg: FurniPlaceMessage): void {
    this.room?.send(ClientMessage.FurniPlace, msg);
  }

  moveFurni(msg: FurniMoveMessage): void {
    this.room?.send(ClientMessage.FurniMove, msg);
  }

  removeFurni(furniId: string): void {
    this.room?.send(ClientMessage.FurniRemove, { furniId });
  }

  setStatus(status: Status): void {
    this.room?.send(ClientMessage.SetStatus, { status });
  }

  typing(on: boolean): void {
    this.room?.send(ClientMessage.Typing, { on });
  }

  emote(emote: EmoteId): void {
    this.room?.send(ClientMessage.Emote, { emote });
  }

  deleteChat(id: number): void {
    this.room?.send(ClientMessage.ChatDelete, { id });
  }

  say(text: string): void {
    this.room?.send(ClientMessage.Chat, { text });
  }

  updateAvatar(msg: UpdateAvatarMessage): void {
    this.room?.send(ClientMessage.UpdateAvatar, msg);
  }

  async leave(): Promise<void> {
    this.leaving = true;
    await this.room?.leave(true);
  }

  private async connectOnce(): Promise<void> {
    const options: JoinOptions = {
      officeRoomId: this.roomId,
      token: this.token,
      ticket: this.ticket,
    };
    this.ticket = undefined;
    const room = await this.client.joinOrCreate(OFFICE_ROOM, options, OfficeState);
    this.room = room;
    room.onMessage(ServerMessage.Error, (err: ErrorMessage) => this.on.serverError(err));
    room.onMessage(ServerMessage.Chat, (msg: ChatMessage) => this.on.chat(msg));
    room.onMessage(ServerMessage.Emote, (msg: EmoteMessage) => this.on.emote(msg));
    room.onMessage(ServerMessage.ChatDeleted, (msg: ChatDeletedMessage) =>
      this.on.chatDeleted(msg),
    );
    room.onMessage(ServerMessage.Kicked, (msg: KickedMessage) => {
      // Do escritório: não tenta reconectar quando o servidor fechar a conexão.
      if (msg.scope === 'office') this.leaving = true;
      this.on.kicked(msg);
    });
    room.onMessage(
      ServerMessage.RoomTransfer,
      (msg: RoomTransferMessage) => void this.switchRoom(msg),
    );
    room.onDrop(() => this.on.status('reconnecting', 'Conexão perdida. Reconectando…'));
    room.onReconnect(() => this.on.status('online'));
    room.onLeave((code) => {
      if (this.leaving || code === CloseCode.CONSENTED) return;
      void this.rejoinLoop();
    });
    const layout = (await room.request(ClientMessage.GetLayout)) as RoomLayoutMessage;
    this.on.joined(room, layout);
    this.on.status('online');
  }

  /** Passou por uma porta: sai desta sala (com consentimento) e entra na outra com o ticket. */
  private async switchRoom(msg: RoomTransferMessage): Promise<void> {
    if (this.switching) return;
    this.switching = true;
    this.on.transferStart(msg.targetRoomId);
    this.on.status('connecting', 'Trocando de sala…');
    const previous = this.room;
    this.room = null;
    try {
      await previous?.leave(true);
    } catch {
      // A sala antiga já pode ter caído; seguimos para a nova.
    }
    this.roomId = msg.targetRoomId;
    this.ticket = msg.ticket;
    try {
      await this.connectOnce();
    } catch {
      void this.rejoinLoop();
    } finally {
      this.switching = false;
    }
  }

  private async rejoinLoop(): Promise<void> {
    if (this.rejoining) return;
    this.rejoining = true;
    this.room = null;
    for (let attempt = 0; !this.leaving; attempt++) {
      const delay = REJOIN_DELAYS_MS[Math.min(attempt, REJOIN_DELAYS_MS.length - 1)]!;
      this.on.status(
        'reconnecting',
        `Sem conexão com o servidor. Tentando de novo em ${delay / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, delay));
      try {
        await this.connectOnce();
        break;
      } catch (err) {
        if (isSessionError(err)) {
          this.on.status('offline');
          this.on.sessionInvalid();
          break;
        }
      }
    }
    this.rejoining = false;
  }
}

/** O servidor recusou o token (sessão apagada ou banco recriado). */
export function isSessionError(err: unknown): boolean {
  const e = err as { code?: number; message?: string };
  return e.code === 401 || /sess[aã]o/i.test(e.message ?? '');
}
