import { z } from 'zod';
import { genderSchema } from './manifests.js';
import type { RoomDoor } from './rooms.js';
import type { TilePoint } from './iso.js';
import type { PlacedFurni } from './furni.js';
import type { ReactionSummary, ReplyPreview } from './reactions.js';
import type { Ambient } from './ambience.js';
import type { ChatKind } from './games.js';
import type { PollView } from './polls.js';
import type { Attachment } from './uploads.js';

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
  /** Modo decorar: outra cor do mesmo móvel `{ furniId, defId }`. */
  FurniColor: 'furni.color',
  /** Modo decorar: ajuste fino de altura `{ furniId, z }` (Fase 56). */
  FurniHeight: 'furni.height',
  /** Clique num móvel fora do modo decorar (sentar): `{ furniId }`. */
  Interact: 'interact',
  /** Minha mesa (Fase 42): ficar com a estação onde está sentado, largar e ir até ela. */
  ClaimDesk: 'claimDesk',
  ReleaseDesk: 'releaseDesk',
  GoToDesk: 'goToDesk',
  /** `{ status }`: Disponível / Ocupado / Ausente. */
  SetStatus: 'status.set',
  /** `{ on }`: começou/parou de digitar. */
  Typing: 'typing',
  /** `{ emote }`: acenar, rir, dançar… */
  Emote: 'emote',
  /** `{ target }` (sessão): toca aqui com outra pessoa (Fase 54). */
  HighFive: 'emote.highfive',
  /** `{ dance }`: começa a dança (vazio para) (Fase 55). */
  Dance: 'dance',
  /** Requisição: responde a hora do servidor (epoch ms), para o compasso das danças. */
  Time: 'time',
  /** `{ posture }`: sentar/deitar no chão ou levantar (`/sentar`, `/deitar`, `/levantar`). */
  Posture: 'posture',
  /** `{ dir }`: virar sem sair do lugar (setas do teclado). */
  Turn: 'turn',
  /** Largar o item da mão (`/largar`). */
  ItemDrop: 'item.drop',
  /** `{ id }`: apagar mensagem do chat (admin ou quem escreveu). */
  ChatDelete: 'chat.delete',
  /** `{ id, emoji }`: põe ou tira uma reação. */
  ChatReact: 'chat.react',
  /** Requisição `{ furniId }`: recados do mural (`BoardNote[]`). */
  BoardNotes: 'board.notes',
  /** `{ furniId, text, color }`: prega um recado. */
  BoardAdd: 'board.add',
  /** `{ noteId }`: tira um recado (quem escreveu ou admin). */
  BoardRemove: 'board.remove',
  /** Requisição `{ furniId }`: traços do quadro branco (`WbStroke[]`). */
  WbLoad: 'wb.load',
  /** `{ furniId, stroke }`: traço terminado. */
  WbStroke: 'wb.stroke',
  /** Traço em andamento (só repassado aos outros). */
  WbDraft: 'wb.draft',
  /** `{ furniId }`: desfaz o último traço seu. */
  WbUndo: 'wb.undo',
  /** `{ furniId }`: apaga o quadro todo. */
  WbClear: 'wb.clear',
  /** `{ furniId }`: pega um lugar na mesa de jogo da velha (anda e senta ao lado). */
  TttJoin: 'ttt.join',
  /** `{ furniId }`: sai da mesa (no meio da partida, o outro vence). */
  TttLeave: 'ttt.leave',
  /** `{ furniId, cell }`: marca uma casa (0–8). */
  TttMove: 'ttt.move',
  /** `{ furniId }`: revanche depois de uma partida terminar. */
  TttRematch: 'ttt.rematch',
  /** Requisição `{ furniId }`: placar (`TttScores`). */
  TttScores: 'ttt.scores',
  /** `{ question, options, anonymous }`: cria uma enquete no chat da sala. */
  PollCreate: 'poll.create',
  /** `{ pollId, option }`: vota (ou troca o voto). */
  PollVote: 'poll.vote',
  /** `{ pollId }`: encerra (quem criou ou admin). */
  PollClose: 'poll.close',
  /** `{ minutes, breakMinutes }`: começa um ciclo de foco (Pomodoro). */
  FocusStart: 'focus.start',
  /** Para o foco (ou a pausa) agora. */
  FocusStop: 'focus.stop',
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
  /** Duas pessoas bateram as mãos (`HighFiveMessage`). */
  HighFive: 'emote.highfive.played',
  /** Mensagem apagada (`ChatDeletedMessage`): some do histórico de todos. */
  ChatDeleted: 'chat.deleted',
  /** Efeito por alguns segundos sobre alguém (`EffectFlash`): comemorações. */
  EffectFlash: 'effect.flash',
  /** Reações de uma mensagem mudaram (`ReactionsUpdate`). */
  ChatReactions: 'chat.reactions',
  /** Um admin tirou você da sala ou do escritório (`KickedMessage`). */
  Kicked: 'moderation.kicked',
  /** A sala foi editada: o cliente pede o layout de novo e remonta a cena. */
  LayoutChanged: 'room.layoutChanged',
  /** `{ furniId }`: os recados de um mural mudaram. */
  BoardChanged: 'board.changed',
  /** Traço novo num quadro (`WbStrokeMessage`). */
  WbStroke: 'wb.stroke',
  /** Traço em andamento de alguém (`WbDraft`). */
  WbDraft: 'wb.draft',
  /** Traços apagados (desfazer) (`WbRemovedMessage`). */
  WbRemoved: 'wb.removed',
  /** `{ furniId }`: quadro limpo. */
  WbCleared: 'wb.cleared',
  /** Votos ou estado de uma enquete mudaram (`PollUpdated`). */
  PollUpdated: 'poll.updated',
  /** Para a própria pessoa: fase do foco mudou (`FocusPhase`). */
  FocusPhase: 'focus.phase',
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
  InvalidCredentials: 'INVALID_CREDENTIALS',
  UsernameTaken: 'USERNAME_TAKEN',
  AccountExists: 'ACCOUNT_EXISTS',
  WrongPassword: 'WRONG_PASSWORD',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  AccountDisabled: 'ACCOUNT_DISABLED',
  DecorLocked: 'DECOR_LOCKED',
  Unavailable: 'UNAVAILABLE',
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
  INVALID_CREDENTIALS: 'Usuário ou senha incorretos.',
  USERNAME_TAKEN: 'Esse usuário já existe. Escolha outro.',
  ACCOUNT_EXISTS: 'Esta conta já tem usuário e senha.',
  WRONG_PASSWORD: 'A senha atual não confere.',
  FORBIDDEN: 'Só administradores podem fazer isso.',
  NOT_FOUND: 'Não encontrado.',
  ACCOUNT_DISABLED: 'Esta conta foi desativada por um administrador.',
  DECOR_LOCKED: 'A decoração desta sala está travada por um administrador.',
  UNAVAILABLE: 'Serviço indisponível agora. Tente de novo.',
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

