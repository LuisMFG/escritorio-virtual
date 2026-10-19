/**
 * Catálogo completo de móveis (Fase 36): os ~18 mil móveis do Habbo Brasil com nome em português,
 * categoria e tamanho, gerado pelo `npm run assets:furni` (`client/public/assets/furni/catalog.json`).
 * Cada móvel vira uma definição de verdade (âncoras medidas) só quando alguém vai usá-lo.
 */
import { z } from 'zod';

/** Um móvel do catálogo (chaves curtas: o arquivo tem milhares). */
export interface CatalogItem {
  /** Classname do Habbo (a variação de cor principal, quando houver). */
  id: string;
  /** Nome em português. */
  n: string;
  /** Categoria do Habbo (`chair`, `table`, `wall_decoration`…). */
  c: string;
  /** Vai na parede. */
  wall?: 1;
  /** Tamanho no chão (x, y) e altura. */
  w: number;
  d: number;
  h: number;
  sit?: 1;
  lay?: 1;
  /** Dá para andar por cima (tapetes). */
  walk?: 1;
  /** Liga/desliga (vários estados). */
  multi?: 1;
  /** Desenhado por camadas e animações do Habbo (Fase 37). */
  a?: 1;
  /** Comportamento especial (Fase 37): dado, teleporte ou jukebox. */
  x?: 'dice' | 'teleport' | 'jukebox';
  /** Revisão do SWF no Habbo. */
  rev: number;
  /** Variações de cor (classnames `base*N`), quando houver. */
  colors?: string[];
}

export interface FurniCatalog {
  version: 1;
  generatedAt: string;
  items: CatalogItem[];
}

/** Rótulos em português das categorias do Habbo (na ordem das abas). */
export const CATALOG_CATEGORIES: Record<string, string> = {
  chair: 'Assentos',
  table: 'Mesas',
  bed: 'Camas',
  shelf: 'Estantes',
  lighting: 'Luzes',
  plant: 'Plantas',
  rug: 'Tapetes',
  divider: 'Divisórias',
  decoration: 'Decoração',
  wall_decoration: 'Enfeites de parede',
  window: 'Janelas',
  vending_machine: 'Máquinas',
  food: 'Comida',
  trophy: 'Troféus',
  teleport: 'Teleportes',
  dice: 'Dados',
  tent: 'Barracas',
  misc: 'Diversos',
  other: 'Outros',
  extras: 'Extras',
  games: 'Jogos',
  music: 'Música',
  pets: 'Pets',
  sound_fx: 'Sons',
};

/** Escondidas por padrão (festa e jogos não combinam com escritório); o admin libera. */
export const DEFAULT_HIDDEN_CATEGORIES = ['games', 'music', 'pets', 'sound_fx', 'extras'];

/** Categorias de móvel aceitas no catálogo (as outras são do hotel: créditos, wired, presentes…). */
export const CATALOG_CATEGORY_IDS = Object.keys(CATALOG_CATEGORIES);

/** Classname sem a cor (`purablk_c16_round*8` → `purablk_c16_round`). */
export function baseClassname(id: string): string {
  return id.split('*')[0]!;
}

/** Busca no catálogo: todas as palavras no nome (sem acento) ou no classname. */
export function catalogMatches(item: Pick<CatalogItem, 'id' | 'n'>, terms: string[]): boolean {
  const text = `${item.n} ${item.id}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return terms.every((t) => text.includes(t));
}

/** Termos de busca normalizados. */
export function catalogTerms(query: string): string[] {
  return query
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Admin: categorias do catálogo escondidas. */
export const furniCategoriesSchema = z.object({ hidden: z.array(z.string().max(40)).max(40) });

/** `GET /api/furni/config`: o que o painel de decorar precisa saber. */
export interface FurniConfigResponse {
  hiddenCategories: string[];
}
