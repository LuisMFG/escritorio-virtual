import {
  findCategory,
  findSet,
  paletteHex,
  parseFigure,
  type AvatarManifest,
} from '@office/shared';
import { Container, Graphics } from 'pixi.js';
import { hexToNumber } from './colors.js';

/**
 * Avatar provisório em camadas, usado quando o imager não responde ou em `?offline=1`.
 *
 * Cada tipo de peça tem um desenho em tons de cinza (branco = cor cheia, cinza = sombra);
 * a cor vem da paleta do manifesto via `tint` (multiplicação), o mesmo princípio do Habbo.
 * As camadas são empilhadas na ordem `layer` do manifesto. O resultado é assado numa
 * textura uma única vez por combinação (cache em `PlaceholderFactory`).
 */

type Draw = (g: Graphics, view: View, variant: number) => void;

interface View {
  /** Lado para onde o rosto aponta na tela (-1, 0, 1). */
  sx: number;
  /** De frente para a câmera (mostra rosto, óculos). */
  front: boolean;
}

const SHADE = 0xd4d4d4;

const DRAW: Record<string, { variants: number; draw: Draw }> = {
  hd: {
    variants: 1,
    draw: (g) => {
      g.rect(-2, -49, 4, 3).fill(SHADE);
      g.circle(0, -58, 10).fill(0xffffff);
      g.rect(-13, -29, 4, 4).fill(0xffffff);
      g.rect(9, -29, 4, 4).fill(SHADE);
    },
  },
  lg: {
    variants: 1,
    draw: (g) => {
      g.rect(-7, -26, 6, 21).fill(0xffffff);
      g.rect(1, -26, 6, 21).fill(SHADE);
    },
  },
  sh: {
    variants: 1,
    draw: (g) => {
      g.rect(-8, -6, 7, 6).fill(0xffffff);
      g.rect(1, -6, 7, 6).fill(SHADE);
    },
  },
  ch: {
    variants: 1,
    draw: (g) => {
      g.roundRect(-10, -48, 20, 24, 3).fill(0xffffff);
      g.rect(-13, -46, 4, 17).fill(SHADE);
      g.rect(9, -46, 4, 17).fill(SHADE);
    },
  },
  cc: {
    variants: 1,
    draw: (g) => {
      g.rect(-11, -49, 8, 28).fill(0xffffff);
      g.rect(3, -49, 8, 28).fill(SHADE);
      g.rect(-14, -47, 5, 18).fill(SHADE);
      g.rect(9, -47, 5, 18).fill(SHADE);
    },
  },
  ca: {
    variants: 2,
    draw: (g, _v, variant) => {
      if (variant === 0) g.rect(-10, -48, 20, 4).fill(0xffffff);
      else g.circle(0, -40, 3).fill(0xffffff);
    },
  },
  hr: {
    variants: 3,
    draw: (g, v, variant) => {
      if (!v.front) {
        g.ellipse(0, -59, 11, 10).fill(0xffffff);
        if (variant === 1) g.rect(-10, -60, 20, 16).fill(SHADE);
        return;
      }
      const cx = -v.sx * 2;
      if (variant === 2) {
        g.poly([
          cx - 11,
          -60,
          cx - 8,
          -72,
          cx - 4,
          -64,
          cx,
          -74,
          cx + 4,
          -64,
          cx + 8,
          -72,
          cx + 11,
          -60,
        ]).fill(0xffffff);
      } else {
        g.ellipse(cx, -63, 11, 6).fill(0xffffff);
      }
      if (variant === 1) {
        g.rect(-11, -62, 4, 16).fill(SHADE);
        g.rect(7, -62, 4, 16).fill(SHADE);
      }
    },
  },
  ea: {
    variants: 1,
    draw: (g, v) => {
      if (!v.front) return;
      const x = v.sx * 3;
      g.rect(x - 6, -60, 5, 4).fill(0xffffff);
      g.rect(x + 1, -60, 5, 4).fill(0xffffff);
      g.rect(x - 1, -59, 2, 1).fill(SHADE);
    },
  },
  ha: {
    variants: 2,
    draw: (g, _v, variant) => {
      g.ellipse(0, -66, 13, 3).fill(SHADE);
      if (variant === 0) g.rect(-8, -76, 16, 10).fill(0xffffff);
      else g.ellipse(0, -69, 9, 6).fill(0xffffff);
    },
  },
};

/** Cor neutra para peças sem cor (não recoloríveis) ou com cor desconhecida. */
const NEUTRAL = 0x9a9aa2;

/** Monta o contêiner de camadas tingidas de uma figure numa direção (0–7). */
export function buildLayeredAvatar(
  figure: string,
  dir: number,
  manifest: AvatarManifest,
): Container {
  const sx = Math.sign([1, 2, 1, 0, -1, -2, -1, 0][dir] ?? 0);
  const view: View = { sx, front: dir >= 1 && dir <= 5 };
  const root = new Container();

  const layers = parseFigure(figure)
    .map((part) => {
      const category = findCategory(manifest, part.type);
      const spec = DRAW[part.type];
      if (!category || !spec) return null;
      const set = findSet(category, part.setId);
      const colorId = part.colors[0] ?? set?.defaultColors[0];
      const hex =
        colorId !== undefined ? paletteHex(manifest, category.palette, colorId) : undefined;
      return { part, layer: category.layer, spec, tint: hex ? hexToNumber(hex) : NEUTRAL };
    })
    .filter((l) => l !== null)
    .sort((a, b) => a.layer - b.layer);

  for (const l of layers) {
    const g = new Graphics();
    l.spec.draw(g, view, l.part.setId % l.spec.variants);
    g.tint = l.tint;
    root.addChild(g);
    // Olhos (sem tingir) logo acima da pele.
    if (l.part.type === 'hd' && view.front) {
      const eyes = new Graphics();
      eyes.rect(sx * 3 - 4, -59, 2, 3).fill(0x222222);
      eyes.rect(sx * 3 + 2, -59, 2, 3).fill(0x222222);
      root.addChild(eyes);
    }
  }
  return root;
}
