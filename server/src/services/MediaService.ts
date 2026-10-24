import type { CallToken } from '@office/shared';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import type { TurnService } from './TurnService.js';

/** Servidor de mídia (LiveKit) das chamadas: endereços e chave de API (`.env`). */
export interface MediaConfig {
  /** Para o navegador: absoluto (`wss://…`) ou um caminho neste site (`/livekit`, atrás do Caddy). */
  url: string;
  /** Para este servidor falar com o LiveKit (tirar quem saiu da chamada). */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

/** O que usamos do LiveKit para tirar alguém da sala (trocável nos testes). */
export type MediaRooms = Pick<RoomServiceClient, 'removeParticipant'>;

/** Quanto vale a credencial (s): só para entrar; quem já entrou continua mesmo depois. */
const TOKEN_TTL_S = 6 * 3600;

/**
 * Sala de mídia de cada chamada (uma sala do LiveKit com o id da chamada). Só quem está na
 * chamada recebe a credencial, que vale só para aquela sala e com a própria identidade (o id da
 * conta). Quem sai da chamada é tirado da sala na hora.
 */
export class MediaService {
  private readonly rooms: MediaRooms;

  constructor(
    private readonly config: MediaConfig,
    private readonly turn: Pick<TurnService, 'iceServers'>,
    rooms?: MediaRooms,
  ) {
    this.rooms = rooms ?? new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
  }

  async token(callId: string, user: { id: string; name: string }): Promise<CallToken> {
    const at = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: user.id,
      name: user.name,
      ttl: TOKEN_TTL_S,
    });
    at.addGrant({
      room: callId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // Nada de mensagens pela sala de mídia: o chat e o resto vão pelo escritório.
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    const [token, iceServers] = await Promise.all([at.toJwt(), this.turn.iceServers()]);
    return { url: this.config.url, token, iceServers };
  }

  /** Tira da sala de mídia quem saiu da chamada (se já tinha saído, tudo bem). */
  async kick(callId: string, userIds: string[]): Promise<void> {
    await Promise.all(
      userIds.map((id) => this.rooms.removeParticipant(callId, id).catch(() => undefined)),
    );
  }
}