export interface ApiError {
  error: ErrorCode;
  message: string;
  /** Sugestão de nome livre quando `error = NAME_IN_USE`. */
  suggestion?: string;
  /** Campo do formulário com problema (`INVALID_PAYLOAD`), para mostrar o erro nele. */
  field?: string;
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

/** Itens de parede: altura acima do piso (unidades de altura). */
const wallHeight = z.number().min(0).max(4).optional();
const defId = z.string().min(1).max(80);

export const furniPlaceSchema = z.object({
  defId,
  x: tileCoord,
  y: tileCoord,
  rot: rotation,
  z: wallHeight,
});
export const furniMoveSchema = z.object({
  furniId,
  x: tileCoord,
  y: tileCoord,
  rot: rotation,
  z: wallHeight,
});
/** Trocar a cor de um móvel (outra variação do mesmo móvel do Habbo). */
export const furniColorSchema = z.object({ furniId, defId });
export type FurniColorMessage = z.infer<typeof furniColorSchema>;
/** Ajuste fino de altura (Fase 56): a altura nova do móvel; o que está em cima vai junto. */
export const furniHeightSchema = z.object({ furniId, z: z.number().min(0).max(64) });
export type FurniHeightMessage = z.infer<typeof furniHeightSchema>;
export const furniRefSchema = z.object({ furniId });
export type FurniPlaceMessage = z.infer<typeof furniPlaceSchema>;
export type FurniMoveMessage = z.infer<typeof furniMoveSchema>;
export type FurniRefMessage = z.infer<typeof furniRefSchema>;

/**
 * Resposta do servidor a colocar, mover, girar, trocar a cor ou remover um móvel (Fase 53). O
 * cliente só grava no desfazer o que foi aceito, e desfaz na tela o que foi recusado. `furni` é
 * como o móvel ficou; ao remover, vem sem ele. O motivo da recusa também chega como erro.
 */
export type FurniResult =
  | {
      ok: true;
      furni?: PlacedFurni;
      /** Tudo o que mudou de lugar junto: a base e a pilha em cima dela (Fase 56). */
      moved?: PlacedFurni[];
    }
  | { ok: false; reason?: string };

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
  /** Som ambiente da sala. */
  ambient: Ambient;
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

/** Campos da mensagem (sala ou DM); o texto pode ficar vazio se tiver anexo. */
export const chatFields = z.object({
  text: z
    .string()
    .max(CHAT_MAX_LENGTH * 4)
    .transform(normalizeChatText)
    .pipe(
      z
        .string()
        .max(CHAT_MAX_LENGTH, `A mensagem pode ter no máximo ${CHAT_MAX_LENGTH} caracteres.`),
    ),
  /** Resposta a outra mensagem (da mesma sala ou conversa). */
  replyToId: z.number().int().positive().optional(),
  /** Anexo já enviado (`POST /api/uploads`) pela mesma pessoa. */
  attachmentId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .optional(),
});

/** Mensagem precisa de texto ou de anexo. */
export const hasContent = (m: { text: string; attachmentId?: string }) =>
  m.text.length > 0 || Boolean(m.attachmentId);

export const chatSchema = chatFields.refine(hasContent, {
  message: 'Mensagem vazia.',
  path: ['text'],
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
  /** `text` = escrita pela pessoa; `dice`/`coin`/`game` = gerada pelo servidor. */
  kind: ChatKind;
  /** Epoch em ms. */
  ts: number;
  reactions: ReactionSummary[];
  replyTo: ReplyPreview | null;
  /** Mensagem do tipo `poll`: a enquete (com o voto de quem recebe). */
  poll?: PollView;
  /** Arquivo ou imagem anexada. */
  attachment?: Attachment | null;
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
