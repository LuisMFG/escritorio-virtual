import { Room, ServerError, validate, type Client, type Deferred } from '@colyseus/core';
import {
  canPlace,
  chatSchema,
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
  ServerMessage,
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
import { services } from '../services/index.js';
import { KeyedRateLimiter } from '../util/rateLimiter.js';
import { MovementSystem, type Mover } from './MovementSystem.js';

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
  override maxMessagesPerSecond = 30;

  private layout!: RoomLayoutMessage;
  private map!: Heightmap;
  private movement!: MovementSystem;
  private readonly moveLimiter = new KeyedRateLimiter(5, 5);
  private readonly avatarLimiter = new KeyedRateLimiter(3, 0.5);
  /** Chat: até 3 mensagens seguidas, recarregando 3 a cada 5 s. */
  private readonly chatLimiter = new KeyedRateLimiter(3, 3 / 5);
  /** Decorar: rajada de 10 ações, recarregando 4 por segundo. */
  private readonly editLimiter = new KeyedRateLimiter(10, 4);
  /** Quem clicou numa cadeira e está andando até ela (sessionId → móvel e assento). */
  private readonly pendingSit = new Map<string, { furniId: string; seat: TilePoint }>();
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
    [ClientMessage.Interact]: validate(furniRefSchema, (client, msg) =>
      this.handleInteract(client as OfficeClient, msg.furniId),
    ),
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
    for (const f of services().furni.list(layout.roomId)) this.state.furni.set(f.id, toFurni(f));
    this.setSimulationInterval(
      (dt) => this.movement.tick(dt, this.state.players.entries()),
      TICK_MS,
    );
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
      name: user.name,
      figure: user.figure,
      x: spawn.x,
      y: spawn.y,
      nextX: spawn.x,
      nextY: spawn.y,
      z: this.gridFor(client.sessionId).heightAt(spawn.x, spawn.y),
      dir: via?.dir ?? this.layout.spawn.dir,
      action: 'idle',
      away: false,
    });
    this.state.players.set(client.sessionId, player);
    services().presence.add({
      sessionId: client.sessionId,
      userId: user.id,
      name: user.name,
      roomId: this.layout.roomId,
    });
    services().users.touch(user.id);
  }

  override onDrop(client: OfficeClient): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.away = true;
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
    this.pendingSit.delete(client.sessionId);
    services().presence.remove(client.sessionId);
    if (client.auth) services().users.touch(client.auth.id);
  }

  /** Terminou um passo: chegou na cadeira (senta) ou numa porta (troca de sala). */
  private onStepEnd(sessionId: string, m: Mover): boolean {
    const sit = this.pendingSit.get(sessionId);
    if (sit && sit.seat.x === m.x && sit.seat.y === m.y) {
      this.sitDown(sessionId, sit.furniId);
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
    const res = this.movement.request(client.sessionId, player, msg);
    if (!res.ok) this.sendError(client, ErrorCode.InvalidMove);
  }

  // ---------- Sentar ----------

  /** Clique num assento: anda até o lugar livre mais perto e senta virado como o móvel. */
  private handleInteract(client: OfficeClient, furniId: string): void {
    const player = this.state.players.get(client.sessionId);
    const f = this.state.furni.get(furniId);
    const def = f && services().furniDefs.get(f.defId);
    if (!player || !f || !def?.canSit) return;
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
  }

  /** Qualquer pessoa na sala pode decorar (decisão da v1); só limitamos a frequência. */
  private canEdit(client: OfficeClient): boolean {
    if (!this.state.players.has(client.sessionId)) return false;
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

  private handleChat(client: OfficeClient, msg: { text: string }): void {
    if (!client.auth || !this.state.players.has(client.sessionId)) return;
    if (!this.chatLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
    // Só quem está nesta sala recebe (cada sala física é uma instância separada).
    const message = services().chat.add(
      this.layout.roomId,
      client.auth,
      msg.text,
      client.sessionId,
    );
    this.broadcast(ServerMessage.Chat, message);
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
  });
}

function toPlaced(f: Furni): PlacedFurni {
  return { id: f.id, defId: f.defId, x: f.x, y: f.y, z: f.z, rot: f.rot };
}
