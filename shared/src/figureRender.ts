/**
 * Montagem do avatar a partir das partes do Habbo (Fase 31). Puro (sem DOM nem Node): o cliente
 * usa no navegador e os testes usam no Node. O imager da HabboAssets só desenha a pose em pé;
 * montando as partes das bibliotecas de roupa temos todas as poses (andar, sentar, acenar…).
 */

/** Tamanho do quadro: o mesmo do imager (64×110), para a cena não mudar nada. */
export const FIGURE_WIDTH = 64;
export const FIGURE_HEIGHT = 110;
/** Ponto de registro das partes no quadro (calibrado contra o imager). */
const REG_X = 0;
const REG_Y = 100;

/** Dados de montagem gerados pelo `assets:figure` (`client/public/assets/figure/figuredata.json`). */
export interface FigureData {
  /** Biblioteca → revisão (vai na URL da folha, para o cache nunca servir uma versão velha). */
  libs: Record<string, number>;
  /** Biblioteca → SWF original na CDN da HabboAssets (o servidor converte em folha). */
  swf: Record<string, string>;
  /** `tipo:id` da parte → biblioteca onde está o desenho. */
  partLib: Record<string, string>;
  /** `tipo:idDoConjunto` → paleta, partes `[tipo, id, pintável (0/1), índice da cor]` e camadas que esconde. */
  sets: Record<string, { p: number; parts: [string, number, 0 | 1, number][]; hide?: string[] }>;
  /** Paleta → cor → hex (`"RRGGBB"`). */
  palettes: Record<string, Record<string, string>>;
}

