import { z } from 'zod';

/** Elogios entre colegas (Fase 26). */
export const KUDOS_TYPES = ['help', 'idea', 'delivered', 'partner'] as const;
export type KudosType = (typeof KUDOS_TYPES)[number];

export const KUDOS_INFO: Record<KudosType, { emoji: string; label: string }> = {
  help: { emoji: '🙌', label: 'Ajudou muito' },
  idea: { emoji: '💡', label: 'Boa ideia' },
  delivered: { emoji: '🚀', label: 'Entregou' },
  partner: { emoji: '🤝', label: 'Parceria' },
};

export const KUDOS_MESSAGE_MAX = 200;
/** Quantos elogios cada pessoa pode mandar por dia (evita virar spam). */
export const KUDOS_PER_DAY = 10;
/** Quantos o mural mostra. */
export const KUDOS_WALL = 60;

export const kudosCreateSchema = z.object({
  toUserId: z.string().min(1).max(64),
  type: z.enum(KUDOS_TYPES),
  message: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(3, 'Escreva uma frase curta sobre o que a pessoa fez.')
        .max(KUDOS_MESSAGE_MAX, `No máximo ${KUDOS_MESSAGE_MAX} letras.`),
    ),
});
export type KudosCreate = z.input<typeof kudosCreateSchema>;

export interface Kudos {
  id: number;
  type: KudosType;
  message: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  /** Epoch ms. */
  createdAt: number;
}

/** Lobby → quem recebeu: "Fulano te elogiou". Lobby → todos: mural mudou. */
export const KudosMessage = {
  Received: 'kudos.received',
  Changed: 'kudos.changed',
} as const;
export interface KudosNotice {
  kudos: Kudos;
}
