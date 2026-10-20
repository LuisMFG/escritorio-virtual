import {
  HABBO_HOTEL_ID,
  HABBOASSETS_IMAGER,
  parseAvatarManifest,
  validateFigure,
  type AvatarCategory,
  type AvatarManifest,
} from '@office/shared';

/** Resposta de `/imaging/info/clothing/{library}` na HabboAssets. */
export interface ClothingInfo {
  library: string;
  latest: string;
  revisions: {
    revision: string;
    sets: {
      id: number;
      type: string;
      gender: 'M' | 'F' | 'U';
      club: number;
      colors: number;
      palette: number;
      defaultColors?: number[];
      wearable?: boolean;
      animated?: boolean;
    }[];
  }[];
  palettes?: Record<string, { id: number; hex: string; club: number; selectable: boolean }[]>;
}

export interface CategoryCuration {
  type: string;
  label: string;
  required: boolean;
  layer: number;
  libraries: string[];
  /** Restringe gêneros (ex.: rostos só M/F, sem as dezenas de variações unissex). */
  genders?: ('M' | 'F' | 'U')[];
}

/**
 * Curadoria do editor: categorias, rótulos em PT-BR e de quais bibliotecas base do Habbo
 * (`hh_human_*`) vêm as peças. Ordem = ordem das abas no editor.
 */
export const AVATAR_CURATION: CategoryCuration[] = [
  {
    type: 'hd',
    label: 'Pele e rosto',
    required: true,
    layer: 0,
    libraries: ['hh_human_body'],
    genders: ['M', 'F'],
  },
  { type: 'hr', label: 'Cabelo', required: false, layer: 6, libraries: ['hh_human_hair'] },
  { type: 'ha', label: 'Chapéu', required: false, layer: 8, libraries: ['hh_human_hats'] },
  { type: 'ea', label: 'Óculos', required: false, layer: 7, libraries: ['hh_human_acc_eye'] },
  { type: 'ch', label: 'Blusa', required: true, layer: 3, libraries: ['hh_human_shirt'] },
  { type: 'cc', label: 'Casaco', required: false, layer: 5, libraries: ['hh_human_shirt'] },
  { type: 'ca', label: 'Acessório', required: false, layer: 4, libraries: ['hh_human_acc_chest'] },
  { type: 'lg', label: 'Calça', required: true, layer: 1, libraries: ['hh_human_leg'] },
  { type: 'sh', label: 'Sapatos', required: false, layer: 2, libraries: ['hh_human_shoe'] },
];

/**
 * Catálogo completo (Fase 35; tudo desde 20/10/2026): as mesmas categorias e mais acessório de
 * cabeça, máscara, estampa, cinto, itens diversos e pet de ombro, com peças de **todas** as
 * bibliotecas de roupa (`*`), inclusive NFT e peles/rostos unissex.
 */
export const FULL_CATALOG: CategoryCuration[] = [
  { ...AVATAR_CURATION[0]!, libraries: ['*'], genders: undefined },
  ...AVATAR_CURATION.slice(1, 3).map((c) => ({ ...c, libraries: ['*'] })),
  { type: 'he', label: 'Acessório de cabeça', required: false, layer: 9, libraries: ['*'] },
  ...AVATAR_CURATION.slice(3, 4).map((c) => ({ ...c, libraries: ['*'] })),
  { type: 'fa', label: 'Máscara', required: false, layer: 7, libraries: ['*'] },
  ...AVATAR_CURATION.slice(4, 5).map((c) => ({ ...c, libraries: ['*'] })),
  { type: 'cp', label: 'Estampa', required: false, layer: 3, libraries: ['*'] },
  ...AVATAR_CURATION.slice(5, 7).map((c) => ({ ...c, libraries: ['*'] })),
  { type: 'wa', label: 'Cinto', required: false, layer: 4, libraries: ['*'] },
  ...AVATAR_CURATION.slice(7).map((c) => ({ ...c, libraries: ['*'] })),
  { type: 'mc', label: 'Diversos', required: false, layer: 4, libraries: ['*'] },
  { type: 'pt', label: 'Pet de ombro', required: false, layer: 9, libraries: ['*'] },
];

