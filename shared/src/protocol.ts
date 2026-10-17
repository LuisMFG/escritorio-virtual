import { z } from 'zod';
import { genderSchema, type Gender } from './manifests.js';
import type { RoomDoor } from './rooms.js';
import type { TilePoint } from './iso.js';

/** Nome da sala Colyseus. Cada sala física é uma instância filtrada por `officeRoomId`. */
export const OFFICE_ROOM = 'office';

/** Mensagens cliente → servidor. */
export const ClientMessage = {
  Move: 'move',
  /** Requisição (`room.request`): responde com o `RoomLayoutMessage` da sala. */
  GetLayout: 'room.layout',
  /** `{ figure, gender }`: troca o visual (validado contra o manifesto do avatar). */
  UpdateAvatar: 'avatar.update',
  /** `{ text }`: mensagem de chat para quem está na mesma sala. */
  Chat: 'chat',
  /** Requisição: responde com as últimas mensagens da sala (`ChatMessage[]`). */
  GetChatHistory: 'chat.history',
  /** Modo decorar: `{ defId, x, y, rot }`. */
  FurniPlace: 'furni.place',
  /** Modo decorar: mover e/ou girar `{ furniId, x, y, rot }`. */
  FurniMove: 'furni.move',
  /** Modo decorar: `{ furniId }`. */
  FurniRemove: 'furni.remove',
  /** Clique num móvel fora do modo decorar (sentar): `{ furniId }`. */
  Interact: 'interact',
  /** `{ status }`: Disponível / Ocupado / Ausente. */
  SetStatus: 'status.set',
  /** `{ on }`: começou/parou de digitar. */
  Typing: 'typing',
  /** `{ emote }`: acenar, rir, dançar… */
  Emote: 'emote',
} as const;

/** Mensagens servidor → cliente. */
export const ServerMessage = {
  Error: 'error',
  /** Mensagem de chat nova na sala (`ChatMessage`). */
  Chat: 'chat.message',
  /** Pisou numa porta: sair desta sala e entrar em `targetRoomId` com o ticket. */
  RoomTransfer: 'room.transfer',
  /** Alguém tocou um emote (`EmoteMessage`). */
  Emote: 'emote.played',
} as const;

export const ErrorCode = {
  InvalidInvite: 'INVALID_INVITE',
  InvalidSession: 'INVALID_SESSION',
  NameInUse: 'NAME_IN_USE',
  InvalidPayload: 'INVALID_PAYLOAD',
  InvalidMove: 'INVALID_MOVE',
  InvalidFigure: 'INVALID_FIGURE',
  InvalidChat: 'INVALID_CHAT',
  InvalidPlacement: 'INVALID_PLACEMENT',
  RateLimit: 'RATE_LIMIT',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Mensagens de erro exibidas ao usuário (PT-BR). */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_INVITE: 'Código de convite inválido.',
  INVALID_SESSION: 'Sua sessão expirou. Entre novamente.',
  NAME_IN_USE: 'Já tem alguém online com esse nome. Tente outro (ou adicione um sufixo).',
  INVALID_PAYLOAD: 'Dados inválidos.',
  INVALID_MOVE: 'Não dá para andar até lá.',
  INVALID_FIGURE: 'Esse visual não é válido.',
  INVALID_CHAT: 'Mensagem inválida.',
  INVALID_PLACEMENT: 'Não dá para colocar o móvel aí.',
  RATE_LIMIT: 'Calma! Muitas ações em pouco tempo.',
};

export const NAME_MIN = 2;
export const NAME_MAX = 20;

