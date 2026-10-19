import { randomInt } from 'node:crypto';
import { CloseCode, Room, ServerError, validate, type Client, type Deferred } from '@colyseus/core';
import {
  canPlace,
  focusStartSchema,
  type FocusPhase,
  parsePollCommand,
  pollCreateSchema,
  pollRefSchema,
  pollVoteSchema,
  type ChatMessage,
  type PollCreate,
  type PollUpdated,
  parsePetCommand,
  petCommandText,
  type PetInfo,
  parseQuickCommand,
  quickCommandText,
  TTT_GAME,
  TTT_TOP,
  tttMoveSchema,
  tttRefSchema,
  type ChatKind,
  type TttScores,
  chatSchema,
  chatDeleteSchema,
  boardAddSchema,
  boardRefSchema,
  boardRemoveSchema,
  NOTES_PER_BOARD,
  WB_MAX_STROKES,
  wbDraftSchema,
  wbRefSchema,
  wbStrokeSchema,
  type WbDraft,
  type WbRemovedMessage,
  type WbStrokeMessage,
  reactSchema,
  type ReactionsUpdate,
  type ReactRequest,
  RECEPTION,
  type ChatDeletedMessage,
  type KickedMessage,
  emoteSchema,
  statusSchema,
  typingSchema,
  ClientMessage,
  footprint,
  Furni,
  furniMoveSchema,
  furniPlaceSchema,
  furniRefSchema,
  nearestFreeSeat,
  seatTiles,
  sitDirection,
  layDirection,
  bedDirection,
  postureSchema,
  turnSchema,
  directionBetween,
  type Posture,
  CELEBRATIONS,
  COFFEE_ITEM,
  FRIDGE_ITEMS,
  HAND_ITEM_MS,
  type EffectFlash,
  ERROR_MESSAGES,
  ErrorCode,
  joinOptionsSchema,
  moveSchema,
  updateAvatarSchema,
  validateFigure,
  OfficeState,
  parseHeightmap,
  Player,
  RoomGrid,
  type TttGame,
  ServerMessage,
  type EmoteMessage,
  type FurniManifestEntry,
  type EmoteRequest,
  type ErrorMessage,
  type FurniMoveMessage,
  type FurniColorMessage,
  furniColorSchema,
  baseClassname,
  type FurniPlaceMessage,
  type PlacedFurni,
  type PlacementRequest,
  type Heightmap,
  type MoveMessage,
  type UpdateAvatarMessage,
  type RoomLayoutMessage,
  type RoomTransferMessage,
  type TilePoint,
} from '@office/shared';
import type { UserRow } from '../db/schema.js';
import { services, type ModerationEvents } from '../services/index.js';
import { KeyedRateLimiter } from '../util/rateLimiter.js';
import { MovementSystem, type Mover } from './MovementSystem.js';
import * as ttt from './ticTacToe.js';
import { PetKeeper } from './PetKeeper.js';

const TICK_MS = 50;
/** Segundos que um avatar desconectado espera por reconexão antes de sair da sala. */
const RECONNECT_SECONDS = 30;
/** Item na mão de cada pessoa (vale entre salas, até vencer). */
const HELD = new Map<string, { item: number; until: number }>();
/** Aniversários já comemorados hoje (`userId:AAAA-MM-DD`). */
const BIRTHDAY_SHOWN = new Set<string>();

type OfficeClient = Client<{ auth: UserRow }>;

/**
 * Uma sala física do escritório (Recepção, Copa…). Autoridade sobre posições e movimento.
 */
/** Estado do dado rolando (o cliente mostra a animação -1 do Habbo). */
const DICE_ROLLING_STATE = 255;
const DICE_ROLL_MS = 1200;
/** Porta do teleporte abrindo antes de a pessoa sumir. */
const TELEPORT_MS = 900;

export class OfficeRoom extends Room<{ state: OfficeState; client: OfficeClient }> {
  override maxClients = 30;
  /** Proteção geral contra flood; limites específicos por ação ficam nos handlers. */
  /** Desenhar no quadro manda ~12 rascunhos/s; o resto cabe com folga. */
  override maxMessagesPerSecond = 40;

  private layout!: RoomLayoutMessage;
  private map!: Heightmap;
  private movement!: MovementSystem;
  private pets!: PetKeeper;
  private readonly moveLimiter = new KeyedRateLimiter(5, 5);
  private readonly avatarLimiter = new KeyedRateLimiter(3, 0.5);
  /** Chat: até 3 mensagens seguidas, recarregando 3 a cada 5 s. */
  private readonly chatLimiter = new KeyedRateLimiter(3, 3 / 5);
  private readonly statusLimiter = new KeyedRateLimiter(5, 1);
  /** "Digitando": eventos baratos, mas sem deixar virar flood. */
  private readonly typingLimiter = new KeyedRateLimiter(6, 3);
  /** Emotes: 3 seguidos, depois 1 a cada 2 s. */
  private readonly emoteLimiter = new KeyedRateLimiter(3, 0.5);
  /** Reações: 10 seguidas, recarregando 3 por segundo. */
  private readonly reactLimiter = new KeyedRateLimiter(10, 3);
  /** Usar móveis (luz, TV…): 6 seguidos, recarregando 2 por segundo. */
  private readonly useLimiter = new KeyedRateLimiter(6, 2);
  /** Recados: 5 seguidos, depois 1 a cada 5 s. */
  private readonly boardLimiter = new KeyedRateLimiter(5, 0.2);
  /** Quadro branco: traços e desfazer (40 seguidos, 20/s) e rascunhos (40, 25/s). */
  private readonly wbLimiter = new KeyedRateLimiter(40, 20);
  private readonly draftLimiter = new KeyedRateLimiter(40, 25);
  /** Jogo da velha: 10 ações seguidas, recarregando 4 por segundo. */
  private readonly gameLimiter = new KeyedRateLimiter(10, 4);
  /** Decorar: rajada de 10 ações, recarregando 4 por segundo. */
  private readonly editLimiter = new KeyedRateLimiter(10, 4);
  /** Quem clicou numa cadeira e está andando até ela (sessionId → móvel e assento). */
  private readonly pendingSit = new Map<string, { furniId: string; seat: TilePoint }>();
  /** Quem clicou num móvel de usar (luz, café…) e está andando até ficar do lado dele. */
  private readonly pendingUse = new Map<string, { furniId: string; at: TilePoint }>();
  /** Reconexões pendentes por sessionId, para cancelar quando a pessoa volta numa aba nova. */
  private readonly pendingReconnects = new Map<string, Deferred<Client>>();

