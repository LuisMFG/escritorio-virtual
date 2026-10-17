import { z } from 'zod';

/** Reações permitidas (lista fechada: nada de emoji arbitrário vindo do cliente). */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const reactSchema = z.object({
  id: z.number().int().positive(),
  emoji: z.enum(REACTIONS),
});
export type ReactRequest = z.infer<typeof reactSchema>;

/** Uma reação e quem reagiu (em ordem). */
export interface ReactionSummary {
  emoji: Reaction;
  users: { userId: string; name: string }[];
}

/** Trecho da mensagem respondida, mostrado em cima da resposta. */
export interface ReplyPreview {
  id: number;
  userId: string;
  name: string;
  text: string;
}

/** Reações de uma mensagem mudaram (sala ou DM). */
export interface ReactionsUpdate {
  id: number;
  reactions: ReactionSummary[];
}

export const REPLY_PREVIEW_MAX = 120;

export function replyPreviewText(text: string): string {
  return text.length > REPLY_PREVIEW_MAX ? `${text.slice(0, REPLY_PREVIEW_MAX)}…` : text;
}
