import type { Point, Sprite, Texture } from 'pixi.js';

/** Canais alfa por textura, lidos uma vez de um canvas (teste de clique por pixel). */
const alphaCache = new WeakMap<Texture, { w: number; data: Uint8ClampedArray } | null>();

/** O ponto de tela cai num pixel visível do sprite? (Sem acesso aos pixels, vale a caixa.) */
export function spriteHitTest(sprite: Sprite, global: Point): boolean {
  if (!sprite.visible || !sprite.getBounds().containsPoint(global.x, global.y)) return false;
  const local = sprite.toLocal(global);
  const tex = sprite.texture;
  const px = Math.floor(local.x + sprite.anchor.x * tex.width);
  const py = Math.floor(local.y + sprite.anchor.y * tex.height);
  return alphaAt(tex, px, py) > 32;
}

function alphaAt(tex: Texture, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) return 0;
  let entry = alphaCache.get(tex);
  if (entry === undefined) {
    entry = readPixels(tex);
    alphaCache.set(tex, entry);
  }
  if (!entry) return 255;
  return entry.data[(y * entry.w + x) * 4 + 3] ?? 0;
}

function readPixels(tex: Texture): { w: number; data: Uint8ClampedArray } | null {
  const resource = tex.source.resource as CanvasImageSource | undefined;
  if (!(resource instanceof HTMLImageElement) && !(resource instanceof HTMLCanvasElement)) {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = tex.width;
    canvas.height = tex.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(resource, 0, 0);
    return { w: tex.width, data: ctx.getImageData(0, 0, tex.width, tex.height).data };
  } catch {
    return null;
  }
}
