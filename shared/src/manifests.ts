import { z } from 'zod';

const direction = z.number().int().min(0).max(7);

/** Ponto da PNG (em pixels) que fica sobre o vértice de baixo do footprint. */
const anchor = z.tuple([z.number(), z.number()]);

export const furniManifestEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  width: z.number().int().min(1).max(10),
  depth: z.number().int().min(1).max(10),
  height: z.number().min(0).max(10),
  canSit: z.boolean().default(false),
  canWalk: z.boolean().default(false),
  sitHeight: z.number().min(0).max(10).default(0),
  directions: z.array(direction).min(1),
  /** Revisão do SWF no imager; fixar evita o redirect 302 e garante cache imutável. */
  revision: z.number().int().positive().optional(),
  color: z.number().int().min(0).optional(),
  /** Origem do asset: imager da HabboAssets ou arte local/provisória. */
  source: z.enum(['habboassets', 'local']).default('habboassets'),
  /** Âncoras por direção (chave = direção como string). */
  anchors: z.record(z.string().regex(/^[0-7]$/), anchor).default({}),
  /** Estados que o imager sabe desenhar (ex.: luminária [0, 1]). Vazio = sem estados. */
  states: z.array(z.number().int().min(0).max(20)).default([]),
  /** Âncoras de estados além do 0 (chave `direção:estado`); o estado 0 usa `anchors`. */
  stateAnchors: z.record(z.string().regex(/^[0-7]:\d+$/), anchor).default({}),
  /**
   * O que acontece ao clicar fora do modo decorar: `toggle` alterna os estados (luz, TV…),
   * `coffee` serve um café (emote), `board` abre o mural de recados, `whiteboard` abre o
   * quadro branco.
   */
  interaction: z.enum(['toggle', 'coffee', 'board', 'whiteboard']).optional(),
  /** Emite luz quando ligado (estado > 0): brilha à noite. */
  light: z.boolean().default(false),
  /**
   * Superfície onde aparece a miniatura do desenho (quadro branco): cantos superior esquerdo,
   * superior direito e inferior esquerdo, em pixels da PNG de cada direção.
   */
  surface: z.record(z.string().regex(/^[0-7]$/), z.tuple([anchor, anchor, anchor])).optional(),
});

export const furniManifestSchema = z.object({
  version: z.literal(1),
  hotelId: z.number().int().positive(),
  items: z.array(furniManifestEntrySchema),
});

export type FurniManifestEntry = z.infer<typeof furniManifestEntrySchema>;
export type FurniManifest = z.infer<typeof furniManifestSchema>;

/** Valida o manifesto de móveis e garante ids únicos e âncoras só para direções suportadas. */
export function parseFurniManifest(json: unknown): FurniManifest {
  const manifest = furniManifestSchema.parse(json);
  const seen = new Set<string>();
  for (const item of manifest.items) {
    if (seen.has(item.id)) throw new Error(`Móvel duplicado no manifesto: ${item.id}`);
    seen.add(item.id);
    for (const dir of Object.keys(item.anchors)) {
      if (!item.directions.includes(Number(dir))) {
        throw new Error(`Âncora para direção não suportada (${item.id}, direção ${dir})`);
      }
    }
  }
  return manifest;
}

/** Direção de render mais próxima que o móvel suporta (alguns só têm 0, ou 0 e 2). */
export function renderDirection(item: Pick<FurniManifestEntry, 'directions'>, rot: number): number {
  if (item.directions.includes(rot)) return rot;
  // Mesmo eixo (0↔4, 2↔6) costuma ter a mesma silhueta; senão, a primeira disponível.
  const opposite = (rot + 4) % 8;
  if (item.directions.includes(opposite)) return opposite;
  return item.directions[0]!;
}

const figurePartType = z.string().regex(/^[a-z]{2}$/);
const gender = z.enum(['M', 'F']);

export const avatarSetSchema = z.object({
  id: z.number().int().nonnegative(),
  gender: z.enum(['M', 'F', 'U']),
  /** Quantas cores a peça aceita (0 = não recolorível, 1 ou 2). */
  colors: z.number().int().min(0).max(2),
  defaultColors: z.array(z.number().int().nonnegative()).max(2).default([]),
  /** 0 = livre, 1/2 = Habbo Club no hotel (aqui não restringe nada; só informativo). */
  club: z.number().int().min(0).default(0),
  /** Biblioteca de roupa de origem na HabboAssets (para miniaturas e auditoria). */
  library: z.string().optional(),
});

export const avatarCategorySchema = z.object({
  type: figurePartType,
  label: z.string().min(1),
  /** Id da paleta (chave de `palettes`). */
  palette: z.string().min(1),
  required: z.boolean(),
  /** Ordem de desenho no renderer local de camadas (menor = mais atrás). */
  layer: z.number().int(),
  sets: z.array(avatarSetSchema),
});

export const avatarManifestSchema = z.object({
  version: z.literal(1),
  hotelId: z.number().int().positive(),
  imager: z.string().url(),
  generatedAt: z.string().optional(),
  defaults: z.object({ M: z.string().min(1), F: z.string().min(1) }),
  /** Paletas na ordem de exibição: id da cor no Habbo + hex. */
  palettes: z.record(
    z.string(),
    z.array(
      z.object({ id: z.number().int().nonnegative(), hex: z.string().regex(/^#[0-9a-f]{6}$/i) }),
    ),
  ),
  categories: z.array(avatarCategorySchema),
});

export type Gender = z.infer<typeof gender>;
export const genderSchema = gender;
export type AvatarSet = z.infer<typeof avatarSetSchema>;
export type AvatarCategory = z.infer<typeof avatarCategorySchema>;
export type AvatarManifest = z.infer<typeof avatarManifestSchema>;

export function parseAvatarManifest(json: unknown): AvatarManifest {
  const manifest = avatarManifestSchema.parse(json);
  const types = new Set<string>();
  for (const cat of manifest.categories) {
    if (types.has(cat.type)) throw new Error(`Categoria duplicada no manifesto: ${cat.type}`);
    types.add(cat.type);
    if (!(cat.palette in manifest.palettes)) {
      throw new Error(`Categoria ${cat.type} usa a paleta inexistente "${cat.palette}"`);
    }
  }
  return manifest;
}
