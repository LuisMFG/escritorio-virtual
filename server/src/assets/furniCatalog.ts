import type { FurniManifestEntry } from '@office/shared';

/**
 * Curadoria do catálogo de móveis (Habbo BR). Nome e categoria em PT-BR; tamanho quando
 * conhecido. O `assets:sync` completa revisão, direções e âncoras a partir do imager e,
 * se faltar o tamanho, usa a estimativa medida nas imagens.
 */
export interface FurniCuration {
  id: string;
  name: string;
  category: string;
  width?: number;
  depth?: number;
  height: number;
  canSit?: boolean;
  /** Camas e afins: deita (Fase 33). */
  canLay?: boolean;
  canWalk?: boolean;
  sitHeight?: number;
  /**
   * `local`: arte própria/CC0 em client/public/assets/local/furni/{id}_{dir}.png (registre a
   * origem no ASSETS.md). Nesse caso informe `width`, `depth`, `directions` e `anchors`.
   */
  source?: 'habboassets' | 'local';
  directions?: number[];
  anchors?: Record<string, [number, number]>;
  interaction?:
    'toggle' | 'coffee' | 'fridge' | 'board' | 'whiteboard' | 'tictactoe' | 'kudos' | 'jira';
  /** Arte de outro móvel do Habbo (padrão = `id`). */
  sprite?: string;
  /** Cantos do papel na PNG (ver `surface` no manifesto). */
  surface?: Record<string, [[number, number], [number, number], [number, number]]>;
  /** Emite luz quando ligado. */
  light?: boolean;
}

const SIT = { canSit: true, sitHeight: 0.5 } as const;
const LAY = { canLay: true } as const;
const TOGGLE = { interaction: 'toggle' } as const;
const LIGHT = { interaction: 'toggle', light: true } as const;

