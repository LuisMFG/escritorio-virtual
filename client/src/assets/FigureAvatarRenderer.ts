import {
  canvasFor,
  clothingPeriod,
  composeFigure,
  figureSheetUrl,
  HAND_ITEM_LIB,
  poseKey,
  STAND_CANVAS,
  needsWideCanvas,
  type FigureCanvas,
  type FigureLayer,
  type FigurePose,
  partsWithoutArt,
  resolveFigure,
  type FigureData,
  type FigureLib,
  type FigureSheet,
} from '@office/shared';
import { Texture } from 'pixi.js';
import { IMAGER_AVATAR_FEET } from '../config.js';
import type {
  AvatarFrame,
  AvatarFrames,
  AvatarPoser,
  AvatarRenderer,
} from './AvatarTextureCache.js';
import { disposeTexture } from './textureHold.js';

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
    const poser = await this.poser(figure);
    if (!poser) return this.fallback.render(figure);
    return Array.from({ length: 8 }, (_, direction) => poser.frame({ direction }));
  }

  /** Posador da figure, ou `null` se ela não dá para montar (aí a cena usa o imager). */
  async poser(figure: string): Promise<AvatarPoser | null> {
    try {
      const data = await this.loadData();
      const resolved = resolveFigure(figure, data);
      if (resolved.missing.length) return null;
      const libs = new Map<string, FigureLib>();
      await Promise.all(
        resolved.libs.map(async (name) => libs.set(name, await this.loadLib(name, data))),
      );
      if (partsWithoutArt(resolved.parts, libs).length) return null;
      // A biblioteca de itens na mão só é baixada quando alguém pega um (café, bebida).
      return new FigurePoser(resolved.parts, libs, () => this.loadLib(HAND_ITEM_LIB, data));
    } catch (err) {
      console.warn('[avatar] montagem falhou, usando o imager:', (err as Error).message);
      return null;
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

/**
 * Até quantas poses por figura ficam guardadas (cada uma é uma textura de ~30 KB na GPU). Andar
 * nas 8 direções, parado, piscando e falando cabem com folga; as menos usadas saem (LRU).
 */
export const MAX_POSES = 160;
/** Espera antes de liberar uma textura descartada (pode estar na tela neste quadro). */
const RELEASE_DELAY_MS = 2000;

/**
 * Libera a textura da GPU um pouco depois (Fase 39: sem isso a memória só crescia). Se alguém
 * ainda a mostra, espera largar (Fase 52).
 */
function releaseLater(texture: Texture): void {
  setTimeout(() => disposeTexture(texture), RELEASE_DELAY_MS);
}

/** Monta cada pose uma vez e guarda a textura (a cena pede a pose a cada quadro). */
class FigurePoser implements AvatarPoser {
  private readonly cache = new Map<string, AvatarFrame>();

  private itemLib: 'none' | 'loading' | 'ready' = 'none';
  private rev = 0;
  /** Período das roupas animadas por direção (o quadro se repete depois dele). */
  private readonly periods = new Map<number, number>();
  get animated(): boolean {
    return this.parts.some((p) => p.animated);
  }

  get revision(): number {
    return this.rev;
  }

  constructor(
    private readonly parts: readonly FigureLayer[],
    private readonly libs: Map<string, FigureLib>,
    private readonly loadItems: () => Promise<FigureLib>,
  ) {}

  frame(input: FigurePose): AvatarFrame {
    let pose = input;
    if (pose.handItem && this.itemLib !== 'ready') {
      // Ainda sem a biblioteca de itens: desenha sem o item e baixa (o próximo quadro já vem com ele).
      if (this.itemLib === 'none') {
        this.itemLib = 'loading';
        void this.loadItems()
          .then((lib) => {
            this.libs.set(HAND_ITEM_LIB, lib);
            this.itemLib = 'ready';
            // A cena pede a pose de novo: o copo aparece já, não só no próximo piscar.
            this.rev++;
          })
          .catch(() => (this.itemLib = 'none'));
      }
      pose = { ...pose, handItem: undefined, handGesture: undefined };
    }
    if (pose.clothingFrame) {
      // O quadro da roupa animada cresce sem parar: reduz ao período (antes cada quadro era uma
      // pose nova, 8 por segundo, e o cache nunca acertava).
      let period = this.periods.get(pose.direction);
      if (period === undefined) {
        period = clothingPeriod(this.parts, this.libs, pose.direction);
        this.periods.set(pose.direction, period);
      }
      pose = { ...pose, clothingFrame: 1 + ((pose.clothingFrame - 1) % period) };
    }
    const key = poseKey(pose);
    const hit = this.cache.get(key);
    if (hit) {
      // Reinsere: a ordem do Map vira "menos usada primeiro".
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const canvas = canvasFor(pose, needsWideCanvas(this.parts));
    const texture = toTexture(composeFigure(this.parts, this.libs, pose, canvas), canvas);
    // Os pés ficam no mesmo ponto em qualquer quadro (o deitado é só mais largo).
    const anchor = {
      x: IMAGER_AVATAR_FEET.x + canvas.regX - STAND_CANVAS.regX,
      y: IMAGER_AVATAR_FEET.y,
    };
    const frame: AvatarFrame = { texture, anchor, source: 'habboassets' };
    if (this.cache.size >= MAX_POSES) {
      const oldest = this.cache.keys().next().value!;
      releaseLater(this.cache.get(oldest)!.texture);
      this.cache.delete(oldest);
    }
    this.cache.set(key, frame);
    return frame;
  }

  /** Poses guardadas (diagnóstico). */
  get size(): number {
    return this.cache.size;
  }

  /** A figura saiu do cache: libera todas as texturas. */
  dispose(): void {
    for (const f of this.cache.values()) releaseLater(f.texture);
    this.cache.clear();
  }
}

function toTexture(pixels: Uint8ClampedArray, size: FigureCanvas): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(pixels), size.width, size.height), 0, 0);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}
