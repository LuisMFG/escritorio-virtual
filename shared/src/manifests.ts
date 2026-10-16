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

export const avatarManifestSchema = z.object({
  version: z.literal(1),
  hotelId: z.number().int().positive(),
  imager: z.string().url(),
  defaults: z.object({ M: z.string().min(1), F: z.string().min(1) }),
  /** Paletas: id da cor no Habbo → hex, usado pelos seletores do editor (Fase 3). */
  palettes: z.record(z.string(), z.record(z.string(), z.string().regex(/^#[0-9a-f]{6}$/i))),
  categories: z.array(
    z.object({
      type: figurePartType,
      label: z.string().min(1),
      palette: z.string().min(1),
      required: z.boolean(),
      sets: z.array(
        z.object({
          id: z.number().int().nonnegative(),
          gender: z.enum(['M', 'F', 'U']),
          colorable: z.boolean(),
        }),
      ),
    }),
  ),
});

export type AvatarManifest = z.infer<typeof avatarManifestSchema>;

export function parseAvatarManifest(json: unknown): AvatarManifest {
  const manifest = avatarManifestSchema.parse(json);
  for (const cat of manifest.categories) {
    if (!(cat.palette in manifest.palettes)) {
      throw new Error(`Categoria ${cat.type} usa a paleta inexistente "${cat.palette}"`);
    }
  }
  return manifest;
}