  override messages = {
    [ClientMessage.Move]: validate(moveSchema, (client, msg) =>
      this.handleMove(client as OfficeClient, msg),
    ),
    // Pedido explícito evita a corrida de uma mensagem enviada no onJoin chegar antes
    // de o cliente registrar o handler.
    [ClientMessage.GetLayout]: () => this.layout,
    [ClientMessage.GetChatHistory]: (client: Client) =>
      this.withPolls(
        services().chat.recent(this.layout.roomId),
        (client as OfficeClient).auth?.id ?? '',
      ),
    [ClientMessage.Chat]: validate(chatSchema, (client, msg) =>
      this.handleChat(client as OfficeClient, msg),
    ),
    [ClientMessage.UpdateAvatar]: validate(updateAvatarSchema, (client, msg) =>
      this.handleUpdateAvatar(client as OfficeClient, msg),
    ),
    [ClientMessage.FurniPlace]: validate(furniPlaceSchema, (client, msg) =>
      this.handlePlace(client as OfficeClient, msg),
    ),
    [ClientMessage.FurniMove]: validate(furniMoveSchema, (client, msg) =>
      this.handleFurniMove(client as OfficeClient, msg),
    ),
    [ClientMessage.FurniColor]: validate(furniColorSchema, (client, msg) =>
      this.handleColor(client as OfficeClient, msg),
    ),
    [ClientMessage.FurniRemove]: validate(furniRefSchema, (client, msg) =>
      this.handleRemove(client as OfficeClient, msg.furniId),
    ),
    [ClientMessage.SetStatus]: validate(statusSchema, (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (player && this.statusLimiter.tryTake(client.sessionId)) {
        player.status = msg.status;
        services().presence.setStatus(client.sessionId, msg.status);
      }
    }),
    [ClientMessage.Typing]: validate(typingSchema, (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (player && this.typingLimiter.tryTake(client.sessionId)) player.typing = msg.on;
    }),
    [ClientMessage.Emote]: validate(emoteSchema, (client, msg) =>
      this.handleEmote(client as OfficeClient, msg),
    ),
    [ClientMessage.Posture]: validate(postureSchema, (client, msg) =>
      this.handlePosture(client as OfficeClient, msg.posture),
    ),
    [ClientMessage.Turn]: validate(turnSchema, (client, msg) =>
      this.handleTurn(client as OfficeClient, msg.dir),
    ),
    [ClientMessage.ItemDrop]: (client: Client) => this.dropHandItem(client.sessionId),
    [ClientMessage.BoardNotes]: (client: Client, input: unknown) => {
      const p = boardRefSchema.safeParse(input);
      return p.success && this.boardFurni(p.data.furniId)
        ? services().boards.notes(p.data.furniId)
        : [];
    },
    [ClientMessage.BoardAdd]: validate(boardAddSchema, (client, msg) => {
      const c = client as OfficeClient;
      if (!c.auth || !this.boardFurni(msg.furniId)) return;
      if (!this.boardLimiter.tryTake(c.sessionId)) return this.sendError(c, ErrorCode.RateLimit);
      if (services().boards.count(msg.furniId) >= NOTES_PER_BOARD) {
        return this.sendError(c, ErrorCode.Forbidden, 'O mural está cheio. Tire um recado antes.');
      }
      services().boards.add(msg.furniId, c.auth.id, msg.text, msg.color);
      services().achievements.unlock(c.auth.id, 'board_note');
      this.broadcast(ServerMessage.BoardChanged, { furniId: msg.furniId });
    }),
    [ClientMessage.BoardRemove]: validate(boardRemoveSchema, (client, msg) => {
      const c = client as OfficeClient;
      const note = services().boards.find(msg.noteId);
      if (!c.auth || !note || !this.boardFurni(note.furniId)) return;
      if (note.userId !== c.auth.id && c.auth.role !== 'admin') {
        return this.sendError(
          c,
          ErrorCode.Forbidden,
          'Só quem escreveu (ou um admin) tira o recado.',
        );
      }
      services().boards.remove(note.id);
      this.broadcast(ServerMessage.BoardChanged, { furniId: note.furniId });
    }),
    [ClientMessage.WbLoad]: (client: Client, input: unknown) => {
      const p = wbRefSchema.safeParse(input);
      return p.success && this.isWhiteboard(p.data.furniId)
        ? services().whiteboards.list(p.data.furniId)
        : [];
    },
    [ClientMessage.WbStroke]: validate(wbStrokeSchema, (client, msg) => {
      const c = client as OfficeClient;
      if (!c.auth || !this.isWhiteboard(msg.furniId)) return;
      if (!this.wbLimiter.tryTake(c.sessionId)) return this.sendError(c, ErrorCode.RateLimit);
      if (services().whiteboards.count(msg.furniId) >= WB_MAX_STROKES) {
        return this.sendError(
          c,
          ErrorCode.Forbidden,
          'O quadro está cheio. Limpe antes de continuar.',
        );
      }
      const stroke = services().whiteboards.add(msg.furniId, c.auth.id, msg.stroke);
      services().achievements.unlock(c.auth.id, 'artist');
      this.broadcast(ServerMessage.WbStroke, {
        furniId: msg.furniId,
        stroke,
        draftId: msg.draftId,
        sessionId: c.sessionId,
      } satisfies WbStrokeMessage);
    }),
    [ClientMessage.WbDraft]: validate(wbDraftSchema, (client, msg) => {
      // Prévia efêmera: excesso é descartado em silêncio.
      if (!this.isWhiteboard(msg.furniId) || !this.draftLimiter.tryTake(client.sessionId)) return;
      this.broadcast(
        ServerMessage.WbDraft,
        { ...msg, sessionId: client.sessionId } satisfies WbDraft,
        { except: client },
      );
    }),
    [ClientMessage.WbUndo]: validate(wbRefSchema, (client, msg) => {
      const c = client as OfficeClient;
      if (!c.auth || !this.isWhiteboard(msg.furniId)) return;
      if (!this.wbLimiter.tryTake(c.sessionId)) return;
      const id = services().whiteboards.undo(msg.furniId, c.auth.id);
      if (id !== null) {
        this.broadcast(ServerMessage.WbRemoved, {
          furniId: msg.furniId,
          ids: [id],
        } satisfies WbRemovedMessage);
      }
    }),
    [ClientMessage.WbClear]: validate(wbRefSchema, (client, msg) => {
      const c = client as OfficeClient;
      if (!c.auth || !this.isWhiteboard(msg.furniId)) return;
      services().whiteboards.clear(msg.furniId);
      this.broadcast(ServerMessage.WbCleared, { furniId: msg.furniId });
    }),
    [ClientMessage.FocusStart]: validate(focusStartSchema, (client, msg) => {
      const c = client as OfficeClient;
      if (!c.auth || !this.statusLimiter.tryTake(c.sessionId)) return;
      services().focus.start(c.auth.id, msg.minutes, msg.breakMinutes);
    }),
    [ClientMessage.FocusStop]: (client: Client) => {
      const c = client as OfficeClient;
      if (c.auth) services().focus.stop(c.auth.id);
    },
    [ClientMessage.PollCreate]: validate(pollCreateSchema, (client, msg) =>
      this.createPoll(client as OfficeClient, msg),
    ),
    [ClientMessage.PollVote]: validate(pollVoteSchema, (client, msg) => {
      const c = client as OfficeClient;
      const poll = services().polls.find(msg.pollId);
      if (!c.auth || !poll || poll.roomId !== this.layout.roomId) return;
      if (!this.reactLimiter.tryTake(c.sessionId)) return this.sendError(c, ErrorCode.RateLimit);
      const problem = services().polls.vote(msg.pollId, c.auth.id, msg.option);
      if (problem) return this.sendError(c, ErrorCode.Forbidden, problem);
      this.broadcastPoll(msg.pollId);
    }),
    [ClientMessage.PollClose]: validate(pollRefSchema, (client, msg) => {
      const c = client as OfficeClient;
      const poll = services().polls.find(msg.pollId);
      if (!c.auth || !poll || poll.roomId !== this.layout.roomId) return;
      if (poll.createdBy !== c.auth.id && c.auth.role !== 'admin') {
        return this.sendError(c, ErrorCode.Forbidden, 'Só quem criou (ou um admin) encerra.');
      }
      services().polls.close(msg.pollId);
      this.broadcastPoll(msg.pollId);
    }),
    [ClientMessage.TttJoin]: validate(tttRefSchema, (client, msg) =>
      this.handleTttJoin(client as OfficeClient, msg.furniId),
    ),
    [ClientMessage.TttLeave]: validate(tttRefSchema, (client, msg) => {
      if (!this.isGameTable(msg.furniId)) return;
      this.leaveGame(msg.furniId, client.sessionId);
    }),
    [ClientMessage.TttMove]: validate(tttMoveSchema, (client, msg) => {
      const c = client as OfficeClient;
      const game = this.state.games.get(msg.furniId);
      if (!game || !this.gameLimiter.tryTake(c.sessionId)) return;
      const res = ttt.play(game, c.sessionId, msg.cell);
      if (!res.ok) return this.sendError(c, ErrorCode.Forbidden, res.reason);
      if (res.outcome) this.finishGame(game, res.outcome);
    }),
    [ClientMessage.TttRematch]: validate(tttRefSchema, (client, msg) => {
      const c = client as OfficeClient;
      const game = this.state.games.get(msg.furniId);
      if (!game || !this.gameLimiter.tryTake(c.sessionId)) return;
      const res = ttt.rematch(game, c.sessionId);
      if (!res.ok) this.sendError(c, ErrorCode.Forbidden, res.reason);
    }),
    [ClientMessage.TttScores]: (client: Client, input: unknown): TttScores => {
      const p = tttRefSchema.safeParse(input);
      const game = p.success ? this.state.games.get(p.data.furniId) : undefined;
      const ids = game ? [game.xUser, game.oUser].filter(Boolean) : [];
      return {
        top: services().games.top(TTT_GAME, TTT_TOP),
        players: services().games.of(TTT_GAME, ids),
      };
    },
    [ClientMessage.ChatReact]: validate(reactSchema, (client, msg) =>
      this.handleReact(client as OfficeClient, msg.id, msg.emoji),
    ),
    [ClientMessage.ChatDelete]: validate(chatDeleteSchema, (client, msg) =>
      this.handleChatDelete(client as OfficeClient, msg.id),
    ),
    [ClientMessage.Interact]: validate(furniRefSchema, (client, msg) =>
      this.handleInteract(client as OfficeClient, msg.furniId),
    ),
  };

