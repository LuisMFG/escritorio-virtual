import { z } from 'zod';

/** Avisos da diretoria (Fase 24): comunicados do admin para todo o escritório. */
export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 1000;
/** Quantos avisos o histórico mostra. */
export const ANNOUNCEMENT_HISTORY = 50;

const clean = (s: string) => s.replace(/\r\n/g, '\n').trim();

export const announcementCreateSchema = z.object({
  title: z
    .string()
    .transform(clean)
    .pipe(
      z
        .string()
        .min(3, 'O título precisa ter pelo menos 3 letras.')
        .max(
          ANNOUNCEMENT_TITLE_MAX,
          `O título pode ter no máximo ${ANNOUNCEMENT_TITLE_MAX} letras.`,
        ),
    ),
  body: z
    .string()
    .transform(clean)
    .pipe(
      z
        .string()
        .min(1, 'Escreva o aviso.')
        .max(ANNOUNCEMENT_BODY_MAX, `O aviso pode ter no máximo ${ANNOUNCEMENT_BODY_MAX} letras.`),
    ),
  urgent: z.boolean().default(false),
});
export type AnnouncementCreate = z.input<typeof announcementCreateSchema>;

export interface Announcement {
  id: number;
  title: string;
  body: string;
  urgent: boolean;
  createdByName: string;
  /** Epoch ms. */
  createdAt: number;
  /** A pessoa que pediu já marcou "Li". */
  read: boolean;
  /** Quantas pessoas já leram (só para admins; 0 para os outros). */
  readCount: number;
}

/** Lobby → todos: aviso novo (ou apagado). */
export const AnnouncementMessage = {
  New: 'announcement.new',
  Removed: 'announcement.removed',
} as const;
export interface AnnouncementNotice {
  announcement: Announcement;
}