/** Remove espaços extras do nome digitado. */
export function normalizeName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Chave para comparar nomes: sem acentos, minúsculas e sem espaços duplicados. */
export function nameKey(name: string): string {
  return normalizeName(name)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export const nameSchema = z
  .string()
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(NAME_MIN, `O nome precisa ter pelo menos ${NAME_MIN} caracteres.`)
      .max(NAME_MAX, `O nome pode ter no máximo ${NAME_MAX} caracteres.`)
      .regex(
        /^[\p{L}\p{N} ._'-]+$/u,
        'Use só letras, números, espaço, ponto, hífen ou sublinhado.',
      ),
  );

/** Formato da figure string (validação estrutural; a validação contra o manifesto vem na Fase 3). */
export const figureSchema = z
  .string()
  .max(512)
  .regex(
    /^[a-z]{2}-\d{1,6}(-\d{1,4}){0,2}(\.[a-z]{2}-\d{1,6}(-\d{1,4}){0,2})*$/,
    'Visual inválido.',
  );

export const sessionRequestSchema = z.object({
  name: nameSchema,
  /** Opcional quando o navegador já tem um token válido. */
  inviteCode: z.string().max(100).optional(),
  figure: figureSchema.optional(),
  gender: genderSchema.optional(),
  token: z.string().max(200).optional(),
});
export type SessionRequest = z.input<typeof sessionRequestSchema>;

export interface SessionResponse {
  userId: string;
  token: string;
  name: string;
  figure: string;
  gender: Gender;
}

export interface ApiError {
  error: ErrorCode;
  message: string;
  /** Sugestão de nome livre quando `error = NAME_IN_USE`. */
  suggestion?: string;
}

/** Opções enviadas no `joinOrCreate`. */
export const joinOptionsSchema = z.object({
  /**
   * Sala física (`reception`, `meeting`…). Não pode se chamar `roomId`: esse nome é o id
   * interno de cada instância Colyseus e o `filterBy` passaria a comparar com ele.
   */
  officeRoomId: z.string().min(1).max(40),
  token: z.string().min(1).max(200),
  /** Ticket de uso único recebido ao passar por uma porta (define onde nascer). */
  ticket: z.string().max(100).optional(),
});
export type JoinOptions = z.infer<typeof joinOptionsSchema>;

const tileCoord = z.number().int().min(0).max(255);

export const moveSchema = z.object({ x: tileCoord, y: tileCoord });
export type MoveMessage = z.infer<typeof moveSchema>;

const furniId = z.string().min(1).max(40);
const rotation = z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]);

export const furniPlaceSchema = z.object({
  defId: z.string().min(1).max(80),
  x: tileCoord,
  y: tileCoord,
  rot: rotation,
});
export const furniMoveSchema = z.object({ furniId, x: tileCoord, y: tileCoord, rot: rotation });
export const furniRefSchema = z.object({ furniId });
export type FurniPlaceMessage = z.infer<typeof furniPlaceSchema>;
export type FurniMoveMessage = z.infer<typeof furniMoveSchema>;
export type FurniRefMessage = z.infer<typeof furniRefSchema>;

export const updateAvatarSchema = z.object({ figure: figureSchema, gender: genderSchema });
export type UpdateAvatarMessage = z.infer<typeof updateAvatarSchema>;

/** Layout estático da sala, pedido pelo cliente logo depois de entrar. */
export interface RoomLayoutMessage {
  roomId: string;
  name: string;
  heightmap: string[];
  spawn: TilePoint & { dir: number };
  doors: RoomDoor[];
  floorColor: string;
  wallColor: string;
}

export const CHAT_MAX_LENGTH = 200;
/** Quantas mensagens o servidor guarda por sala e quantas manda ao entrar. */
export const CHAT_KEEP_PER_ROOM = 200;
export const CHAT_HISTORY_ON_JOIN = 50;

/**
 * Limpa o texto do chat: remove caracteres de controle e invisíveis, junta espaços e quebras
 * de linha num espaço só. O texto é sempre exibido como texto puro (nunca HTML).
 */
export function normalizeChatText(text: string): string {
  return (
    text
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export const chatSchema = z.object({
  text: z
    .string()
    .max(CHAT_MAX_LENGTH * 4)
    .transform(normalizeChatText)
    .pipe(
      z
        .string()
        .min(1, 'Mensagem vazia.')
        .max(CHAT_MAX_LENGTH, `A mensagem pode ter no máximo ${CHAT_MAX_LENGTH} caracteres.`),
    ),
});
export type ChatInput = z.input<typeof chatSchema>;

export interface ChatMessage {
  id: number;
  roomId: string;
  userId: string;
  /** Sessão (avatar) que falou, para o balão; vazio em mensagens antigas do histórico. */
  sessionId: string;
  name: string;
  text: string;
  /** Epoch em ms. */
  ts: number;
}

export interface RoomTransferMessage {
  targetRoomId: string;
  ticket: string;
}

/** `GET /api/presence`: quem está online em cada sala. */
export interface PresenceResponse {
  rooms: { roomId: string; name: string; people: { name: string }[] }[];
}

export interface ErrorMessage {
  code: ErrorCode;
  message: string;
}
