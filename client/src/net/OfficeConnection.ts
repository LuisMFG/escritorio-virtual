import { Client, CloseCode, type Room } from '@colyseus/sdk';
import {
  ClientMessage,
  OFFICE_ROOM,
  OfficeState,
  ServerMessage,
  TvMessage,
  type TvScreens,
  type TvState,
  type ChatMessage,
  type ChatDeletedMessage,
  type KickedMessage,
  type BoardNote,
  type PollCreate,
  type FocusPhase,
  type PollUpdated,
  type TttScores,
  type NoteColor,
  type WbDraft,
  type WbRemovedMessage,
  type WbStroke,
  type WbStrokeInput,
  type WbStrokeMessage,
  type Reaction,
  type ReactionsUpdate,
  type EmoteId,
  type Posture,
  type EffectFlash,
  type EmoteMessage,
  type HighFiveMessage,
  type Status,
  type ErrorMessage,
  type FurniMoveMessage,
  type FurniColorMessage,
  type FurniResult,
  type FurniPlaceMessage,
  type JoinOptions,
  type MoveMessage,
  type UpdateAvatarMessage,
  type RoomLayoutMessage,
  type RoomTransferMessage,
  RECEPTION,
} from '@office/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';
export type OfficeRoomClient = Room<unknown, OfficeState>;

/** Atrasos entre tentativas de reentrar depois que a reconexão automática desiste. */
const REJOIN_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

