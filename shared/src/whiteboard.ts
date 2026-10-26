import { z } from 'zod';

/**
 * Quadro branco (Fase 15). Coordenadas num espaço fixo de `WB_WIDTH × WB_HEIGHT`, para o
 * desenho ficar igual em qualquer tela. Traços vão inteiros para o servidor (e o banco); os
 * rascunhos (`wb.draft`) são só para os outros verem o traço nascer em tempo real.
 */
export const WB_WIDTH = 1200;
export const WB_HEIGHT = 900;
/** Pontos por traço (traços maiores o cliente divide): mantém cada mensagem bem abaixo de 4 KB. */
export const WB_MAX_POINTS = 400;
export const WB_MAX_STROKES = 3000;
export const WB_TEXT_MAX = 80;

export const WB_COLORS = [
  '#1f2937',
  '#dc2626',
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#9333ea',
] as const;
export const WB_WIDTHS = [3, 6, 12] as const;
/** Borracha = pincel da cor do papel. */
export const WB_PAPER = '#ffffff';

const coord = z.number().int().min(0).max(Math.max(WB_WIDTH, WB_HEIGHT));
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const furniId = z.string().min(1).max(40);

export const wbPathSchema = z.object({
  tool: z.enum(['pen', 'eraser']),
  color,
  width: z.number().int().min(1).max(40),
  /** `[x0, y0, x1, y1, …]` */
  points: z
    .array(coord)
    .min(2)
    .max(WB_MAX_POINTS * 2)
    .refine((p) => p.length % 2 === 0, 'Pontos incompletos.'),
});

export const wbTextSchema = z.object({
  tool: z.literal('text'),
  color,
  /** Tamanho da fonte (no espaço do quadro). */
  width: z.number().int().min(12).max(96),
  x: coord,
  y: coord,
  text: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(WB_TEXT_MAX)),
});

export const wbStrokeInputSchema = z.discriminatedUnion('tool', [wbPathSchema, wbTextSchema]);
export type WbStrokeInput = z.infer<typeof wbStrokeInputSchema>;

/** Traço salvo (com id e autor). */
export type WbStroke = WbStrokeInput & { id: number; userId: string };

export const wbRefSchema = z.object({ furniId });
/** Por quanto tempo (ms) quem limpou o quadro pode desfazer. */
export const WB_UNDO_MS = 15_000;

/** Quadro aberto na tela (`''` = fechou): só quem está vendo recebe os rascunhos ao vivo. */
export const wbWatchSchema = z.object({ furniId: z.union([furniId, z.literal('')]) });
export const wbStrokeSchema = z.object({
  furniId,
  stroke: wbStrokeInputSchema,
  /** Rascunho que este traço finaliza. */
  draftId: z.string().min(1).max(20).optional(),
});
export const wbDraftSchema = z.object({
  furniId,
  /** Id local do traço em andamento (some quando o traço definitivo chega). */
  draftId: z.string().min(1).max(20),
  tool: z.enum(['pen', 'eraser']),
  color,
  width: z.number().int().min(1).max(40),
  /** Pontos novos desde o último rascunho. */
  points: z.array(coord).max(200),
});
export type WbDraft = z.infer<typeof wbDraftSchema> & { sessionId: string };

export interface WbStrokeMessage {
  furniId: string;
  stroke: WbStroke;
  /** Rascunho que este traço substitui (para os outros apagarem a prévia). */
  draftId?: string;
  sessionId: string;
}

export interface WbRemovedMessage {
  furniId: string;
  ids: number[];
}

/** Divide uma lista de pontos em pedaços de até `WB_MAX_POINTS` (cada um continua do anterior). */
export function splitPoints(points: readonly number[]): number[][] {
  const max = WB_MAX_POINTS * 2;
  if (points.length <= max) return [points.slice()];
  const parts: number[][] = [];
  for (let i = 0; i < points.length - 2; i += max - 2) parts.push(points.slice(i, i + max));
  return parts;
}
