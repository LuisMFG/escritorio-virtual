import { footprintSize, parseFigure, type AvatarManifest, type FurniDef } from '@office/shared';
import { Graphics, Rectangle, type Renderer } from 'pixi.js';
import type { Placeholder } from './AssetLoader.js';
import { colorFromString, hexToNumber, shade } from './colors.js';

const CATEGORY_COLORS: Record<string, number> = {
  cadeiras: 0xc9b88f,
  sofás: 0x8c6f5a,
  mesas: 0xd8cfb8,
  plantas: 0x4f9d69,
  estantes: 0x9c7a55,
  tapetes: 0xa84a4a,
};

type Pt = [number, number];

/**
 * Arte provisória gerada por código (Pixi Graphics → textura), usada quando a HabboAssets
 * não responde ou em `?offline=1`. Cada combinação é desenhada uma vez e fica em cache.
 */
export class PlaceholderFactory {
  private readonly cache = new Map<string, Placeholder>();

  constructor(
    private readonly renderer: Renderer,
    private readonly avatarManifest: AvatarManifest,
  ) {}

  /** Móvel como caixa isométrica do tamanho do footprint. Âncora = vértice de baixo. */
  furni(def: FurniDef, rot: number): Placeholder {
    return this.bake(`furni:${def.id}:${rot}`, (g) => {
      const { w, d } = footprintSize(def, rot);
      const base = CATEGORY_COLORS[def.category] ?? colorFromString(def.category);
      const B: Pt = [0, 0];
      const L: Pt = [-32 * w, -16 * w];
      const R: Pt = [32 * d, -16 * d];
      const T: Pt = [32 * (d - w), -16 * (w + d)];

      if (def.canWalk) {
        box(g, L, B, R, T, 2, base);
        return;
      }
      if (def.category === 'plantas') {
        const s = 0.35;
        const inset = (p: Pt): Pt => [
          p[0] * s + (T[0] * (1 - s)) / 2,
          p[1] * s + (T[1] * (1 - s)) / 2,
        ];
        box(g, inset(L), inset(B), inset(R), inset(T), 14, 0x9a6a44);
        const cx = T[0] / 2;
        const cy = T[1] / 2 - 14;
        g.ellipse(cx, cy - 22, 14, 22).fill(base);
        g.ellipse(cx - 4, cy - 28, 5, 8).fill(shade(base, 1.25));
        return;
      }
      if (def.canSit) {
        // Encosto no lado oposto ao que o assento está virado.
        const back = backEdge(rot, L, B, R, T);
        const backIsBehind = rot === 2 || rot === 4;
        if (backIsBehind) panel(g, back[0], back[1], 16, 40, base);
        box(g, L, B, R, T, 16, base);
        if (!backIsBehind) panel(g, back[0], back[1], 16, 40, base);
        return;
      }
      const height = def.category === 'mesas' ? 26 : Math.max(12, def.height * 34);
      box(g, L, B, R, T, height, base);
    });
  }

