import { randomInt } from 'node:crypto';
import { CloseCode, Room, ServerError, validate, type Client, type Deferred } from '@colyseus/core';
import {
  canPlace,
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
  nearestSeatTile,
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

type OfficeClient = Client<{ auth: UserRow }>;

/**
 * Uma sala física do escritório (Recepção, Copa…). Autoridade sobre posições e movimento.
 */
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
    [ClientMessage.GetChatHistory]: () => services().chat.recent(this.layout.roomId),
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
  }

  override onDispose(): void {
    services().users.events.off('updated', this.onUserUpdated);
    services().moderation.off('kick', this.onKick);
    services().moderation.off('room', this.onRoomSettings);
    services().moderation.off('layout', this.onLayout);
    services().pets.events.off('changed', this.onPetChanged);
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
    });
    this.state.players.set(client.sessionId, player);
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
    if (def.interaction === 'toggle' || def.interaction === 'coffee') {
      return this.handleUse(client, player, f, def);
    }
    if (!def.canSit) return;
    if (!this.moveLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
    const from =
      player.nextX !== player.x || player.nextY !== player.y
        ? { x: player.nextX, y: player.nextY }
        : player;
    const seat = nearestSeatTile(def, toPlaced(f), from);
    if (this.isTileTaken(seat, client.sessionId)) {
      return this.sendError(client, ErrorCode.InvalidMove, 'Esse lugar está ocupado.');
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
    } else if (def.interaction === 'coffee') {
      this.broadcast(ServerMessage.Emote, { sessionId, emote: 'coffee' } satisfies EmoteMessage);
      // A máquina "trabalha" por um instante, se tiver estado para isso.
      if (def.states.includes(1)) {
        f.state = 1;
        this.clock.setTimeout(() => {
          if (this.state.furni.get(furniId) === f) f.state = 0;
        }, 2500);
      }
    }
  }

  private sitDown(sessionId: string, furniId: string): void {
    this.pendingSit.delete(sessionId);
    const player = this.state.players.get(sessionId);
    const f = this.state.furni.get(furniId);
    const def = f && services().furniDefs.get(f.defId);
    if (!player || !f || !def) return;
    player.action = 'sit';
    player.dir = f.rot;
    player.z = f.z + def.sitHeight;
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
      const seat = nearestSeatTile(def, toPlaced(f), from);
      if (!touches(tfp, seat) || this.isTileTaken(seat, sessionId)) continue;
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

  private handlePlace(client: OfficeClient, msg: FurniPlaceMessage): void {
    if (!client.auth || !this.canEdit(client)) return;
    const res = canPlace(this.placementContext(), msg);
    if (!res.ok) return this.sendError(client, ErrorCode.InvalidPlacement, res.reason);
    const placed = services().furni.add(
      this.layout.roomId,
      { defId: msg.defId, x: msg.x, y: msg.y, z: res.z, rot: msg.rot },
      client.auth.id,
    );
    this.state.furni.set(placed.id, toFurni(placed));
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
    // Tapete não tem ninguém "sentado": quem está em cima pode continuar lá.
    if (!def || def.canWalk) return false;
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

  private handleChat(client: OfficeClient, msg: { text: string; replyToId?: number }): void {
    if (!client.auth || !this.state.players.has(client.sessionId)) return;
    if (!this.chatLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
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
      text = quickCommandText(cmd, cmd === 'dice' ? randomInt(1, 7) : randomInt(0, 2));
      kind = cmd;
    }
    // Só quem está nesta sala recebe (cada sala física é uma instância separada).
    const message = services().chat.add(
      this.layout.roomId,
      client.auth,
      text,
      client.sessionId,
      cmd ? undefined : msg.replyToId,
      kind,
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