export const FURNI_CURATION: FurniCuration[] = [
  {
    id: 'chair_norja',
    name: 'Cadeira Norja',
    category: 'cadeiras',
    width: 1,
    depth: 1,
    height: 1,
    ...SIT,
  },
  {
    id: 'chair_silo',
    name: 'Cadeira Silo',
    category: 'cadeiras',
    width: 1,
    depth: 1,
    height: 1,
    ...SIT,
  },
  {
    id: 'chair_plasto',
    name: 'Cadeira de Plástico',
    category: 'cadeiras',
    width: 1,
    depth: 1,
    height: 1,
    ...SIT,
  },
  {
    id: 'exe_chair',
    name: 'Cadeira Executiva',
    category: 'cadeiras',
    width: 1,
    depth: 1,
    height: 1,
    ...SIT,
  },
  {
    id: 'couch_norja',
    name: 'Sofá Norja',
    category: 'sofás',
    width: 2,
    depth: 1,
    height: 1,
    ...SIT,
  },
  { id: 'sofa_silo', name: 'Sofá Silo', category: 'sofás', width: 2, depth: 1, height: 1, ...SIT },
  {
    id: 'sofachair_silo',
    name: 'Poltrona Silo',
    category: 'sofás',
    width: 1,
    depth: 1,
    height: 1,
    ...SIT,
  },
  { id: 'exe_sofa', name: 'Sofá Executivo', category: 'sofás', height: 1, ...SIT },
  // Fase 33: banqueta, pufe e almofada (sentar) e camas e saco de dormir (deitar).
  {
    id: 'bar_chair_armas',
    name: 'Banqueta de Bar',
    category: 'cadeiras',
    width: 1,
    depth: 1,
    height: 1,
    canSit: true,
    sitHeight: 0.9,
  },
  { id: 'pura_mdl1', name: 'Pufe', category: 'sofás', width: 1, depth: 1, height: 1, ...SIT },
  {
    id: 'pillow_bronze',
    name: 'Almofada',
    category: 'sofás',
    width: 1,
    depth: 1,
    height: 1,
    canSit: true,
    sitHeight: 0.2,
  },
  {
    id: 'bed_polyfon',
    name: 'Cama de Casal',
    category: 'camas',
    width: 2,
    depth: 3,
    height: 1,
    sitHeight: 0.5,
    ...LAY,
  },
  {
    id: 'bed_budget_one',
    name: 'Cama de Solteiro',
    category: 'camas',
    width: 1,
    depth: 3,
    height: 1,
    sitHeight: 0.5,
    ...LAY,
  },
  {
    id: 'sleepingbag',
    name: 'Saco de Dormir',
    category: 'camas',
    width: 1,
    depth: 3,
    height: 1,
    sitHeight: 0.1,
    ...LAY,
  },
  { id: 'table_norja_med', name: 'Mesa Norja', category: 'mesas', width: 2, depth: 2, height: 1 },
  { id: 'table_silo_med', name: 'Mesa Silo', category: 'mesas', width: 2, depth: 2, height: 1 },
  {
    id: 'table_plasto_square',
    name: 'Mesinha de Plástico',
    category: 'mesas',
    width: 1,
    depth: 1,
    height: 1,
  },
  { id: 'exe_table', name: 'Mesa Executiva', category: 'mesas', height: 1 },
  {
    // Cavalete com quadro: abre o mural de elogios da equipe (Fase 26).
    id: 'easel_0',
    name: 'Quadro de Elogios',
    category: 'escritório',
    width: 1,
    depth: 1,
    height: 2,
    interaction: 'kudos',
  },
  {
    // Mesa redonda que vira mesa de jogos: o tabuleiro é desenhado pela cena em cima dela.
    id: 'table_plasto_round',
    name: 'Mesa de Jogos',
    category: 'diversão',
    width: 1,
    depth: 1,
    height: 1,
    interaction: 'tictactoe',
  },
  {
    id: 'plant_big_cactus',
    name: 'Cacto Grande',
    category: 'plantas',
    width: 1,
    depth: 1,
    height: 1,
  },
  { id: 'plant_yukka', name: 'Iuca', category: 'plantas', width: 1, depth: 1, height: 1 },
  {
    id: 'plant_pineapple',
    name: 'Abacaxizeiro',
    category: 'plantas',
    width: 1,
    depth: 1,
    height: 1,
  },
  { id: 'plant_bonsai', name: 'Bonsai', category: 'plantas', width: 1, depth: 1, height: 1 },
  { id: 'exe_plant', name: 'Planta Executiva', category: 'plantas', width: 1, depth: 1, height: 1 },
  {
    id: 'shelves_norja',
    name: 'Estante Norja',
    category: 'estantes',
    width: 1,
    depth: 1,
    height: 2,
  },
  { id: 'shelves_silo', name: 'Estante Silo', category: 'estantes', height: 2 },
  { id: 'shelves_basic', name: 'Estante Simples', category: 'estantes', height: 2 },
  {
    id: 'uni_c23_whiteboard',
    name: 'Quadro Branco',
    category: 'escritório',
    width: 1,
    depth: 1,
    height: 2,
    interaction: 'whiteboard',
    // Papel do cavalete, medido nos pixels claros das PNGs (direção 2 é o espelho da 0).
    surface: {
      '0': [
        [6, 15],
        [29, 4],
        [28, 70],
      ],
      '2': [
        [29, 4],
        [52, 15],
        [7, 59],
      ],
    },
  },
  {
    // Quadro de Demandas (Fase 30): mesma arte do quadro branco, com um mini-kanban no papel.
    id: 'jira_board',
    sprite: 'uni_c23_whiteboard',
    name: 'Quadro de Demandas',
    category: 'escritório',
    width: 1,
    depth: 1,
    height: 2,
    interaction: 'jira',
    surface: {
      '0': [
        [6, 15],
        [29, 4],
        [28, 70],
      ],
      '2': [
        [29, 4],
        [52, 15],
        [7, 59],
      ],
    },
  },
  {
    id: 'noticeboard',
    name: 'Mural de Recados',
    category: 'escritório',
    height: 2,
    interaction: 'board',
  },
  { id: 'hc_dsk', name: 'Escrivaninha Club', category: 'escritório', height: 1, ...TOGGLE },
  { id: 'exe_corner', name: 'Mesa de Canto Executiva', category: 'escritório', height: 1 },
  // Tamanhos conferidos no render: a moldura passa um pouco do footprint.
  {
    id: 'exe_map',
    name: 'Mapa-Múndi',
    category: 'escritório',
    width: 3,
    depth: 1,
    height: 2,
    ...TOGGLE,
  },
  { id: 'safe_silo', name: 'Cofre', category: 'escritório', height: 1, ...TOGGLE },
  { id: 'divider_nor1', name: 'Divisória Norja', category: 'escritório', height: 1 },
  { id: 'hc_bkshlf', name: 'Estante Club', category: 'estantes', height: 2 },
  // TI
  {
    id: 'computer_flatscreen',
    name: 'Computador',
    category: 'TI',
    width: 1,
    depth: 1,
    height: 1,
    ...TOGGLE,
  },
  { id: 'computer_old', name: 'Computador Antigo', category: 'TI', width: 1, depth: 1, height: 1 },
  { id: 'tv_luxus', name: 'TV Clássica', category: 'TI', height: 1, ...TOGGLE },
  { id: 'hc_tv', name: 'TV Club', category: 'TI', height: 1, ...TOGGLE },
  { id: 'rare_fan', name: 'Ventilador', category: 'TI', width: 1, depth: 1, height: 1, ...TOGGLE },
  // Luzes
  {
    id: 'lamp_armas',
    name: 'Luminária Rústica',
    category: 'luzes',
    width: 1,
    depth: 1,
    height: 1,
    ...LIGHT,
  },
  {
    id: 'lamp2_armas',
    name: 'Candeeiro',
    category: 'luzes',
    width: 1,
    depth: 1,
    height: 1,
    ...LIGHT,
  },
  { id: 'hc_lmp', name: 'Abajur Club', category: 'luzes', width: 1, depth: 1, height: 1, ...LIGHT },
  {
    id: 'exe_artlamp',
    name: 'Luminária de Arte',
    category: 'luzes',
    width: 1,
    depth: 1,
    height: 1,
    ...LIGHT,
  },
  {
    id: 'exe_light',
    name: 'Luz Executiva',
    category: 'luzes',
    width: 1,
    depth: 1,
    height: 1,
    ...LIGHT,
  },
  { id: 'fireplace_armas', name: 'Lareira', category: 'luzes', height: 1, ...LIGHT },
  { id: 'exe_globe', name: 'Globo', category: 'escritório', width: 1, depth: 1, height: 1 },
  {
    id: 'lamp_basic',
    name: 'Luminária',
    category: 'luzes',
    width: 1,
    depth: 1,
    height: 1,
    ...LIGHT,
  },
  { id: 'divider_silo1', name: 'Divisória Silo', category: 'escritório', height: 1 },
  {
    id: 'sunsetcafe_c20_coffeemachine',
    name: 'Máquina de Café',
    category: 'cozinha',
    width: 1,
    depth: 1,
    height: 1,
    interaction: 'coffee',
  },
  { id: 'bardesk_polyfon', name: 'Balcão', category: 'cozinha', height: 1 },
  // Abre e entrega uma bebida (Fase 34).
  { id: 'fridge', name: 'Geladeira', category: 'cozinha', height: 2, interaction: 'fridge' },
  {
    id: 'hc_machine',
    name: 'Máquina de Bebidas',
    category: 'cozinha',
    width: 1,
    depth: 2,
    height: 2,
    interaction: 'coffee',
  },
  {
    id: 'chair_polyfon',
    name: 'Cadeira Polyfon',
    category: 'cadeiras',
    width: 1,
    depth: 1,
    height: 1,
    ...SIT,
  },
  {
    id: 'hc_chr',
    name: 'Cadeira Club',
    category: 'cadeiras',
    width: 1,
    depth: 1,
    height: 1,
    ...SIT,
  },
  {
    id: 'sofa_polyfon',
    name: 'Sofá Polyfon',
    category: 'sofás',
    width: 2,
    depth: 1,
    height: 1,
    ...SIT,
  },
  { id: 'plant_sunflower', name: 'Girassol', category: 'plantas', width: 1, depth: 1, height: 1 },
  {
    id: 'plant_small_cactus',
    name: 'Cacto Pequeno',
    category: 'plantas',
    width: 1,
    depth: 1,
    height: 1,
  },
  {
    id: 'carpet_standard',
    name: 'Tapete',
    category: 'tapetes',
    width: 3,
    depth: 5,
    height: 0,
    canWalk: true,
  },
  { id: 'carpet_soft', name: 'Tapete Macio', category: 'tapetes', height: 0, canWalk: true },
];