  /** Avatar como boneco simples com as cores da figure string. Âncora = pés. */
  avatar(figure: string, dir: number): Placeholder {
    return this.bake(`avatar:${figure}:${dir}`, (g) => {
      const colorOf = (type: string, palette: string, fallback: number) => {
        const part = parseFigure(figure).find((p) => p.type === type);
        if (!part) return fallback;
        const hex = this.avatarManifest.palettes[palette]?.[String(part.colors[0])];
        return hex ? hexToNumber(hex) : colorFromString(`${type}-${part.setId}-${part.colors[0]}`);
      };
      const skin = colorOf('hd', 'skin', 0xffcb98);
      const shirt = colorOf('ch', 'clothes', 0x3b5fa0);
      const pants = colorOf('lg', 'clothes', 0x4a5b74);
      const shoes = colorOf('sh', 'clothes', 0x2d2d2d);
      const hair = colorOf('hr', 'hair', 0x5a3a22);
      const hasHair = parseFigure(figure).some((p) => p.type === 'hr');

      // Para onde o avatar olha na tela: x = lado, y > 0 = de frente para a câmera.
      const sx = Math.sign([1, 2, 1, 0, -1, -2, -1, 0][dir] ?? 0);
      const facingCamera = dir >= 1 && dir <= 5;

      g.rect(-7, -6, 6, 6).fill(shoes);
      g.rect(1, -6, 6, 6).fill(shoes);
      g.rect(-7, -26, 6, 21).fill(pants);
      g.rect(1, -26, 6, 21).fill(shade(pants, 0.85));
      g.roundRect(-10, -48, 20, 24, 3).fill(shirt);
      g.rect(-13, -46, 4, 18).fill(shade(shirt, 0.85));
      g.rect(9, -46, 4, 18).fill(shade(shirt, 0.85));
      g.rect(-13, -29, 4, 4).fill(skin);
      g.rect(9, -29, 4, 4).fill(skin);
      g.circle(0, -58, 10).fill(skin);
      if (hasHair) {
        g.ellipse(-sx * 2, facingCamera ? -63 : -59, 11, facingCamera ? 6 : 10).fill(hair);
      }
      if (facingCamera) {
        g.rect(sx * 3 - 4, -59, 2, 3).fill(0x222222);
        g.rect(sx * 3 + 2, -59, 2, 3).fill(0x222222);
      }
    });
  }

  private bake(key: string, draw: (g: Graphics) => void): Placeholder {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const g = new Graphics();
    draw(g);
    const b = g.getLocalBounds();
    const x = Math.floor(b.minX);
    const y = Math.floor(b.minY);
    const frame = new Rectangle(x, y, Math.ceil(b.maxX) - x, Math.ceil(b.maxY) - y);
    const texture = this.renderer.generateTexture({
      target: g,
      frame,
      resolution: 1,
      antialias: false,
    });
    texture.source.scaleMode = 'nearest';
    g.destroy();
    const result = { texture, anchor: { x: -x, y: -y } };
    this.cache.set(key, result);
    return result;
  }
}

/** Caixa isométrica: faces esquerda e direita e o tampo, com altura `h` em pixels. */
function box(g: Graphics, L: Pt, B: Pt, R: Pt, T: Pt, h: number, color: number): void {
  const up = (p: Pt): Pt => [p[0], p[1] - h];
  poly(g, [L, B, up(B), up(L)], shade(color, 0.8));
  poly(g, [B, R, up(R), up(B)], shade(color, 0.65));
  poly(g, [up(T), up(R), up(B), up(L)], color);
  g.poly([...up(T), ...up(R), ...up(B), ...up(L)], true).stroke({
    width: 1,
    color: shade(color, 0.55),
  });
}

/** Painel vertical (encosto) sobre a aresta a→b, entre as alturas `from` e `to`. */
function panel(g: Graphics, a: Pt, b: Pt, from: number, to: number, color: number): void {
  poly(
    g,
    [
      [a[0], a[1] - from],
      [b[0], b[1] - from],
      [b[0], b[1] - to],
      [a[0], a[1] - to],
    ],
    shade(color, 0.9),
  );
}

function poly(g: Graphics, pts: Pt[], color: number): void {
  g.poly(pts.flat()).fill(color);
}

/** Aresta do footprint onde fica o encosto (oposta à direção do assento). */
function backEdge(rot: number, L: Pt, B: Pt, R: Pt, T: Pt): [Pt, Pt] {
  switch (rot) {
    case 0: // olha para -y → encosto no lado +y (frente-esquerda)
      return [L, B];
    case 2: // olha para +x → encosto no lado -x (fundo-esquerda)
      return [T, L];
    case 4: // olha para +y → encosto no lado -y (fundo-direita)
      return [T, R];
    default: // olha para -x → encosto no lado +x (frente-direita)
      return [B, R];
  }
}
