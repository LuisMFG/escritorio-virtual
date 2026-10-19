import {
  baseClassname,
  CATALOG_CATEGORIES,
  furniManifestEntrySchema,
  type CatalogItem,
  type FurniCatalog,
  type FurniManifestEntry,
} from '@office/shared';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HabboAssetsClient } from '../assets/HabboAssetsClient.js';
import { measureFurni } from '../assets/measureFurni.js';
import type { FurniCuration } from '../assets/furniCatalog.js';
import { ROOT_DIR } from '../config.js';
import type { Db } from '../db/client.js';
import { furniDefs } from '../db/schema.js';

/**
 * Móveis do catálogo completo (Fase 36). O catálogo (`catalog.json`, ~10 mil móveis) só tem nome,
 * categoria e tamanho; a definição de verdade (âncoras medidas no imager) é feita na primeira vez
 * que alguém usa o móvel, guardada no banco e somada às definições do processo.
 */
export class FurniDefService {
  private catalogCache: { mtime: number; byId: Map<string, CatalogItem> } | null = null;
  private readonly pending = new Map<string, Promise<FurniManifestEntry | null>>();
  /** Os do manifesto curado (sempre liberados, mesmo de categoria escondida). */
  private readonly curated: Set<string>;

  constructor(
    private readonly db: Db,
    /** As definições do processo (curadas + medidas); as novas entram aqui. */
    readonly defs: Map<string, FurniManifestEntry>,
    private readonly measure: (item: CatalogItem, id: string) => Promise<FurniManifestEntry>,
    private readonly catalogFile = join(
      ROOT_DIR,
      'client',
      'public',
      'assets',
      'furni',
      'catalog.json',
    ),
  ) {
    this.curated = new Set(this.defs.keys());
    for (const row of this.db.select().from(furniDefs).all()) {
      const parsed = furniManifestEntrySchema.safeParse(JSON.parse(row.json));
      if (parsed.success && !this.defs.has(row.id)) this.defs.set(row.id, parsed.data);
    }
    for (const [id, def] of this.defs) this.defs.set(id, withVisual(def, this.itemFor(def)));
  }

  /**
   * Definições que o cliente não tem no manifesto: as medidas e as curadas que passaram a ser
   * desenhadas por camadas (o cliente troca as dele por estas).
   */
  measured(): FurniManifestEntry[] {
    const ids = new Set(
      this.db
        .select({ id: furniDefs.id })
        .from(furniDefs)
        .all()
        .map((r) => r.id),
    );
    for (const [id, d] of this.defs) if (this.curated.has(id) && d.animated) ids.add(id);
    return [...ids]
      .map((id) => this.defs.get(id))
      .filter((d): d is FurniManifestEntry => Boolean(d));
  }

  /** Item do catálogo do desenho da definição (pelo classname sem cor). */
  private itemFor(def: FurniManifestEntry): CatalogItem | undefined {
    const cls = def.sprite ?? def.id;
    return this.item(cls) ?? this.item(baseClassname(cls));
  }

  /**
   * Pode ser colocado? Os curados sempre; os do catálogo, se a categoria não estiver escondida.
   * `null` = liberado; senão, o motivo.
   */
  blockedReason(id: string, hidden: readonly string[]): string | null {
    if (this.curated.has(id)) return null;
    const item = this.item(id);
    if (!item) return this.defs.has(id) ? null : 'Móvel desconhecido.';
    return hidden.includes(item.c) ? 'Essa categoria de móveis está desligada pelo admin.' : null;
  }

  /**
   * Revisões conhecidas do SWF de um móvel (pelo classname sem cor): a do catálogo e as das
   * definições (curadas ou medidas) que usam esse desenho. Vazio = desconhecido.
   */
  swfRevisions(classname: string): Set<number> {
    const out = new Set<number>();
    const item = this.catalog().get(classname);
    if (item && baseClassname(item.id) === classname) out.add(item.rev);
    for (const d of this.defs.values()) {
      if (d.revision && baseClassname(d.sprite ?? d.id) === classname) out.add(d.revision);
    }
    return out;
  }

  /** Item do catálogo pelo classname (inclui as variações de cor). */
  item(id: string): CatalogItem | undefined {
    return this.catalog().get(id);
  }