/** Imagem RGBA decodificada (ex.: pngjs). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Buffer;
}

export interface RenderAnalysis {
  /** Pixel que fica sobre o vértice de baixo do footprint (centro da linha opaca mais baixa). */
  anchor: [number, number];
  /** Distância horizontal do canto esquerdo da imagem até a âncora, em tiles (≈ largura no eixo da direção). */
  leftTiles: number;
  rightTiles: number;
}

/**
 * Mede uma imagem do imager (já recortada no conteúdo): a linha opaca mais baixa costuma ser
 * o pé do móvel no vértice de baixo do footprint. Daí saem a âncora e, como o vértice de baixo
 * fica a `w*32` px do canto esquerdo, uma estimativa do tamanho.
 */
export function analyzeRender(img: RgbaImage): RenderAnalysis {
  const alpha = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]!;
  for (let y = img.height - 1; y >= 0; y--) {
    let min = -1;
    let max = -1;
    for (let x = 0; x < img.width; x++) {
      if (alpha(x, y) > 0) {
        if (min < 0) min = x;
        max = x;
      }
    }
    if (min >= 0) {
      const cx = (min + max) / 2;
      return { anchor: [cx, y], leftTiles: cx / 32, rightTiles: (img.width - cx) / 32 };
    }
  }
  return { anchor: [img.width / 2, img.height], leftTiles: 0, rightTiles: 0 };
}