  /** Perfil mudou (nome, cargo, papel…): atualiza os avatares dessa pessoa nesta sala. */
  private readonly onUserUpdated = (user: UserRow): void => {
    const profile = services().users.publicProfile(user);
    for (const p of this.state.players.values()) {
      if (p.userId === user.id) Object.assign(p, profile);
    }
    for (const c of this.clients) if (c.auth?.id === user.id) c.auth = user;
    services().presence.rename(user.id, user.name);
    this.pets.ownerRenamed(user.id, user.name);
  };

  /** Admin tirou alguém: da sala (vai para a Recepção) ou do escritório (desconecta). */
  private readonly onKick = ({ userId, scope, roomId, byName }: ModerationEvents['kick'][0]) => {
    if (scope === 'room' && roomId !== this.layout.roomId) return;
    for (const client of this.clients) {
      if (client.auth?.id !== userId) continue;
      if (scope === 'room') {
        const spawn = services().rooms.getLayout(RECEPTION.id)!.spawn;
        const ticket = services().transfers.issue({ userId, roomId: RECEPTION.id, ...spawn });
        client.send(ServerMessage.Kicked, {
          scope,
          message: `${byName} tirou você da sala.`,
        } satisfies KickedMessage);
        client.send(ServerMessage.RoomTransfer, {
          targetRoomId: RECEPTION.id,
          ticket,
        } satisfies RoomTransferMessage);
      } else {
        client.send(ServerMessage.Kicked, {
          scope,
          message: `${byName} tirou você do escritório.`,
        } satisfies KickedMessage);
        // Saída consentida: vai direto para onLeave, sem esperar reconexão.
        client.leave(CloseCode.CONSENTED);
      }
    }
    // Avatares "fantasma" (reconectando) dessa pessoa também saem.
    if (scope === 'office') {
      for (const [sessionId, p] of this.state.players.entries()) {
        if (p.userId === userId && p.away) this.pendingReconnects.get(sessionId)?.reject(false);
      }
    }
  };

  /** Atividade de alguém mudou (VS Code…): atualiza o texto dos avatares dessa pessoa. */
  private readonly onActivity = (userId: string): void => {
    const text = services().activity.text(userId);
    const url = services().activity.url(userId);
    for (const p of this.state.players.values()) {
      if (p.userId === userId) Object.assign(p, { activity: text, activityUrl: url });
    }
  };

  /** Foco de alguém mudou: atualiza o 🍅 dos avatares e avisa a própria pessoa da fase nova. */
  private readonly onFocus = (
    userId: string,
    state: { kind: string; until: number } | null,
    finished: boolean,
  ): void => {
    for (const p of this.state.players.values()) {
      if (p.userId !== userId) continue;
      p.focusUntil = state?.until ?? 0;
      p.focusKind = state?.kind ?? '';
    }
    // Terminou um ciclo de foco (foi para a pausa ou acabou): medalha.
    if (finished && state?.kind !== 'focus') this.celebrate(userId, 'focus');
    for (const c of this.clients) {
      if (c.auth?.id !== userId) continue;
      c.send(ServerMessage.FocusPhase, {
        kind: (state?.kind as FocusPhase['kind']) ?? null,
        until: state?.until ?? 0,
        finished,
      } satisfies FocusPhase);
    }
  };

  /** Pet adotado, editado ou solto: aparece, muda ou some nesta sala. */
  private readonly onPetChanged = (userId: string, pet: PetInfo | null): void => {
    const session = this.state.pets.get(userId)?.ownerSession ?? this.sessionOf(userId);
    const player = session ? this.state.players.get(session) : undefined;
    if (!session || !player) return;
    this.pets.set(userId, pet, session, player.name);
  };

  private sessionOf(userId: string): string | null {
    for (const [id, p] of this.state.players.entries()) if (p.userId === userId) return id;
    return null;
  }

  private readonly onRoomSettings = ({ roomId, decorLocked }: ModerationEvents['room'][0]) => {
    if (roomId === this.layout.roomId) this.state.decorLocked = decorLocked;
  };

  /** A sala foi editada (formato, portas, nome): recarrega e avisa os clientes. */
  private readonly onLayout = ({ roomId }: ModerationEvents['layout'][0]): void => {
    if (roomId !== this.layout.roomId) return;
    const layout = services().rooms.getLayout(roomId);
    if (!layout) return; // excluída (só acontece vazia)
    this.layout = layout;
    this.map = parseHeightmap(layout.heightmap);
    // Móveis que saíram na edição somem do estado.
    const kept = new Set(
      services()
        .furni.list(roomId)
        .map((f) => f.id),
    );
    for (const id of [...this.state.furni.keys()]) {
      if (kept.has(id)) continue;
      this.state.furni.delete(id);
      this.state.games.delete(id);
    }
    // Quem ficou fora do piso (ou numa porta) volta para perto da entrada.
    for (const [sessionId, p] of this.state.players.entries()) {
      const onDoor = layout.doors.some((d) => d.x === p.x && d.y === p.y);
      if (!onDoor && this.gridFor(sessionId).isWalkable(p.x, p.y, true)) continue;
      this.movement.remove(sessionId);
      this.pendingSit.delete(sessionId);
      const t = this.freeTileNear(layout.spawn);
      Object.assign(p, {
        x: t.x,
        y: t.y,
        nextX: t.x,
        nextY: t.y,
        z: this.gridFor(sessionId).heightAt(t.x, t.y),
        action: 'idle',
        dir: layout.spawn.dir,
      });
    }
    // Pets voltam para perto do dono (o piso pode ter mudado).
    for (const [userId, pet] of [...this.state.pets.entries()]) {
      const info = services().pets.get(userId);
      const owner = pet.ownerSession;
      const name = pet.ownerName;
      this.pets.remove(userId);
      this.pets.set(userId, info, owner, name);
    }
    this.broadcast(ServerMessage.LayoutChanged, {});
  };

  override onCreate(options: { officeRoomId: string }): void {
    const layout = services().rooms.getLayout(options.officeRoomId);
    if (!layout) throw new ServerError(404, `Sala inexistente: ${options.officeRoomId}`);
    this.layout = layout;
    this.map = parseHeightmap(layout.heightmap);
    this.movement = new MovementSystem(
      (id) => this.gridFor(id),
      (id, m) => this.onStepEnd(id, m),
    );
    this.state = new OfficeState();
    this.state.roomId = layout.roomId;
    this.state.decorLocked = services().rooms.isDecorLocked(layout.roomId);
    for (const f of services().furni.list(layout.roomId)) this.state.furni.set(f.id, toFurni(f));
    this.pets = new PetKeeper({
      pets: this.state.pets,
      grid: (id) => this.petGrid(id),
      owner: (sessionId) => {
        const p = this.state.players.get(sessionId);
        if (!p) return null;
        const dest = this.movement.destinationOf(sessionId, p);
        const walking = p.nextX !== p.x || p.nextY !== p.y || dest.x !== p.x || dest.y !== p.y;
        return { tile: { x: p.x, y: p.y }, dest, walking };
      },
      now: () => Date.now(),
      random: Math.random,
    });
    this.setSimulationInterval((dt) => {
      this.movement.tick(dt, this.state.players.entries());
      this.pets.tick(dt);
    }, TICK_MS);
    services().users.events.on('updated', this.onUserUpdated);
    services().moderation.on('kick', this.onKick);
    services().moderation.on('room', this.onRoomSettings);
    services().moderation.on('layout', this.onLayout);
    services().pets.events.on('changed', this.onPetChanged);
    services().activity.events.on('changed', this.onActivity);
    services().focus.events.on('changed', this.onFocus);
    services().achievements.events.on('unlocked', this.onAchievement);
    services().kudos.events.on('given', this.onKudos);
  }