  /** A definição pronta do móvel, medindo na primeira vez. `null` = não está no catálogo. */
  async ensure(id: string): Promise<FurniManifestEntry | null> {
    const known = this.defs.get(id);
    if (known) return known;
    const item = this.item(id);
    if (!item) return null;
    let p = this.pending.get(id);
    if (!p) {
      p = this.measure(item, id).then((measured) => {
        const entry = withVisual(measured, item);
        this.defs.set(id, entry);
        this.db
          .insert(furniDefs)
          .values({ id, json: JSON.stringify(entry), createdAt: new Date() })
          .onConflictDoNothing()
          .run();
        return entry;
      });
      p.finally(() => this.pending.delete(id)).catch(() => undefined);
      this.pending.set(id, p);
    }
    return p;
  }

  private catalog(): Map<string, CatalogItem> {
    try {
      const mtime = statSync(this.catalogFile).mtimeMs;
      if (this.catalogCache?.mtime !== mtime) {
        const data = JSON.parse(readFileSync(this.catalogFile, 'utf8')) as FurniCatalog;
        const byId = new Map<string, CatalogItem>();
        for (const item of data.items) {
          byId.set(item.id, item);
          for (const c of item.colors ?? []) byId.set(c, item);
        }
        this.catalogCache = { mtime, byId };
      }
      return this.catalogCache.byId;
    } catch {
      return new Map();
    }
  }
}

/** Curadoria de um item do catálogo: tamanho e capacidades vêm do Habbo. */
export function curationFor(item: CatalogItem, id: string): FurniCuration {
  return {
    id,
    name: item.n,
    category: (CATALOG_CATEGORIES[item.c] ?? 'Outros').toLowerCase(),
    width: item.w,
    depth: item.d,
    // Altura de empilhar: a do Habbo (paredes não empilham nada).
    height: item.wall ? 0 : Math.min(10, Math.max(0, item.h)),
    canSit: Boolean(item.sit),
    canLay: Boolean(item.lay),
    // Teleporte no Habbo "dá para pisar" (a pessoa entra nele); aqui é sólido e se usa clicando.
    canWalk: Boolean(item.walk) && item.x !== 'teleport',
    wall: Boolean(item.wall),
    // Senta/deita na metade da altura (como as cadeiras curadas: altura 1, assento 0,5).
    sitHeight: item.sit || item.lay ? Math.min(1, Math.max(0.1, Math.round(item.h * 5) / 10)) : 0,
    interaction: item.x ?? (item.multi ? 'toggle' : undefined),
  };
}

/** Interações que desenham por cima da imagem do imager (quadro, tabuleiro): ficam estáticas. */
const OVERLAY_INTERACTIONS = new Set(['whiteboard', 'tictactoe', 'jira', 'kudos', 'board']);

/** Marca como desenhado por camadas se o Habbo anima esse móvel (Fase 37). */
export function withVisual(
  def: FurniManifestEntry,
  item: CatalogItem | undefined,
): FurniManifestEntry {
  const animated =
    def.source === 'habboassets' &&
    Boolean(item?.a) &&
    !def.surface &&
    !OVERLAY_INTERACTIONS.has(def.interaction ?? '');
  const canWalk = def.canWalk && def.interaction !== 'teleport';
  return def.animated === animated && def.canWalk === canWalk ? def : { ...def, animated, canWalk };
}

/** Mede pelo imager, com o tamanho e as capacidades do catálogo. */
export function imagerMeasure(client: HabboAssetsClient, cacheDir: string) {
  return (item: CatalogItem, id: string): Promise<FurniManifestEntry> =>
    measureFurni(client, curationFor(item, id), cacheDir);
}

/**
 * Sem imager (`FURNI_MEASURE=offline`, testes de ponta a ponta): todas as direções, âncora
 * padrão (centro da base) e dois estados para os que ligam/desligam.
 */
export function offlineMeasure() {
  return async (item: CatalogItem, id: string): Promise<FurniManifestEntry> => {
    const cur = curationFor(item, id);
    return furniManifestEntrySchema.parse({
      ...cur,
      directions: item.wall ? [2, 4] : [0, 2, 4, 6],
      revision: item.rev || undefined,
      states: item.multi ? [0, 1] : [],
    });
  };
}