export const AVATAR_DEFAULTS = {
  M: 'hd-180-1.hr-100-61.ch-210-66.lg-270-82.sh-290-80',
  F: 'hd-600-1.hr-515-33.ch-630-73.lg-695-82.sh-725-64',
};

/** Monta o manifesto do avatar a partir das bibliotecas baixadas. Puro: testável sem rede. */
export function buildAvatarManifest(
  infos: ReadonlyMap<string, ClothingInfo>,
  curation: readonly CategoryCuration[] = AVATAR_CURATION,
  defaults: { M: string; F: string } = AVATAR_DEFAULTS,
): AvatarManifest {
  const palettes: AvatarManifest['palettes'] = {};
  const categories: AvatarCategory[] = [];

  for (const cur of curation) {
    const sets = new Map<number, AvatarCategory['sets'][number]>();
    const paletteVotes = new Map<number, number>();
    const libraries = cur.libraries.includes('*') ? [...infos.keys()] : cur.libraries;
    const perSet = new Map<number, number>();
    for (const library of libraries) {
      const info = infos.get(library);
      if (!info) throw new Error(`Biblioteca não baixada: ${library}`);
      const rev = info.revisions.find((r) => r.revision === info.latest) ?? info.revisions[0];
      for (const s of rev?.sets ?? []) {
        if (s.type !== cur.type || s.wearable === false) continue;
        if (cur.genders && !cur.genders.includes(s.gender)) continue;
        if (sets.has(s.id)) continue;
        paletteVotes.set(s.palette, (paletteVotes.get(s.palette) ?? 0) + 1);
        perSet.set(s.id, s.palette);
        sets.set(s.id, {
          id: s.id,
          gender: s.gender,
          colors: Math.min(2, Math.max(0, s.colors)),
          defaultColors: (s.defaultColors ?? []).slice(0, 2),
          club: s.club,
          library,
          ...(library.startsWith('hh_human_') ? {} : { rev: Number(info.latest) }),
          ...(s.animated ? { animated: true } : {}),
        });
      }
      for (const [pid, colors] of Object.entries(info.palettes ?? {})) {
        palettes[pid] ??= colors
          .filter((c) => c.selectable)
          .map((c) => ({ id: c.id, hex: `#${c.hex.toLowerCase()}` }));
      }
    }
    if (sets.size === 0) throw new Error(`Nenhuma peça encontrada para ${cur.type}`);
    const palette = [...paletteVotes].sort((a, b) => b[1] - a[1])[0]![0];
    // Peças com outra paleta guardam a sua (as cores são validadas e pintadas por ela).
    for (const set of sets.values()) {
      const own = perSet.get(set.id);
      if (own !== undefined && own !== palette) set.palette = String(own);
    }
    categories.push({
      type: cur.type,
      label: cur.label,
      palette: String(palette),
      required: cur.required,
      layer: cur.layer,
      sets: [...sets.values()].sort((a, b) => a.id - b.id),
    });
  }

  const usedPalettes = new Set(
    categories.flatMap((c) => [
      c.palette,
      ...c.sets.flatMap((s) => (s.palette ? [s.palette] : [])),
    ]),
  );
  const manifest = parseAvatarManifest({
    version: 1,
    hotelId: HABBO_HOTEL_ID,
    imager: `${HABBOASSETS_IMAGER}/avatar.png`,
    generatedAt: new Date().toISOString(),
    defaults,
    palettes: Object.fromEntries(Object.entries(palettes).filter(([id]) => usedPalettes.has(id))),
    categories,
  });

  for (const gender of ['M', 'F'] as const) {
    const res = validateFigure(defaults[gender], gender, manifest);
    if (!res.ok) throw new Error(`Visual padrão ${gender} inválido: ${res.error}`);
  }
  return manifest;
}