  override onDispose(): void {
    services().users.events.off('updated', this.onUserUpdated);
    services().moderation.off('kick', this.onKick);
    services().moderation.off('room', this.onRoomSettings);
    services().moderation.off('layout', this.onLayout);
    services().pets.events.off('changed', this.onPetChanged);
    services().activity.events.off('changed', this.onActivity);
    services().focus.events.off('changed', this.onFocus);
    services().achievements.events.off('unlocked', this.onAchievement);
    services().kudos.events.off('given', this.onKudos);
    for (const t of this.handTimers.values()) t.clear();
  }

  override onAuth(_client: Client, options: unknown): UserRow {
    const parsed = joinOptionsSchema.safeParse(options);
    const user = parsed.success ? services().users.findByToken(parsed.data.token) : undefined;
    if (!user) throw new ServerError(401, ERROR_MESSAGES.INVALID_SESSION);
    return user;
  }

  override onJoin(client: OfficeClient, options?: unknown): void {
    const user = client.auth;
    if (!user) throw new ServerError(401, ERROR_MESSAGES.INVALID_SESSION);
    // Recarregou a página ou abriu de novo: o avatar "fantasma" da conexão antiga sai já,
    // em vez de esperar o prazo de reconexão.
    for (const [sessionId, p] of this.state.players.entries()) {
      if (p.userId === user.id && p.away) this.pendingReconnects.get(sessionId)?.reject(false);
    }
    // Veio por uma porta: nasce do lado de dentro da porta correspondente.
    const parsed = joinOptionsSchema.safeParse(options);
    const via = services().transfers.consume(
      parsed.success ? parsed.data.ticket : undefined,
      user.id,
      this.layout.roomId,
    );
    const spawn = this.freeTileNear(via ?? this.layout.spawn);
    const player = new Player();
    Object.assign(player, {
      userId: user.id,
      ...services().users.publicProfile(user),
      figure: user.figure,
      x: spawn.x,
      y: spawn.y,
      nextX: spawn.x,
      nextY: spawn.y,
      z: this.gridFor(client.sessionId).heightAt(spawn.x, spawn.y),
      dir: via?.dir ?? this.layout.spawn.dir,
      action: 'idle',
      away: false,
      status: 'available',
      typing: false,
      activity: services().activity.text(user.id),
      activityUrl: services().activity.url(user.id),
      focusUntil: services().focus.get(user.id)?.until ?? 0,
      focusKind: services().focus.get(user.id)?.kind ?? '',
    });
    this.state.players.set(client.sessionId, player);
    // O item na mão vai junto de sala em sala, até vencer.
    const held = HELD.get(user.id);
    if (held && held.until > Date.now()) this.giveHandItem(client.sessionId, held.item, held.until);
    // Aniversário: corações na primeira entrada do dia.
    const today = new Date().toISOString().slice(0, 10);
    if (player.birthday && !BIRTHDAY_SHOWN.has(`${user.id}:${today}`)) {
      BIRTHDAY_SHOWN.add(`${user.id}:${today}`);
      this.clock.setTimeout(() => this.celebrate(user.id, 'birthday'), 1500);
    }
    const pet = services().pets.get(user.id);
    if (pet && !this.state.pets.has(user.id)) {
      this.pets.set(user.id, pet, client.sessionId, player.name);
    }
    services().presence.add({
      sessionId: client.sessionId,
      userId: user.id,
      name: user.name,
      roomId: this.layout.roomId,
    });
    services().users.touch(user.id);
    services().achievements.visit(user.id, this.layout.roomId);
    console.log(
      `[sala ${this.layout.roomId}] ${user.name} entrou (${this.state.players.size} na sala)`,
    );
  }