/** Estima largura/profundidade (rot 0) a partir das análises das direções disponíveis. */
export function estimateSize(byDir: ReadonlyMap<number, RenderAnalysis>): {
  width: number;
  depth: number;
} {
  const r = (n: number) => Math.max(1, Math.round(n));
  const d0 = byDir.get(0) ?? byDir.get(4);
  const d2 = byDir.get(2) ?? byDir.get(6);
  if (d0 && d2) return { width: r(d0.leftTiles), depth: r(d2.leftTiles) };
  const any = d0 ?? d2 ?? [...byDir.values()][0];
  if (!any) return { width: 1, depth: 1 };
  return d0
    ? { width: r(any.leftTiles), depth: r(any.rightTiles) }
    : { width: r(any.rightTiles), depth: r(any.leftTiles) };
}

/** Entrada de um móvel local (não passa pelo imager). */
export function buildLocalEntry(cur: FurniCuration): FurniManifestEntry {
  return {
    id: cur.id,
    name: cur.name,
    category: cur.category,
    width: cur.width ?? 1,
    depth: cur.depth ?? 1,
    height: cur.height,
    canSit: cur.canSit ?? false,
    canLay: cur.canLay ?? false,
    canWalk: cur.canWalk ?? false,
    sitHeight: cur.sitHeight ?? 0,
    directions: cur.directions ?? [0],
    source: 'local',
    anchors: cur.anchors ?? {},
    states: [],
    stateAnchors: {},
    interaction: cur.interaction,
    light: cur.light ?? false,
  };
}

/** Entrada do manifesto a partir da curadoria + dados medidos. */
export function buildFurniEntry(
  cur: FurniCuration,
  info: { latest: number; directions: number[]; states?: number[] },
  analyses: ReadonlyMap<number, RenderAnalysis>,
  /** Âncoras dos estados > 0 (chave `direção:estado`). */
  stateAnalyses: ReadonlyMap<string, RenderAnalysis> = new Map(),
): { entry: FurniManifestEntry; estimated: { width: number; depth: number } } {
  const estimated = estimateSize(analyses);
  const anchors: Record<string, [number, number]> = {};
  for (const [dir, a] of analyses) anchors[String(dir)] = a.anchor;
  const stateAnchors: Record<string, [number, number]> = {};
  for (const [key, a] of stateAnalyses) stateAnchors[key] = a.anchor;
  return {
    estimated,
    entry: {
      id: cur.id,
      name: cur.name,
      category: cur.category,
      width: cur.width ?? estimated.width,
      depth: cur.depth ?? estimated.depth,
      height: cur.height,
      canSit: cur.canSit ?? false,
      canLay: cur.canLay ?? false,
      canWalk: cur.canWalk ?? false,
      sitHeight: cur.sitHeight ?? 0,
      directions: info.directions,
      revision: info.latest,
      source: 'habboassets',
      anchors,
      states: info.states ?? [],
      stateAnchors,
      interaction: cur.interaction,
      light: cur.light ?? false,
      surface: cur.surface,
      ...(cur.sprite ? { sprite: cur.sprite } : {}),
    },
  };
}