/** Folha de uma biblioteca, gerada pelo servidor a partir do SWF (`/hh/figure/{lib}.json`). */
export interface FigureSheet {
  /** `h_std_ch_1_2_0` → deslocamento (e `source` quando reaproveita a imagem de outra). */
  assets: Record<string, { x: number; y: number; source?: string }>;
  /** Recorte de cada imagem na folha PNG (`/hh/figure/{lib}.png`). */
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

/** Uma biblioteca pronta para montar: a folha e os pixels RGBA do PNG. */
export interface FigureLib extends FigureSheet {
  width: number;
  height: number;
  /** RGBA, `width * height * 4`. */
  pixels: Uint8Array | Uint8ClampedArray;
}

// Ordem de desenho, de trás para a frente, por direção (4–6 são o espelho de 2–0).
const FRONT = 'sd lh ls lc bd sh lg ch cc ca wa rh rs rc hd fa ey fc hr hrb ha he ea ri li';
/** De lado (3): os dois braços por cima da roupa. */
const SIDE = 'sd bd sh lg ch cc ca wa lh ls lc rh rs rc hd fa ey fc hr hrb ha he ea ri li';
/** De costas para a esquerda (7): o braço direito fica atrás do corpo. */
const BACK = 'sd rh rs rc lh ls lc bd sh lg ch cc ca wa hd fa ey fc hr hrb ha he ea ri li';
const ORDER: Record<number, string[]> = {
  0: FRONT.split(' '),
  1: FRONT.split(' '),
  2: FRONT.split(' '),
  3: SIDE.split(' '),
  7: BACK.split(' '),
};

/** Partes da cabeça: ficam na pose `std` enquanto o corpo anda, senta ou acena. */
const HEAD_PARTS = new Set(['hd', 'fa', 'ey', 'fc', 'hr', 'hrb', 'ha', 'he', 'ea']);

export interface FigureLayer {
  type: string;
  id: number;
  lib: string;
  /** Cor de multiplicar (`[r, g, b]`) ou `null` para o desenho original (olhos, por exemplo). */
  tint: [number, number, number] | null;
}

/**
 * Partes a desenhar para uma figure string. `missing` lista conjuntos/partes que os dados não
 * conhecem: nesse caso quem chama usa o imager, para não mostrar alguém pela metade.
 */
export function resolveFigure(
  figure: string,
  data: FigureData,
): { parts: FigureLayer[]; libs: string[]; missing: string[] } {
  const parts: FigureLayer[] = [];
  const missing: string[] = [];
  const hidden = new Set<string>();
  const chosen: { type: string; set: FigureData['sets'][string]; colors: number[] }[] = [];
  for (const token of figure.split('.')) {
    const [type, id, ...colors] = token.split('-');
    if (!type || !id) continue;
    const set = data.sets[`${type}:${id}`];
    if (!set) {
      missing.push(token);
      continue;
    }
    for (const h of set.hide ?? []) hidden.add(h);
    chosen.push({ type, set, colors: colors.map(Number) });
  }
  for (const { set, colors } of chosen) {
    // Cabelo: a parte "grande" (hrb) é o cabelo de verdade; sem ela (escondida por chapéu ou
    // inexistente) desenha a curta (hr), que cabe por baixo do chapéu.
    const hasBig = set.parts.some(([t]) => t === 'hrb') && !hidden.has('hrb');
    for (const [type, id, colorable, colorIndex] of set.parts) {
      if (hidden.has(type) || (type === 'hr' && hasBig)) continue;
      const lib = data.partLib[`${type}:${id}`];
      if (!lib) {
        missing.push(`${type}:${id}`);
        continue;
      }
      const colorId = colorable ? (colors[colorIndex - 1] ?? colors[0]) : undefined;
      const hex =
        colorId !== undefined ? data.palettes[String(set.p)]?.[String(colorId)] : undefined;
      parts.push({ type, id, lib, tint: hex ? hexRgb(hex) : null });
    }
  }
  return { parts, libs: [...new Set(parts.map((p) => p.lib))], missing };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Partes sem desenho nas bibliotecas carregadas (o mapa do Habbo às vezes aponta uma parte para
 * uma biblioteca que não temos). Com alguma, quem chama usa o imager.
 */
export function partsWithoutArt(
  parts: readonly FigureLayer[],
  libs: ReadonlyMap<string, FigureLib>,
): FigureLayer[] {
  return parts.filter((p) => {
    const lib = libs.get(p.lib);
    return !lib || ![0, 1, 2, 3, 7].some((d) => lib.assets[`h_std_${p.type}_${p.id}_${d}_0`]);
  });
}

export interface ComposeOptions {
  direction: number;
  /** Pose do Habbo: `std` (em pé), `wlk`, `sit`, `lay`, `wav`… */
  action?: string;
  frame?: number;
}

/**
 * Monta um quadro 64×110 RGBA. Partes sem desenho para a pose caem para a pose em pé; as
 * direções 4–6 são o espelho de 2–0, como no Habbo.
 */
export function composeFigure(
  parts: readonly FigureLayer[],
  libs: ReadonlyMap<string, FigureLib>,
  opts: ComposeOptions,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(FIGURE_WIDTH * FIGURE_HEIGHT * 4);
  const mirror = opts.direction >= 4 && opts.direction <= 6;
  const dir = mirror ? 6 - opts.direction : opts.direction;
  const order = ORDER[dir] ?? ORDER[2]!;
  const action = opts.action ?? 'std';
  const frame = opts.frame ?? 0;
  const sorted = [...parts].sort((a, b) => rank(order, a.type) - rank(order, b.type));
  for (const part of sorted) {
    const lib = libs.get(part.lib);
    if (!lib) continue;
    const act = HEAD_PARTS.has(part.type) ? 'std' : action;
    const key = [
      `h_${act}_${part.type}_${part.id}_${dir}_${frame}`,
      `h_${act}_${part.type}_${part.id}_${dir}_0`,
      `h_std_${part.type}_${part.id}_${dir}_0`,
    ].find((k) => lib.assets[k]);
    if (!key) continue;
    const asset = lib.assets[key]!;
    const rect = lib.frames[asset.source ?? key] ?? lib.frames[key];
    if (!rect) continue;
    const left = REG_X - asset.x;
    const top = REG_Y - asset.y;
    blit(out, lib, rect, left, top, mirror, part.tint);
  }
  return out;
}

function rank(order: string[], type: string): number {
  const i = order.indexOf(type);
  return i < 0 ? order.length : i;
}

/** Copia um recorte para o quadro, multiplicando pela cor e misturando pela transparência. */
function blit(
  out: Uint8ClampedArray,
  lib: FigureLib,
  rect: { x: number; y: number; w: number; h: number },
  left: number,
  top: number,
  mirror: boolean,
  tint: [number, number, number] | null,
): void {
  const src = lib.pixels;
  for (let y = 0; y < rect.h; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= FIGURE_HEIGHT) continue;
    for (let x = 0; x < rect.w; x++) {
      const si = ((rect.y + y) * lib.width + rect.x + x) * 4;
      const alpha = src[si + 3]!;
      if (!alpha) continue;
      const mx = left + x;
      const dx = mirror ? FIGURE_WIDTH - 1 - mx : mx;
      if (dx < 0 || dx >= FIGURE_WIDTH) continue;
      let r = src[si]!;
      let g = src[si + 1]!;
      let b = src[si + 2]!;
      if (tint) {
        r = (r * tint[0]) / 255;
        g = (g * tint[1]) / 255;
        b = (b * tint[2]) / 255;
      }
      const di = (dy * FIGURE_WIDTH + dx) * 4;
      const k = alpha / 255;
      out[di] = r * k + out[di]! * (1 - k);
      out[di + 1] = g * k + out[di + 1]! * (1 - k);
      out[di + 2] = b * k + out[di + 2]! * (1 - k);
      out[di + 3] = Math.min(255, alpha + out[di + 3]! * (1 - k));
    }
  }
}