export function serverEndpoint(): string {
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
  /** Duas pessoas bateram as mãos (Fase 54). */
  highFive: (msg: HighFiveMessage) => void;
  chatDeleted: (msg: ChatDeletedMessage) => void;
  chatReactions: (msg: ReactionsUpdate) => void;
  /** Votos ou estado de uma enquete mudaram. */
  pollUpdated: (msg: PollUpdated) => void;
  /** Fase do próprio modo foco mudou. */
  focusPhase: (msg: FocusPhase) => void;
  /** Comemoração: efeito por alguns segundos sobre alguém. */
  effectFlash: (msg: EffectFlash) => void;
  /** Recados de um mural mudaram. */
  boardChanged: (furniId: string) => void;
  wbStroke: (msg: WbStrokeMessage) => void;
  wbDraft: (msg: WbDraft) => void;
  wbRemoved: (msg: WbRemovedMessage) => void;
  wbCleared: (furniId: string) => void;
  /** TV (Fase 51): estado da TV aberta, o que passa nas telas da sala e erros. */
  tvState: (st: TvState) => void;
  tvScreens: (screens: TvScreens) => void;
  tvError: (message: string) => void;
  /** A sala foi editada: pedir o layout de novo e remontar a cena. */
  layoutChanged: (room: OfficeRoomClient, layout: RoomLayoutMessage) => void;
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
    try {
      await this.connectOnce();
    } catch (err) {
      // Sala da URL não existe mais (excluída): vai para a Recepção.
      if (isSessionError(err) || !isMissingRoom(err)) throw err;
      this.roomId = RECEPTION.id;
      await this.connectOnce();
    }
  }

  /** Sala física atual (`reception`, `meeting`…). */
  get currentRoomId(): string {
    return this.roomId;
  }

  /** Sala Colyseus atual (para ler o estado: quem está onde). */
  get currentRoom(): OfficeRoomClient | null {
    return this.room;
  }

  move(msg: MoveMessage): void {
    this.room?.send(ClientMessage.Move, msg);
  }

  interact(furniId: string): void {
    this.room?.send(ClientMessage.Interact, { furniId });
  }

  /**
   * Ações do Decorar esperam a resposta do servidor (Fase 53): o desfazer só grava o que foi
   * aceito e a tela volta atrás no que foi recusado. Sem conexão ou sem resposta, conta como recusa.
   */
  private async furniRequest(type: string, msg: object): Promise<FurniResult> {
    if (!this.room) return { ok: false };
    try {
      return ((await this.room.request(type, msg)) as FurniResult | undefined) ?? { ok: false };
    } catch {
      return { ok: false };
    }
  }

  placeFurni(msg: FurniPlaceMessage): Promise<FurniResult> {
    return this.furniRequest(ClientMessage.FurniPlace, msg);
  }

  moveFurni(msg: FurniMoveMessage): Promise<FurniResult> {
    return this.furniRequest(ClientMessage.FurniMove, msg);
  }

  colorFurni(msg: FurniColorMessage): Promise<FurniResult> {
    return this.furniRequest(ClientMessage.FurniColor, msg);
  }

  removeFurni(furniId: string): Promise<FurniResult> {
    return this.furniRequest(ClientMessage.FurniRemove, { furniId });
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

  /** Toca aqui com a pessoa desta sessão (o servidor confere distância e se ela pode). */
  highFive(target: string): void {
    this.room?.send(ClientMessage.HighFive, { target });
  }

  /** Sentar/deitar no chão ou levantar. */
  posture(posture: Posture): void {
    this.room?.send(ClientMessage.Posture, { posture });
  }

  /** Largar o item da mão. */
  dropItem(): void {
    this.room?.send(ClientMessage.ItemDrop, {});
  }

  /**
   * Vira para o lado (setas): parado gira de 1 em 1 direção; sentado no chão, de 2 em 2
   * (só há pose sentada nas direções pares). Andando ou deitado, não faz nada.
   */
  turn(step: 1 | -1): void {
    const me = this.room?.state.players.get(this.room.sessionId);
    if (!me || (me.action !== 'idle' && me.action !== 'sit')) return;
    const by = me.action === 'sit' ? 2 : 1;
    this.room?.send(ClientMessage.Turn, { dir: (me.dir + step * by + 8) % 8 });
  }

  /** Id desta conexão na sala (para reconhecer os próprios traços). */
  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  async wbLoad(furniId: string): Promise<WbStroke[]> {
    if (!this.room) return [];
    return (await this.room.request(ClientMessage.WbLoad, { furniId })) as WbStroke[];
  }

  wbStroke(furniId: string, stroke: WbStrokeInput, draftId?: string): void {
    this.room?.send(ClientMessage.WbStroke, { furniId, stroke, draftId });
  }

  wbDraft(draft: Omit<WbDraft, 'sessionId'>): void {
    this.room?.send(ClientMessage.WbDraft, draft);
  }

  wbUndo(furniId: string): void {
    this.room?.send(ClientMessage.WbUndo, { furniId });
  }

  wbClear(furniId: string): void {
    this.room?.send(ClientMessage.WbClear, { furniId });
  }

  // ---------- TV com YouTube (Fase 51) ----------

  tvOpen(furniId: string): void {
    this.room?.send(TvMessage.Open, { furniId });
  }

  tvClose(furniId: string): void {
    this.room?.send(TvMessage.Close, { furniId });
  }

  tvAdd(furniId: string, videoIds: string[]): void {
    this.room?.send(TvMessage.Add, { furniId, videoIds });
  }

  tvRemove(furniId: string, id: string): void {
    this.room?.send(TvMessage.Remove, { furniId, id });
  }

  tvControl(furniId: string, action: 'play' | 'pause' | 'seek', position: number): void {
    this.room?.send(TvMessage.Control, { furniId, action, position });
  }

  tvSkip(furniId: string): void {
    this.room?.send(TvMessage.Skip, { furniId });
  }

  tvDuration(furniId: string, itemId: string, duration: number): void {
    this.room?.send(TvMessage.Duration, { furniId, itemId, duration });
  }

  tvEnded(furniId: string, itemId: string): void {
    this.room?.send(TvMessage.Ended, { furniId, itemId });
  }

  /** O que passa em cada TV da sala agora. */
  async tvScreens(): Promise<TvScreens> {
    if (!this.room) return {};
    return (await this.room.request(TvMessage.Screens)) as TvScreens;
  }

  tttJoin(furniId: string): void {
    this.room?.send(ClientMessage.TttJoin, { furniId });
  }

  tttLeave(furniId: string): void {
    this.room?.send(ClientMessage.TttLeave, { furniId });
  }

  tttMove(furniId: string, cell: number): void {
    this.room?.send(ClientMessage.TttMove, { furniId, cell });
  }

  tttRematch(furniId: string): void {
    this.room?.send(ClientMessage.TttRematch, { furniId });
  }

  async tttScores(furniId: string): Promise<TttScores> {
    if (!this.room) return { top: [], players: [] };
    return (await this.room.request(ClientMessage.TttScores, { furniId })) as TttScores;
  }

  async boardNotes(furniId: string): Promise<BoardNote[]> {
    if (!this.room) return [];
    return (await this.room.request(ClientMessage.BoardNotes, { furniId })) as BoardNote[];
  }

  boardAdd(furniId: string, text: string, color: NoteColor): void {
    this.room?.send(ClientMessage.BoardAdd, { furniId, text, color });
  }

  boardRemove(noteId: number): void {
    this.room?.send(ClientMessage.BoardRemove, { noteId });
  }

  deleteChat(id: number): void {
    this.room?.send(ClientMessage.ChatDelete, { id });
  }

  say(text: string, replyToId?: number, attachmentId?: string): void {
    this.room?.send(ClientMessage.Chat, { text, replyToId, attachmentId });
  }

  focusStart(minutes: number, breakMinutes: number): void {
    this.room?.send(ClientMessage.FocusStart, { minutes, breakMinutes });
  }

  focusStop(): void {
    this.room?.send(ClientMessage.FocusStop, {});
  }

  createPoll(poll: Required<PollCreate>): void {
    this.room?.send(ClientMessage.PollCreate, poll);
  }

  votePoll(pollId: number, option: number): void {
    this.room?.send(ClientMessage.PollVote, { pollId, option });
  }

  closePoll(pollId: number): void {
    this.room?.send(ClientMessage.PollClose, { pollId });
  }

  react(id: number, emoji: Reaction): void {
    this.room?.send(ClientMessage.ChatReact, { id, emoji });
  }

  updateAvatar(msg: UpdateAvatarMessage): void {
    this.room?.send(ClientMessage.UpdateAvatar, msg);
  }

  /** Minha mesa (Fase 42): ficar com a estação onde está sentado, largar e ir até ela. */
  claimDesk(furniId: string): void {
    this.room?.send(ClientMessage.ClaimDesk, { furniId });
  }

  releaseDesk(): void {
    this.room?.send(ClientMessage.ReleaseDesk, {});
  }

  goToDesk(): void {
    this.room?.send(ClientMessage.GoToDesk, {});
  }

  /** Vai direto para outra sala (sem porta), nascendo na entrada dela. */
  goTo(roomId: string): void {
    if (roomId === this.roomId) return;
    void this.switchRoom({ targetRoomId: roomId, ticket: '' });
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
    room.onMessage(ServerMessage.HighFive, (msg: HighFiveMessage) => this.on.highFive(msg));
    room.onMessage(ServerMessage.ChatDeleted, (msg: ChatDeletedMessage) =>
      this.on.chatDeleted(msg),
    );
    room.onMessage(ServerMessage.ChatReactions, (msg: ReactionsUpdate) =>
      this.on.chatReactions(msg),
    );
    room.onMessage(ServerMessage.PollUpdated, (msg: PollUpdated) => this.on.pollUpdated(msg));
    room.onMessage(ServerMessage.FocusPhase, (msg: FocusPhase) => this.on.focusPhase(msg));
    room.onMessage(ServerMessage.EffectFlash, (msg: EffectFlash) => this.on.effectFlash(msg));
    room.onMessage(ServerMessage.BoardChanged, (m: { furniId: string }) =>
      this.on.boardChanged(m.furniId),
    );
    room.onMessage(ServerMessage.WbStroke, (m: WbStrokeMessage) => this.on.wbStroke(m));
    room.onMessage(ServerMessage.WbDraft, (m: WbDraft) => this.on.wbDraft(m));
    room.onMessage(ServerMessage.WbRemoved, (m: WbRemovedMessage) => this.on.wbRemoved(m));
    room.onMessage(ServerMessage.WbCleared, (m: { furniId: string }) =>
      this.on.wbCleared(m.furniId),
    );
    room.onMessage(TvMessage.State, (st: TvState) => this.on.tvState(st));
    room.onMessage(TvMessage.Screens, (s: TvScreens) => this.on.tvScreens(s));
    room.onMessage(TvMessage.Error, (e: { message: string }) => this.on.tvError(e.message));
    room.onMessage(ServerMessage.LayoutChanged, async () => {
      const layout = (await room.request(ClientMessage.GetLayout)) as RoomLayoutMessage;
      if (this.room === room) this.on.layoutChanged(room, layout);
    });
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
    this.ticket = msg.ticket || undefined;
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
        if (isMissingRoom(err)) this.roomId = RECEPTION.id;
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

/** A sala pedida não existe (foi excluída no editor). */
function isMissingRoom(err: unknown): boolean {
  return /sala inexistente/i.test((err as { message?: string }).message ?? '');
}

/** O servidor recusou o token (sessão apagada ou banco recriado). */
export function isSessionError(err: unknown): boolean {
  const e = err as { code?: number; message?: string };
  return e.code === 401 || /sess[aã]o/i.test(e.message ?? '');
}
