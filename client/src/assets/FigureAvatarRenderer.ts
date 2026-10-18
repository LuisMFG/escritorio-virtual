import {
  composeFigure,
  FIGURE_HEIGHT,
  FIGURE_WIDTH,
  figureSheetUrl,
  partsWithoutArt,
  resolveFigure,
  type FigureData,
  type FigureLib,
  type FigureSheet,
} from '@office/shared';
import { Texture } from 'pixi.js';
import { IMAGER_AVATAR_FEET } from '../config.js';
import type { AvatarFrame, AvatarFrames, AvatarRenderer } from './AvatarTextureCache.js';

/**
 * Avatar montado no navegador a partir das partes do Habbo (Fase 31): o servidor converte cada
 * biblioteca de roupa numa folha de sprites e aqui as partes são pintadas e empilhadas por
 * direção. Fica igual ao imager na pose em pé e abre caminho para andar, sentar e acenar.
 * Peça que os dados não conhecem (ou sem desenho) usa o imager, como antes.
 */
export class FigureAvatarRenderer implements AvatarRenderer {
  private data: Promise<FigureData> | null = null;
  private readonly libs = new Map<string, Promise<FigureLib>>();

  constructor(
    private readonly fallback: AvatarRenderer,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  async render(figure: string): Promise<AvatarFrames> {
    try {
      const data = await this.loadData();
      const resolved = resolveFigure(figure, data);
      if (resolved.missing.length) return await this.fallback.render(figure);
      const libs = new Map<string, FigureLib>();
      await Promise.all(
        resolved.libs.map(async (name) => libs.set(name, await this.loadLib(name, data))),
      );
      if (partsWithoutArt(resolved.parts, libs).length) return await this.fallback.render(figure);
      return Array.from({ length: 8 }, (_, direction): AvatarFrame => {
        const pixels = composeFigure(resolved.parts, libs, { direction });
        return { texture: toTexture(pixels), anchor: IMAGER_AVATAR_FEET, source: 'habboassets' };
      });
    } catch (err) {
      console.warn('[avatar] montagem falhou, usando o imager:', (err as Error).message);
      return this.fallback.render(figure);
    }
  }

  private loadData(): Promise<FigureData> {
    this.data ??= this.fetchJson<FigureData>('/assets/figure/figuredata.json');
    this.data.catch(() => (this.data = null));
    return this.data;
  }

  private loadLib(name: string, data: FigureData): Promise<FigureLib> {
    let lib = this.libs.get(name);
    if (!lib) {
      const revision = data.libs[name]!;
      lib = Promise.all([
        this.fetchJson<FigureSheet>(figureSheetUrl(name, revision, 'json')),
        this.fetchPixels(figureSheetUrl(name, revision, 'png')),
      ]).then(([sheet, image]) => ({ ...sheet, ...image }));
      lib.catch(() => this.libs.delete(name));
      this.libs.set(name, lib);
    }
    return lib;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** PNG da folha → pixels RGBA (sem suavizar nem pré-multiplicar). */
  private async fetchPixels(url: string): Promise<Pick<FigureLib, 'width' | 'height' | 'pixels'>> {
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: img.width, height: img.height, pixels: img.data };
  }
}

function toTexture(pixels: Uint8ClampedArray): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = FIGURE_WIDTH;
  canvas.height = FIGURE_HEIGHT;
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(pixels), FIGURE_WIDTH, FIGURE_HEIGHT), 0, 0);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}
