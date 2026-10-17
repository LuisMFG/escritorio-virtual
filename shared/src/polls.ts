import { z } from 'zod';

/** Enquetes no chat da sala (Fase 25). */
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const POLL_QUESTION_MAX = 140;
export const POLL_OPTION_MAX = 60;

const text = (max: number, label: string) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(
      z.string().min(1, `${label} vazia.`).max(max, `${label} pode ter no máximo ${max} letras.`),
    );

export const pollCreateSchema = z.object({
  question: text(POLL_QUESTION_MAX, 'Pergunta'),
  options: z
    .array(text(POLL_OPTION_MAX, 'Opção'))
    .min(POLL_MIN_OPTIONS, `Dê pelo menos ${POLL_MIN_OPTIONS} opções.`)
    .max(POLL_MAX_OPTIONS, `No máximo ${POLL_MAX_OPTIONS} opções.`)
    .refine(
      (opts) => new Set(opts.map((o) => o.toLowerCase())).size === opts.length,
      'Tem opção repetida.',
    ),
  /** Sem nomes: só a contagem aparece. */
  anonymous: z.boolean().default(false),
});
export type PollCreate = z.input<typeof pollCreateSchema>;

export const pollVoteSchema = z.object({
  pollId: z.number().int().positive(),
  option: z
    .number()
    .int()
    .min(0)
    .max(POLL_MAX_OPTIONS - 1),
});
export const pollRefSchema = z.object({ pollId: z.number().int().positive() });

/**
 * `/enquete Pergunta? | opção 1 | opção 2` → dados da enquete; `null` se não for o comando.
 * Erros de formato voltam como `{ error }` para mostrar à pessoa.
 */
export function parsePollCommand(textIn: string): PollCreate | { error: string } | null {
  const m = /^\s*\/enquete(?:\s+([\s\S]*))?$/i.exec(textIn);
  if (!m) return null;
  const parts = (m[1] ?? '')
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 1 + POLL_MIN_OPTIONS) {
    return { error: 'Use: /enquete Pergunta? | opção 1 | opção 2 (até 6 opções).' };
  }
  return { question: parts[0]!, options: parts.slice(1), anonymous: false };
}

export interface PollOptionView {
  text: string;
  votes: number;
  /** Nomes de quem votou (vazio em enquete anônima). */
  voters: string[];
}

/** Como uma enquete aparece para quem está vendo (com o voto dessa pessoa). */
export interface PollView {
  id: number;
  messageId: number;
  question: string;
  options: PollOptionView[];
  total: number;
  anonymous: boolean;
  closed: boolean;
  createdBy: string;
  createdByName: string;
  /** Opção em que quem está vendo votou (`null` = não votou). */
  myVote: number | null;
}

export interface PollUpdated {
  poll: PollView;
}