  override onDrop(client: OfficeClient): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.away = true;
      player.typing = false;
    }
    // Sem `await`: se o prazo vencer ou a reconexão for cancelada, o Colyseus chama onLeave.
    const reconnection = this.allowReconnection(client, RECONNECT_SECONDS);
    this.pendingReconnects.set(client.sessionId, reconnection);
    reconnection.catch(() => undefined);
  }

  override onReconnect(client: OfficeClient): void {
    this.pendingReconnects.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) player.away = false;
  }

  override onLeave(client: OfficeClient): void {
    this.pendingReconnects.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movement.remove(client.sessionId);
    this.moveLimiter.delete(client.sessionId);
    this.avatarLimiter.delete(client.sessionId);
    this.chatLimiter.delete(client.sessionId);
    this.editLimiter.delete(client.sessionId);
    this.statusLimiter.delete(client.sessionId);
    this.typingLimiter.delete(client.sessionId);
    this.emoteLimiter.delete(client.sessionId);
    this.reactLimiter.delete(client.sessionId);
    this.useLimiter.delete(client.sessionId);
    this.boardLimiter.delete(client.sessionId);
    this.wbLimiter.delete(client.sessionId);
    this.draftLimiter.delete(client.sessionId);
    this.gameLimiter.delete(client.sessionId);
    this.pendingUse.delete(client.sessionId);
    this.pendingSit.delete(client.sessionId);
    this.handTimers.get(client.sessionId)?.clear();
    this.handTimers.delete(client.sessionId);
    for (const furniId of [...this.state.games.keys()]) this.leaveGame(furniId, client.sessionId);
    this.pets.ownerLeft(client.sessionId, (userId) => this.sessionOf(userId));
    services().presence.remove(client.sessionId);
    if (client.auth) {
      services().users.touch(client.auth.id);
      console.log(
        `[sala ${this.layout.roomId}] ${client.auth.name} saiu (${this.state.players.size} na sala)`,
      );
    }
  }

  /** Terminou um passo: chegou na cadeira (senta) ou numa porta (troca de sala). */
  private onStepEnd(sessionId: string, m: Mover): boolean {
    const sit = this.pendingSit.get(sessionId);
    if (sit && sit.seat.x === m.x && sit.seat.y === m.y) {
      this.sitDown(sessionId, sit.furniId);
      return true;
    }
    const use = this.pendingUse.get(sessionId);
    if (use && use.at.x === m.x && use.at.y === m.y) {
      this.pendingUse.delete(sessionId);
      this.useFurni(sessionId, use.furniId);
      return true;
    }
    const door = this.layout.doors.find((d) => d.x === m.x && d.y === m.y);
    const client = door && this.clients.getById(sessionId);
    if (!door || !client?.auth) return false;
    const ticket = services().transfers.issue({
      userId: client.auth.id,
      roomId: door.targetRoomId,
      x: door.targetX,
      y: door.targetY,
      dir: door.targetDir,
    });
    client.send(ServerMessage.RoomTransfer, {
      targetRoomId: door.targetRoomId,
      ticket,
    } satisfies RoomTransferMessage);
    return true;
  }

  private handleMove(client: OfficeClient, msg: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!this.moveLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
    this.pendingSit.delete(client.sessionId);
    this.pendingUse.delete(client.sessionId);
    // Sentado no chão, clicar num tile do lado só vira para lá (como no Habbo).
    if (
      player.action === 'sit' &&
      !this.onSeat(client.sessionId, player) &&
      Math.max(Math.abs(msg.x - player.x), Math.abs(msg.y - player.y)) === 1
    ) {
      player.dir = sitDirection(directionBetween(player, msg, player.dir));
      return;
    }
    const res = this.movement.request(client.sessionId, player, msg);
    if (!res.ok) this.sendError(client, ErrorCode.InvalidMove);
  }

  // ---------- Sentar ----------

  /** Clique num assento: anda até o lugar livre mais perto e senta virado como o móvel. */
  private handleInteract(client: OfficeClient, furniId: string): void {
    const player = this.state.players.get(client.sessionId);
    const f = this.state.furni.get(furniId);
    const def = f && services().furniDefs.get(f.defId);
    if (!player || !f || !def) return;
    if (
      def.interaction === 'toggle' ||
      def.interaction === 'coffee' ||
      def.interaction === 'fridge' ||
      def.interaction === 'dice' ||
      def.interaction === 'teleport' ||
      def.interaction === 'jukebox'
    ) {
      return this.handleUse(client, player, f, def);
    }
    if (!def.canSit && !def.canLay) return;
    if (!this.moveLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
    const from =
      player.nextX !== player.x || player.nextY !== player.y
        ? { x: player.nextX, y: player.nextY }
        : player;
    // O lugar livre mais perto (sofá de dois lugares, cama de casal…).
    const seat = nearestFreeSeat(seatTiles(def, f), from, (t) =>
      this.isTileTaken(t, client.sessionId),
    );
    if (!seat) {
      return this.sendError(
        client,
        ErrorCode.InvalidMove,
        def.canLay ? 'A cama está ocupada.' : 'Esse lugar está ocupado.',
      );
    }
    this.pendingSit.set(client.sessionId, { furniId, seat });
    if (
      player.x === seat.x &&
      player.y === seat.y &&
      player.nextX === player.x &&
      player.nextY === player.y
    ) {
      return this.sitDown(client.sessionId, furniId);
    }
    const res = this.movement.request(client.sessionId, player, seat);
    if (!res.ok || res.dest.x !== seat.x || res.dest.y !== seat.y) {
      this.pendingSit.delete(client.sessionId);
      this.movement.remove(client.sessionId);
      this.sendError(client, ErrorCode.InvalidMove, 'Não dá para chegar nesse lugar.');
    }
  }

  /** O móvel é um quadro branco desta sala? */
  private isWhiteboard(furniId: string): boolean {
    const f = this.state.furni.get(furniId);
    return Boolean(f && services().furniDefs.get(f.defId)?.interaction === 'whiteboard');
  }

  /** O móvel é um mural desta sala? */
  private boardFurni(furniId: string): boolean {
    const f = this.state.furni.get(furniId);
    return Boolean(f && services().furniDefs.get(f.defId)?.interaction === 'board');
  }

  // ---------- Usar (luz, TV, café…) ----------

  /** Do lado do móvel: usa já. Longe: anda até o tile livre encostado mais perto e usa ao chegar. */
  private handleUse(client: OfficeClient, player: Player, f: Furni, def: FurniManifestEntry): void {
    if (!this.useLimiter.tryTake(client.sessionId)) {
      return this.sendError(client, ErrorCode.RateLimit);
    }
    this.pendingSit.delete(client.sessionId);
    const fp = footprint(def, f.x, f.y, f.rot);
    const walking = player.nextX !== player.x || player.nextY !== player.y;
    if (!walking && touches(fp, player)) return this.useFurni(client.sessionId, f.id);

    const at = this.walkNextTo(client.sessionId, player, fp);
    if (at) this.pendingUse.set(client.sessionId, { furniId: f.id, at });
    else this.sendError(client, ErrorCode.InvalidMove, 'Não dá para chegar perto desse móvel.');
  }

  /** Anda até o tile livre encostado no footprint mais perto (devolve o destino ou `null`). */
  private walkNextTo(
    sessionId: string,
    player: Player,
    fp: { minX: number; minY: number; maxX: number; maxY: number },
  ): TilePoint | null {
    const walking = player.nextX !== player.x || player.nextY !== player.y;
    const from = walking ? { x: player.nextX, y: player.nextY } : player;
    const grid = this.gridFor(sessionId);
    const candidates: TilePoint[] = [];
    for (let y = fp.minY - 1; y <= fp.maxY + 1; y++) {
      for (let x = fp.minX - 1; x <= fp.maxX + 1; x++) {
        const t = { x, y };
        const isDoor = this.layout.doors.some((d) => d.x === x && d.y === y);
        if (touches(fp, t) && !isDoor && grid.isWalkable(x, y, true)) candidates.push(t);
      }
    }
    candidates.sort(
      (a, b) =>
        Math.max(Math.abs(a.x - from.x), Math.abs(a.y - from.y)) -
        Math.max(Math.abs(b.x - from.x), Math.abs(b.y - from.y)),
    );
    for (const at of candidates) {
      const res = this.movement.request(sessionId, player, at);
      if (res.ok && res.dest.x === at.x && res.dest.y === at.y) return at;
    }
    this.movement.remove(sessionId);
    return null;
  }

  private useFurni(sessionId: string, furniId: string): void {
    const player = this.state.players.get(sessionId);
    const f = this.state.furni.get(furniId);
    const def = f && services().furniDefs.get(f.defId);
    if (!player || !f || !def) return;
    player.dir = faceTowards(player, footprint(def, f.x, f.y, f.rot));
    if (def.interaction === 'toggle' && def.states.length > 1) {
      // Próximo estado da lista (0 → 1 → … → 0).
      const i = def.states.indexOf(f.state);
      f.state = def.states[(i + 1) % def.states.length]!;
      services().furni.setState(this.layout.roomId, f.id, f.state);
    } else if (def.interaction === 'dice') {
      this.rollDice(sessionId, f);
    } else if (def.interaction === 'jukebox') {
      // Liga/desliga a música da sala (cada navegador toca, para quem tem o som ligado).
      f.state = f.state > 0 ? 0 : (def.states.find((s) => s > 0) ?? 1);
      services().furni.setState(this.layout.roomId, f.id, f.state);
    } else if (def.interaction === 'teleport') {
      this.teleport(sessionId, f, def);
    } else if (def.interaction === 'fridge') {
      // Abre a porta por um instante e entrega uma bebida sorteada.
      if (def.states.includes(1)) {
        f.state = 1;
        this.clock.setTimeout(() => {
          if (this.state.furni.get(furniId) === f) f.state = 0;
        }, 2000);
      }
      const drink = FRIDGE_ITEMS[Math.floor(Math.random() * FRIDGE_ITEMS.length)]!;
      this.giveHandItem(sessionId, drink);
    } else if (def.interaction === 'coffee') {
      // Uma xícara na mão (o avatar segura e dá uns goles).
      this.giveHandItem(sessionId, COFFEE_ITEM);
      if (player.userId) services().achievements.unlock(player.userId, 'coffee');
      // A máquina "trabalha" por um instante, se tiver estado para isso.
      if (def.states.includes(1)) {
        f.state = 1;
        this.clock.setTimeout(() => {
          if (this.state.furni.get(furniId) === f) f.state = 0;
        }, 2500);
      }
    }
  }

  /** Dado do Habbo: rola (animação) por um instante e para num número sorteado pelo servidor. */
  private rollDice(sessionId: string, f: Furni): void {
    if (f.state === DICE_ROLLING_STATE) return;
    const client = this.clients.getById(sessionId) as OfficeClient | undefined;
    f.state = DICE_ROLLING_STATE;
    this.clock.setTimeout(() => {
      if (this.state.furni.get(f.id) !== f) return;
      const roll = randomInt(1, 7);
      f.state = roll;
      services().furni.setState(this.layout.roomId, f.id, roll);
      if (!client?.auth) return;
      const message = services().chat.add(
        this.layout.roomId,
        client.auth,
        quickCommandText('dice', roll),
        sessionId,
        undefined,
        'dice',
        null,
      );
      this.broadcast(ServerMessage.Chat, message);
      if (roll === 6) services().achievements.unlock(client.auth.id, 'lucky');
    }, DICE_ROLL_MS);
  }

  /**
   * Teleporte: a porta abre, a pessoa some e aparece do lado do teleporte ligado (na mesma sala
   * ou em outra, como passar por uma porta).
   */
  private teleport(sessionId: string, f: Furni, def: FurniManifestEntry): void {
    const client = this.clients.getById(sessionId) as OfficeClient | undefined;
    if (!client?.auth) return;
    const targetId = services().furni.linkedTo(f.id);
    const target = targetId ? services().furni.locate(targetId) : undefined;
    if (!target) {
      return this.sendError(
        client,
        ErrorCode.InvalidMove,
        'Este teleporte não está ligado a nenhum outro. Ligue os dois no Decorar.',
      );
    }
    const open = (furni: Furni | undefined, d: FurniManifestEntry | undefined) => {
      if (!furni || !d?.states.includes(1)) return;
      furni.state = 1;
      this.clock.setTimeout(() => {
        if (this.state.furni.get(furni.id) === furni) furni.state = 0;
      }, TELEPORT_MS * 2);
    };
    open(f, def);
    this.clock.setTimeout(() => {
      const player = this.state.players.get(sessionId);
      if (!player) return;
      if (target.roomId === this.layout.roomId) {
        const there = this.state.furni.get(target.id);
        open(there, there && services().furniDefs.get(there.defId));
        const spot = this.freeTileNear({ x: target.x, y: target.y });
        this.movement.remove(sessionId);
        this.pendingSit.delete(sessionId);
        Object.assign(player, {
          x: spot.x,
          y: spot.y,
          nextX: spot.x,
          nextY: spot.y,
          action: 'idle',
          z: this.gridFor(sessionId).heightAt(spot.x, spot.y),
        });
        return;
      }
      const ticket = services().transfers.issue({
        userId: client.auth!.id,
        roomId: target.roomId,
        x: target.x,
        y: target.y,
        dir: player.dir,
      });
      client.send(ServerMessage.RoomTransfer, {
        targetRoomId: target.roomId,
        ticket,
      } satisfies RoomTransferMessage);
    }, TELEPORT_MS);
  }

  private sitDown(sessionId: string, furniId: string): void {
    this.pendingSit.delete(sessionId);
    const player = this.state.players.get(sessionId);
    const f = this.state.furni.get(furniId);
    const def = f && services().furniDefs.get(f.defId);
    if (!player || !f || !def) return;
    // Cama: deita no comprimento, cabeça na cabeceira; cadeira e sofá: senta virado como o móvel.
    player.action = def.canLay ? 'lay' : 'sit';
    player.dir = def.canLay ? bedDirection(f.rot) : f.rot;
    player.z = f.z + def.sitHeight;
  }

  /** Está num assento (cadeira, sofá, cama)? Fora disso, sentado/deitado é no chão. */
  private onSeat(sessionId: string, at: TilePoint): boolean {
    return Boolean(this.gridFor(sessionId).tile(at.x, at.y)?.seat);
  }

  /** `/sentar`, `/deitar` (no chão, onde está) e `/levantar`. */
  private handlePosture(client: OfficeClient, posture: Posture): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.moveLimiter.tryTake(client.sessionId)) return;
    // Andando, primeiro chega (o comando vale parado).
    if (player.nextX !== player.x || player.nextY !== player.y) return;
    this.pendingSit.delete(client.sessionId);
    const floor = this.gridFor(client.sessionId).heightAt(player.x, player.y);
    if (posture === 'stand') {
      if (player.action !== 'sit' && player.action !== 'lay') return;
      player.action = 'idle';
      player.z = floor;
      return;
    }
    // Em cima de um assento vale o assento (cadeira senta, cama deita); no chão, a pose pedida.
    if (this.onSeat(client.sessionId, player)) return;
    player.action = posture;
    player.dir = posture === 'sit' ? sitDirection(player.dir) : layDirection(player.dir);
    player.z = floor;
  }

  // ---------- Item na mão e comemorações (Fase 34) ----------

  private readonly handTimers = new Map<string, { clear(): void }>();

  /** Põe um item na mão (some sozinho em `HAND_ITEM_MS`, ou com `/largar`). */
  private giveHandItem(sessionId: string, item: number, until = Date.now() + HAND_ITEM_MS): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.handItem = item;
    HELD.set(player.userId, { item, until });
    this.handTimers.get(sessionId)?.clear();
    this.handTimers.set(
      sessionId,
      this.clock.setTimeout(() => this.dropHandItem(sessionId), Math.max(0, until - Date.now())),
    );
  }

  private dropHandItem(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.handItem = 0;
    HELD.delete(player.userId);
    this.handTimers.get(sessionId)?.clear();
    this.handTimers.delete(sessionId);
  }

  /** Efeito por alguns segundos sobre a pessoa (se ela estiver nesta sala). */
  private celebrate(userId: string, why: keyof typeof CELEBRATIONS): void {
    const session = this.sessionOf(userId);
    if (!session) return;
    const { effect, ms } = CELEBRATIONS[why];
    this.broadcast(ServerMessage.EffectFlash, {
      sessionId: session,
      effect,
      ms,
    } satisfies EffectFlash);
  }

  private readonly onAchievement = (userId: string): void => this.celebrate(userId, 'achievement');
  private readonly onKudos = (k: { toUserId: string }): void => this.celebrate(k.toUserId, 'kudos');

  /** Virar sem sair do lugar: parado (8 direções) ou sentado no chão (4). */
  private handleTurn(client: OfficeClient, dir: number): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.moveLimiter.tryTake(client.sessionId)) return;
    if (player.nextX !== player.x || player.nextY !== player.y) return;
    if (player.action === 'idle') player.dir = dir;
    else if (player.action === 'sit' && !this.onSeat(client.sessionId, player)) {
      player.dir = sitDirection(dir);
    }
  }

  // ---------- Enquetes ----------

  /** Cria a enquete como mensagem do chat (cada pessoa recebe com o próprio voto). */
  private createPoll(client: OfficeClient, data: Required<PollCreate>, limit = true): void {
    if (!client.auth || !this.state.players.has(client.sessionId)) return;
    if (limit && !this.chatLimiter.tryTake(client.sessionId)) {
      return this.sendError(client, ErrorCode.RateLimit);
    }
    const message = services().chat.add(
      this.layout.roomId,
      client.auth,
      `📊 Enquete: ${data.question}`,
      client.sessionId,
      undefined,
      'poll',
    );
    const poll = services().polls.create(message.id, this.layout.roomId, client.auth.id, data);
    for (const c of this.clients) {
      c.send(ServerMessage.Chat, {
        ...message,
        poll: services().polls.view(poll.id, c.auth?.id ?? '') ?? undefined,
      } satisfies ChatMessage);
    }
    services().achievements.bump(client.auth.id, 'chat');
  }

  private broadcastPoll(pollId: number): void {
    for (const c of this.clients) {
      const poll = services().polls.view(pollId, c.auth?.id ?? '');
      if (poll) c.send(ServerMessage.PollUpdated, { poll } satisfies PollUpdated);
    }
  }

  /** Junta as enquetes às mensagens do histórico (com o voto de quem pediu). */
  private withPolls(messages: ChatMessage[], viewerId: string): ChatMessage[] {
    const ids = messages.filter((m) => m.kind === 'poll').map((m) => m.id);
    const views = services().polls.forMessages(ids, viewerId);
    return messages.map((m) => (views.has(m.id) ? { ...m, poll: views.get(m.id) } : m));
  }

  // ---------- Jogo da velha ----------

  private isGameTable(furniId: string): boolean {
    const f = this.state.furni.get(furniId);
    return Boolean(f && services().furniDefs.get(f.defId)?.interaction === 'tictactoe');
  }

  /** Pega um lugar na mesa e senta na cadeira livre encostada nela mais perto (se houver). */
  private handleTttJoin(client: OfficeClient, furniId: string): void {
    const player = this.state.players.get(client.sessionId);
    if (!client.auth || !player || !this.isGameTable(furniId)) return;
    if (!this.gameLimiter.tryTake(client.sessionId)) {
      return this.sendError(client, ErrorCode.RateLimit);
    }
    for (const [id, g] of this.state.games.entries()) {
      if (id !== furniId && ttt.markOf(g, client.sessionId)) {
        return this.sendError(client, ErrorCode.Forbidden, 'Você já está em outra mesa.');
      }
    }
    const game = this.state.games.get(furniId) ?? ttt.newGame();
    const res = ttt.join(game, {
      session: client.sessionId,
      user: client.auth.id,
      name: player.name,
    });
    if (!res.ok) return this.sendError(client, ErrorCode.Forbidden, res.reason);
    if (!this.state.games.has(furniId)) this.state.games.set(furniId, game);
    // Senta numa cadeira encostada na mesa; sem cadeira livre, fica em pé do lado.
    const chair = this.chairNear(furniId, player, client.sessionId);
    if (chair) return this.handleInteract(client, chair);
    const table = this.state.furni.get(furniId)!;
    const def = services().furniDefs.get(table.defId)!;
    const fp = footprint(def, table.x, table.y, table.rot);
    if (!touches(fp, player)) this.walkNextTo(client.sessionId, player, fp);
  }

  /** Cadeira encostada na mesa, com lugar livre, mais perto de quem vai sentar. */
  private chairNear(tableId: string, from: TilePoint, sessionId: string): string | null {
    const table = this.state.furni.get(tableId)!;
    const tdef = services().furniDefs.get(table.defId)!;
    const tfp = footprint(tdef, table.x, table.y, table.rot);
    let best: { id: string; d: number } | null = null;
    for (const f of this.state.furni.values()) {
      const def = services().furniDefs.get(f.defId);
      if (!def?.canSit) continue;
      const seat = nearestFreeSeat(
        seatTiles(def, f).filter((t) => touches(tfp, t)),
        from,
        (t) => this.isTileTaken(t, sessionId),
      );
      if (!seat) continue;
      const d = Math.max(Math.abs(seat.x - from.x), Math.abs(seat.y - from.y));
      if (!best || d < best.d) best = { id: f.id, d };
    }
    return best?.id ?? null;
  }

  /** Sai da mesa (botão ou saiu da sala). No meio da partida, o outro vence. */
  private leaveGame(furniId: string, sessionId: string): void {
    const game = this.state.games.get(furniId);
    if (!game) return;
    const res = ttt.leave(game, sessionId);
    if (!res) return;
    if (res.forfeitTo) {
      services().games.recordWin(TTT_GAME, res.forfeitTo.user, res.left.user);
      services().achievements.bump(res.forfeitTo.user, 'tttWins');
      this.gameChat(res.forfeitTo, `🏆 venceu ${res.left.name} no jogo da velha (desistência)`);
    }
    if (ttt.isEmpty(game)) this.state.games.delete(furniId);
  }

  /** Partida terminou: placar e aviso no chat da sala. */
  private finishGame(game: TttGame, outcome: ttt.TttOutcome): void {
    const x = ttt.seatOf(game, 'X');
    const o = ttt.seatOf(game, 'O');
    if ('draw' in outcome) {
      services().games.recordDraw(TTT_GAME, x.user, o.user);
      this.gameChat(x, `🤝 empatou com ${o.name} no jogo da velha`);
      return;
    }
    const [winner, loser] = outcome.winner === 'X' ? [x, o] : [o, x];
    services().games.recordWin(TTT_GAME, winner.user, loser.user);
    services().achievements.bump(winner.user, 'tttWins');
    this.gameChat(winner, `🏆 venceu ${loser.name} no jogo da velha`);
  }

  private gameChat(seat: ttt.TttSeat, text: string): void {
    const message = services().chat.add(
      this.layout.roomId,
      { id: seat.user, name: seat.name },
      text,
      seat.session,
      undefined,
      'game',
    );
    this.broadcast(ServerMessage.Chat, message);
  }

  // ---------- Decorar ----------

  private async handlePlace(client: OfficeClient, msg: FurniPlaceMessage): Promise<void> {
    if (!client.auth || !this.canEdit(client)) return;
    const catalog = services().furniCatalog;
    const blocked = catalog.blockedReason(msg.defId, services().settings.hiddenCategories());
    if (blocked) return this.sendError(client, ErrorCode.InvalidPlacement, blocked);
    // Móvel do catálogo completo usado pela primeira vez: mede antes (Fase 36).
    if (!services().furniDefs.has(msg.defId)) {
      const def = await catalog.ensure(msg.defId).catch(() => null);
      if (!def) {
        return this.sendError(
          client,
          ErrorCode.InvalidPlacement,
          'Não consegui preparar esse móvel agora. Tente de novo.',
        );
      }
      if (!this.state.players.has(client.sessionId)) return;
    }
    const res = canPlace(this.placementContext(), msg);
    if (!res.ok) return this.sendError(client, ErrorCode.InvalidPlacement, res.reason);
    const placed = services().furni.add(
      this.layout.roomId,
      { defId: msg.defId, x: msg.x, y: msg.y, z: res.z, rot: msg.rot },
      client.auth.id,
    );
    this.state.furni.set(placed.id, toFurni(placed));
    services().achievements.bump(client.auth.id, 'furni');
  }

  /** Outra cor do mesmo móvel (variação `classname*N` do Habbo), no mesmo lugar. */
  private async handleColor(client: OfficeClient, msg: FurniColorMessage): Promise<void> {
    if (!this.canEdit(client)) return;
    const f = this.state.furni.get(msg.furniId);
    if (!f || f.defId === msg.defId) return;
    if (baseClassname(f.defId) !== baseClassname(msg.defId)) {
      return this.sendError(client, ErrorCode.InvalidPlacement, 'Essa cor não é desse móvel.');
    }
    const def = await services()
      .furniCatalog.ensure(msg.defId)
      .catch(() => null);
    const old = services().furniDefs.get(f.defId);
    if (!def || !old || this.state.furni.get(msg.furniId) !== f) {
      return this.sendError(client, ErrorCode.InvalidPlacement, 'Não consegui trocar a cor agora.');
    }
    if (def.width !== old.width || def.depth !== old.depth || def.wall !== old.wall) {
      return this.sendError(client, ErrorCode.InvalidPlacement, 'Essa cor tem outro tamanho.');
    }
    const state = def.states.includes(f.state) ? f.state : 0;
    services().furni.setDef(this.layout.roomId, f.id, msg.defId, state);
    f.defId = msg.defId;
    f.state = state;
  }

  private handleFurniMove(client: OfficeClient, msg: FurniMoveMessage): void {
    if (!this.canEdit(client)) return;
    const f = this.state.furni.get(msg.furniId);
    if (!f)
      return this.sendError(client, ErrorCode.InvalidPlacement, 'Esse móvel não existe mais.');
    if (this.someoneSeatedOn(f)) {
      return this.sendError(client, ErrorCode.InvalidPlacement, 'Tem alguém sentado aí.');
    }
    const req: PlacementRequest = {
      defId: f.defId,
      x: msg.x,
      y: msg.y,
      rot: msg.rot,
      z: msg.z,
      ignoreId: f.id,
    };
    const res = canPlace(this.placementContext(), req);
    if (!res.ok) return this.sendError(client, ErrorCode.InvalidPlacement, res.reason);
    services().furni.update(this.layout.roomId, f.id, {
      x: msg.x,
      y: msg.y,
      z: res.z,
      rot: msg.rot,
    });
    Object.assign(f, { x: msg.x, y: msg.y, z: res.z, rot: msg.rot });
  }

  private handleRemove(client: OfficeClient, furniId: string): void {
    if (!this.canEdit(client)) return;
    const f = this.state.furni.get(furniId);
    if (!f) return;
    if (this.someoneSeatedOn(f)) {
      return this.sendError(client, ErrorCode.InvalidPlacement, 'Tem alguém sentado aí.');
    }
    services().furni.remove(this.layout.roomId, furniId);
    this.state.furni.delete(furniId);
    this.state.games.delete(furniId);
  }

  /** Qualquer pessoa na sala decora, a não ser que um admin trave a sala (Fase 10). */
  private canEdit(client: OfficeClient): boolean {
    if (!this.state.players.has(client.sessionId)) return false;
    if (this.state.decorLocked && client.auth?.role !== 'admin') {
      this.sendError(client, ErrorCode.DecorLocked);
      return false;
    }
    if (!this.editLimiter.tryTake(client.sessionId)) {
      this.sendError(client, ErrorCode.RateLimit);
      return false;
    }
    return true;
  }

  private someoneSeatedOn(f: Furni): boolean {
    const def = services().furniDefs.get(f.defId);
    // Tapete e itens de parede não têm ninguém "sentado": quem está ali pode continuar.
    if (!def || def.canWalk || def.wall) return false;
    const fp = footprint(def, f.x, f.y, f.rot);
    return [...this.state.players.values()].some(
      (p) => p.x >= fp.minX && p.x <= fp.maxX && p.y >= fp.minY && p.y <= fp.maxY,
    );
  }

  /** Tile parado ou destino de outra pessoa. */
  private isTileTaken(t: TilePoint, exceptSessionId: string): boolean {
    for (const [id, p] of this.state.players.entries()) {
      if (id === exceptSessionId) continue;
      const d = this.movement.destinationOf(id, p);
      if ((p.x === t.x && p.y === t.y) || (d.x === t.x && d.y === t.y)) return true;
    }
    return false;
  }

  private furniList(): PlacedFurni[] {
    return [...this.state.furni.values()].map(toPlaced);
  }

  private placementContext() {
    const avatars: TilePoint[] = [];
    for (const [id, p] of this.state.players.entries()) {
      avatars.push({ x: p.x, y: p.y }, this.movement.destinationOf(id, p));
    }
    return {
      map: this.map,
      furni: this.furniList(),
      defs: services().furniDefs,
      doors: this.layout.doors,
      spawn: this.layout.spawn,
      avatars,
    };
  }

  private handleChat(
    client: OfficeClient,
    msg: { text: string; replyToId?: number; attachmentId?: string },
  ): void {
    if (!client.auth || !this.state.players.has(client.sessionId)) return;
    if (!this.chatLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
    // Anexo: só um arquivo que a própria pessoa enviou.
    if (msg.attachmentId && !services().uploads.owns(msg.attachmentId, client.auth.id)) {
      return this.sendError(client, ErrorCode.InvalidChat, 'Anexo não encontrado.');
    }
    // `/enquete Pergunta? | opção 1 | opção 2`: vira enquete (o limite de mensagens já foi gasto).
    const poll = parsePollCommand(msg.text);
    if (poll) {
      if ('error' in poll) return this.sendError(client, ErrorCode.InvalidChat, poll.error);
      const parsed = pollCreateSchema.safeParse(poll);
      if (!parsed.success) {
        return this.sendError(client, ErrorCode.InvalidChat, parsed.error.issues[0]?.message);
      }
      return this.createPoll(client, parsed.data, false);
    }
    // `/senta`, `/deita`, `/vem`: comando para o próprio pet (aparece no chat como fala do dono).
    const petCmd = parsePetCommand(msg.text);
    let text = msg.text;
    if (petCmd) {
      const pet = this.state.pets.get(client.auth.id);
      if (!pet) {
        return this.sendError(
          client,
          ErrorCode.Forbidden,
          'Você não tem um pet. Adote um no seu Perfil (👤).',
        );
      }
      text = petCommandText(petCmd, pet.name);
      this.pets.command(client.auth.id, petCmd);
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
      this.layout.roomId,
      client.auth,
      text,
      client.sessionId,
      cmd ? undefined : msg.replyToId,
      kind,
      cmd || petCmd ? null : (msg.attachmentId ?? null),
    );
    this.broadcast(ServerMessage.Chat, message);
    const player = this.state.players.get(client.sessionId);
    if (player) player.typing = false;
  }

  /** Apagar mensagem: quem escreveu ou um admin. Some do histórico de todos na sala. */
  /** Põe/tira reação numa mensagem desta sala; todos na sala veem a contagem nova. */
  private handleReact(client: OfficeClient, id: number, emoji: ReactRequest['emoji']): void {
    const user = client.auth;
    const msg = services().chat.find(id);
    if (!user || !msg || msg.roomId !== this.layout.roomId) return;
    if (!this.reactLimiter.tryTake(client.sessionId)) {
      return this.sendError(client, ErrorCode.RateLimit);
    }
    const reactions = services().chat.react(id, user.id, emoji);
    services().achievements.bump(user.id, 'reactions');
    this.broadcast(ServerMessage.ChatReactions, { id, reactions } satisfies ReactionsUpdate);
  }

  private handleChatDelete(client: OfficeClient, id: number): void {
    const user = client.auth;
    const msg = services().chat.find(id);
    if (!user || !msg || msg.roomId !== this.layout.roomId) return;
    const own = msg.userId === user.id;
    if (!own && user.role !== 'admin') return this.sendError(client, ErrorCode.Forbidden);
    services().chat.remove(id);
    this.broadcast(ServerMessage.ChatDeleted, { id } satisfies ChatDeletedMessage);
    if (!own) {
      const preview = msg.text.length > 60 ? `${msg.text.slice(0, 60)}…` : msg.text;
      services().audit.log(user.id, 'chat.delete', msg.userId, `“${preview}”`);
    }
  }

  /** Emote: só quem está na sala vê (efêmero, não fica no estado). */
  private handleEmote(client: OfficeClient, msg: EmoteRequest): void {
    if (!this.state.players.has(client.sessionId)) return;
    if (!this.emoteLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
    this.broadcast(ServerMessage.Emote, {
      sessionId: client.sessionId,
      emote: msg.emote,
    } satisfies EmoteMessage);
  }

  private handleUpdateAvatar(client: OfficeClient, msg: UpdateAvatarMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !client.auth) return;
    if (!this.avatarLimiter.tryTake(client.sessionId)) {
      return this.sendError(client, ErrorCode.RateLimit);
    }
    const res = validateFigure(msg.figure, msg.gender, services().avatarManifest);
    if (!res.ok) return this.sendError(client, ErrorCode.InvalidFigure, res.error);
    const user = services().users.update(client.auth.id, {
      figure: res.figure,
      gender: msg.gender,
    });
    client.auth = user;
    // Todas as conexões da mesma pessoa nesta sala mudam juntas.
    for (const p of this.state.players.values()) {
      if (p.userId === user.id) p.figure = res.figure;
    }
  }

  private sendError(client: OfficeClient, code: ErrorCode, message = ERROR_MESSAGES[code]): void {
    client.send(ServerMessage.Error, { code, message } satisfies ErrorMessage);
  }

  /** Grade vista por um jogador: os destinos dos outros avatares contam como ocupados. */
  private gridFor(sessionId: string): RoomGrid {
    const occupied: TilePoint[] = [];
    for (const [id, p] of this.state.players.entries()) {
      if (id !== sessionId) occupied.push(this.movement.destinationOf(id, p));
    }
    return new RoomGrid(this.map, this.furniList(), services().furniDefs, {
      occupied,
      // Assento só vale como destino para quem clicou nele (`interact`).
      seatsAsGoal: this.pendingSit.has(sessionId),
    });
  }

  /** Grade dos pets: não param em portas, em gente parada nem em cima de outro pet. */
  private petGrid(petId: string): RoomGrid {
    const occupied: TilePoint[] = [...this.layout.doors];
    for (const [id, p] of this.state.players.entries()) {
      occupied.push({ x: p.x, y: p.y }, this.movement.destinationOf(id, p));
    }
    for (const [id, p] of this.state.pets.entries()) {
      if (id !== petId) occupied.push({ x: p.nextX, y: p.nextY });
    }
    return new RoomGrid(this.map, this.furniList(), services().furniDefs, { occupied });
  }

  /** O próprio tile de entrada ou o livre mais próximo dele (busca em anéis). */
  private freeTileNear(origin: TilePoint): TilePoint {
    const grid = this.gridFor('');
    for (let r = 0; r < Math.max(this.map.width, this.map.height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const t = { x: origin.x + dx, y: origin.y + dy };
          const isDoor = this.layout.doors.some((d) => d.x === t.x && d.y === t.y);
          if (!isDoor && grid.isWalkable(t.x, t.y, true)) return t;
        }
      }
    }
    return origin;
  }
}

