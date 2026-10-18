import { schema, t, type SchemaType } from '@colyseus/schema';
import { z } from 'zod';
import { chatFields, hasContent } from './protocol.js';
import type { Attachment } from './uploads.js';
import type { ReactionSummary, ReplyPreview } from './reactions.js';

/**
 * Canal global: uma sala Colyseus `lobby` em que todo mundo fica conectado, em qualquer
 * sala física. Leva as mensagens privadas e a presença ao vivo (quem está online e onde).
 */
export const LOBBY_ROOM = 'lobby';

export const LobbyClientMessage = {
  /** `{ toUserId, text }` */
  DmSend: 'dm.send',
  /** Requisição: lista de conversas (`DmConversation[]`). */
  DmConversations: 'dm.conversations',
  /** Requisição `{ withUserId, beforeId? }`: mensagens da conversa (`DirectMessage[]`). */
  DmHistory: 'dm.history',
  /** `{ withUserId }`: abri a conversa (marca como lidas). */
  DmRead: 'dm.read',
  /** `{ id, emoji }`: põe ou tira uma reação. */
  DmReact: 'dm.react',
} as const;

export const LobbyServerMessage = {
  /** Mensagem nova (para as conexões de quem mandou e de quem recebeu). */
  DmMessage: 'dm.message',
  /** `DmReadReceipt`: alguém leu as mensagens de uma conversa. */
  DmReadReceipt: 'dm.readReceipt',
  /** Reações de uma DM mudaram (`ReactionsUpdate`). */
  DmReactions: 'dm.reactions',
  Error: 'error',
} as const;

const userId = z.string().min(1).max(64);

export const dmSendSchema = chatFields
  .extend({ toUserId: userId })
  .refine(hasContent, { message: 'Mensagem vazia.', path: ['text'] });
export const dmHistorySchema = z.object({
  withUserId: userId,
  beforeId: z.number().int().positive().optional(),
});
export const dmReadSchema = z.object({ withUserId: userId });

export const DM_PAGE_SIZE = 50;
/** Quantas mensagens guardamos por conversa (as mais antigas saem). */
export const DM_KEEP_PER_PAIR = 1000;

export interface DirectMessage {
  id: number;
  fromUserId: string;
  toUserId: string;
  text: string;
  /** Epoch ms. */
  ts: number;
  /** Epoch ms ou `null` (não lida). */
  readAt: number | null;
  reactions: ReactionSummary[];
  replyTo: ReplyPreview | null;
  /** Arquivo ou imagem anexada. */
  attachment?: Attachment | null;
}

export interface DmConversation {
  userId: string;
  name: string;
  figure: string;
  lastText: string;
  lastFromMe: boolean;
  /** Epoch ms. */
  lastAt: number;
  unread: number;
}

export interface DmReadReceipt {
  /** Quem leu. */
  readerId: string;
  /** Quem tinha escrito as mensagens lidas. */
  writerId: string;
  /** Lidas até esta mensagem (inclusive). */
  upToId: number;
}

/** Quem está online e onde (estado sincronizado do lobby; chave = userId). */
export const OnlinePerson = schema(
  {
    userId: t.string(),
    name: t.string(),
    /** Sala física atual (vazio = conectado, mas trocando de sala). */
    roomId: t.string(),
    /** 'available' | 'busy' | 'away' */
    status: t.string(),
    /** Atividade fora do escritório (VS Code, Spotify). */
    activity: t.string(),
  },
  'OnlinePerson',
);
export type OnlinePerson = SchemaType<typeof OnlinePerson>;

/** Sala na lista do lobby (para nomes, "outras salas" e o editor). */
export const RoomEntry = schema(
  {
    id: t.string(),
    name: t.string(),
    sort: t.uint8(),
    /** Título da reunião acontecendo agora na sala (vazio = livre). */
    meeting: t.string(),
  },
  'RoomEntry',
);
export type RoomEntry = SchemaType<typeof RoomEntry>;

export const LobbyState = schema(
  { people: t.map(OnlinePerson), rooms: t.map(RoomEntry) },
  'LobbyState',
);
export type LobbyState = SchemaType<typeof LobbyState>;
