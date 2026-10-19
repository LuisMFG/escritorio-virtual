import { parseFigure, serializeFigure, type FigurePart } from './figure.js';
import type { AvatarCategory, AvatarManifest, AvatarSet, Gender } from './manifests.js';

export type FigureValidation = { ok: true; figure: string } | { ok: false; error: string };

const PART_RE = /^[a-z]{2}-\d{1,6}(-\d{1,4}){0,2}$/;

export function findCategory(manifest: AvatarManifest, type: string): AvatarCategory | undefined {
  return manifest.categories.find((c) => c.type === type);
}

export function findSet(category: AvatarCategory, setId: number): AvatarSet | undefined {
  return category.sets.find((s) => s.id === setId);
}

/** A peça serve para esse gênero? (`U` = unissex). */
export function setFitsGender(set: AvatarSet, gender: Gender): boolean {
  return set.gender === 'U' || set.gender === gender;
}

export function paletteColorIds(manifest: AvatarManifest, paletteId: string): number[] {
  return (manifest.palettes[paletteId] ?? []).map((c) => c.id);
}

export function paletteHex(
  manifest: AvatarManifest,
  paletteId: string,
  colorId: number,
): string | undefined {
  return manifest.palettes[paletteId]?.find((c) => c.id === colorId)?.hex;
}

/** Ordena as peças na ordem das categorias do manifesto (string canônica, boa para cache). */
export function normalizeParts(
  parts: readonly FigurePart[],
  manifest: AvatarManifest,
): FigurePart[] {
  const order = new Map(manifest.categories.map((c, i) => [c.type, i]));
  return [...parts].sort((a, b) => (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99));
}

/**
 * Validação rigorosa de uma figure string contra o manifesto: categorias conhecidas e sem
 * repetição, set existente e compatível com o gênero, cores da paleta certa e categorias
 * obrigatórias presentes. Devolve a string normalizada.
 */
export function validateFigure(
  figure: string,
  gender: Gender,
  manifest: AvatarManifest,
): FigureValidation {
  if (typeof figure !== 'string' || figure.length === 0 || figure.length > 512) {
    return { ok: false, error: 'Visual vazio ou grande demais.' };
  }
  const raw = figure.split('.');
  if (raw.some((r) => !PART_RE.test(r))) return { ok: false, error: 'Visual em formato inválido.' };

  const parts = parseFigure(figure);
  const seen = new Set<string>();
  for (const part of parts) {
    if (seen.has(part.type)) return { ok: false, error: `Peça repetida: ${part.type}.` };
    seen.add(part.type);

    const category = findCategory(manifest, part.type);
    if (!category) return { ok: false, error: `Tipo de peça não permitido: ${part.type}.` };
    const set = findSet(category, part.setId);
    if (!set) return { ok: false, error: `Peça inexistente: ${category.label} #${part.setId}.` };
    if (!setFitsGender(set, gender)) {
      return {
        ok: false,
        error: `${category.label} #${part.setId} não combina com o gênero escolhido.`,
      };
    }
    // Peças não recoloríveis ainda podem trazer uma cor (o Habbo aceita e ignora).
    if (part.colors.length > Math.max(1, set.colors)) {
      return { ok: false, error: `Cores demais em ${category.label} #${part.setId}.` };
    }
    const allowed = paletteColorIds(manifest, set.palette ?? category.palette);
    if (part.colors.some((c) => !allowed.includes(c))) {
      return { ok: false, error: `Cor inválida em ${category.label}.` };
    }
  }
  for (const category of manifest.categories) {
    if (category.required && !seen.has(category.type)) {
      return { ok: false, error: `Falta escolher: ${category.label}.` };
    }
  }
  return { ok: true, figure: serializeFigure(normalizeParts(parts, manifest)) };
}

/** Cores iniciais de uma peça: as padrão do Habbo, ou a primeira da paleta. */
export function initialColors(
  set: AvatarSet,
  manifest: AvatarManifest,
  category: AvatarCategory,
): number[] {
  const n = set.colors;
  if (n === 0) return [];
  const palette = paletteColorIds(manifest, set.palette ?? category.palette);
  const colors = set.defaultColors.filter((c) => palette.includes(c)).slice(0, n);
  while (colors.length < n && palette.length > 0)
    colors.push(palette[colors.length % palette.length]!);
  return colors;
}

/** Troca (ou remove, com `setId = null`) a peça de uma categoria, preservando as cores quando possível. */
export function withPart(
  figure: string,
  manifest: AvatarManifest,
  type: string,
  setId: number | null,
  colors?: number[],
): string {
  const parts = parseFigure(figure).filter((p) => p.type !== type);
  if (setId !== null) {
    const category = findCategory(manifest, type);
    const set = category && findSet(category, setId);
    if (!category || !set) return figure;
    const previous = parseFigure(figure).find((p) => p.type === type)?.colors ?? [];
    const palette = paletteColorIds(manifest, set.palette ?? category.palette);
    let chosen = (colors ?? previous).filter((c) => palette.includes(c)).slice(0, set.colors);
    if (chosen.length < set.colors) chosen = initialColors(set, manifest, category);
    parts.push({ type, setId, colors: chosen });
  }
  return serializeFigure(normalizeParts(parts, manifest));
}

/** Troca o gênero mantendo o que serve e trocando o resto pelas peças do visual padrão. */
export function switchGender(figure: string, to: Gender, manifest: AvatarManifest): string {
  const fallback = parseFigure(manifest.defaults[to]);
  const kept: FigurePart[] = [];
  for (const part of parseFigure(figure)) {
    const category = findCategory(manifest, part.type);
    const set = category && findSet(category, part.setId);
    if (set && setFitsGender(set, to)) kept.push(part);
    else {
      const replacement = fallback.find((p) => p.type === part.type);
      if (replacement) kept.push(replacement);
    }
  }
  for (const req of manifest.categories.filter((c) => c.required)) {
    if (!kept.some((p) => p.type === req.type)) {
      const replacement = fallback.find((p) => p.type === req.type);
      if (replacement) kept.push(replacement);
    }
  }
  return serializeFigure(normalizeParts(kept, manifest));
}

/** Visual aleatório válido para o gênero (obrigatórias sempre; opcionais com 50% de chance). */
export function randomFigure(
  manifest: AvatarManifest,
  gender: Gender,
  random: () => number = Math.random,
): string {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const parts: FigurePart[] = [];
  for (const category of manifest.categories) {
    const sets = category.sets.filter((s) => setFitsGender(s, gender));
    if (sets.length === 0 || (!category.required && random() < 0.5)) continue;
    const set = pick(sets);
    const palette = paletteColorIds(manifest, set.palette ?? category.palette);
    const colors = Array.from({ length: set.colors }, () => pick(palette));
    parts.push({ type: category.type, setId: set.id, colors });
  }
  return serializeFigure(normalizeParts(parts, manifest));
}