function toFurni(f: PlacedFurni): Furni {
  return Object.assign(new Furni(), {
    id: f.id,
    defId: f.defId,
    x: f.x,
    y: f.y,
    z: f.z,
    rot: f.rot,
    state: f.state ?? 0,
  });
}

function toPlaced(f: Furni): PlacedFurni {
  return { id: f.id, defId: f.defId, x: f.x, y: f.y, z: f.z, rot: f.rot, state: f.state };
}

/** Tile está encostado no footprint (inclusive na diagonal)? */
function touches(fp: { minX: number; minY: number; maxX: number; maxY: number }, t: TilePoint) {
  return (
    t.x >= fp.minX - 1 &&
    t.x <= fp.maxX + 1 &&
    t.y >= fp.minY - 1 &&
    t.y <= fp.maxY + 1 &&
    !(t.x >= fp.minX && t.x <= fp.maxX && t.y >= fp.minY && t.y <= fp.maxY)
  );
}

/** Direção (0–7) de `from` olhando para o centro do footprint. */
function faceTowards(
  from: TilePoint,
  fp: { minX: number; minY: number; maxX: number; maxY: number },
) {
  const dx = Math.sign((fp.minX + fp.maxX) / 2 - from.x);
  const dy = Math.sign((fp.minY + fp.maxY) / 2 - from.y);
  const table: Record<string, number> = {
    '0,-1': 0,
    '1,-1': 1,
    '1,0': 2,
    '1,1': 3,
    '0,1': 4,
    '-1,1': 5,
    '-1,0': 6,
    '-1,-1': 7,
  };
  return table[`${dx},${dy}`] ?? 2;
}
