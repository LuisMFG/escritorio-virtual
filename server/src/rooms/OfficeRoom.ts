import { Room, ServerError, validate, type Client, type Deferred } from '@colyseus/core';
import {
  ClientMessage,
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
  type Heightmap,
  type MoveMessage,
  type UpdateAvatarMessage,
  type RoomLayoutMessage,
  type TilePoint,
} from '@office/shared';
import type { UserRow } from '../db/schema.js';
import { services } from '../services/index.js';
import { KeyedRateLimiter } from '../util/rateLimiter.js';
import { MovementSystem } from './MovementSystem.js';

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
  /** Reconexões pendentes por sessionId, para cancelar quando a pessoa volta numa aba nova. */
  private readonly pendingReconnects = new Map<string, Deferred<Client>>();

  override messages = {
    [ClientMessage.Move]: validate(moveSchema, (client, msg) =>
      this.handleMove(client as OfficeClient, msg),
    ),
    // Pedido explícito evita a corrida de uma mensagem enviada no onJoin chegar antes
    // de o cliente registrar o handler.
    [ClientMessage.GetLayout]: () => this.layout,
    [ClientMessage.UpdateAvatar]: validate(updateAvatarSchema, (client, msg) =>
      this.handleUpdateAvatar(client as OfficeClient, msg),
    ),
  };

  override onCreate(options: { roomId: string }): void {
    const layout = services().rooms.getLayout(options.roomId);
    if (!layout) throw new ServerError(404, `Sala inexistente: ${options.roomId}`);
    this.layout = layout;
    this.map = parseHeightmap(layout.heightmap);
    this.movement = new MovementSystem((id) => this.gridFor(id));
    this.state = new OfficeState();
    this.state.roomId = layout.roomId;
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

  override onJoin(client: OfficeClient): void {
    const user = client.auth;
    if (!user) throw new ServerError(401, ERROR_MESSAGES.INVALID_SESSION);
    // Recarregou a página ou abriu de novo: o avatar "fantasma" da conexão antiga sai já,
    // em vez de esperar o prazo de reconexão.
    for (const [sessionId, p] of this.state.players.entries()) {
      if (p.userId === user.id && p.away) this.pendingReconnects.get(sessionId)?.reject(false);
    }
    const spawn = this.freeTileNear(this.layout.spawn);
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
      dir: this.layout.spawn.dir,
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
    services().presence.remove(client.sessionId);
    if (client.auth) services().users.touch(client.auth.id);
  }

  private handleMove(client: OfficeClient, msg: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!this.moveLimiter.tryTake(client.sessionId))
      return this.sendError(client, ErrorCode.RateLimit);
    const res = this.movement.request(client.sessionId, player, msg);
    if (!res.ok) this.sendError(client, ErrorCode.InvalidMove);
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
    return new RoomGrid(this.map, this.layout.furni, services().furniDefs, {
      occupied,
      // Ainda não dá para sentar (Fase 6).
      seatsAsGoal: false,
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
          if (grid.isWalkable(t.x, t.y, true)) return t;
        }
      }
    }
    return origin;
  }
}
