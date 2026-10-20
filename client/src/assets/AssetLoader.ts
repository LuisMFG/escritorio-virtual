import { Texture } from 'pixi.js';
import { track } from './progress.js';

export type AssetSource = 'habboassets' | 'placeholder';

export interface PixelAnchor {
  x: number;
  y: number;
}

export interface LoadedTexture {
  texture: Texture;
  source: AssetSource;
  /** Âncora em pixels, quando quem gerou a textura sabe (placeholders). */
  anchor?: PixelAnchor;
}

export interface Placeholder {
  texture: Texture;
  anchor: PixelAnchor;
}

export interface AssetStats {
  loaded: number;
  failed: number;
  offline: boolean;
}

const LOAD_TIMEOUT_MS = 10_000;

/** Carrega uma imagem (CORS anônimo) e cria uma textura nítida para pixel art. */
export function loadImageTexture(url: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => {
      img.src = '';
      reject(new Error(`Tempo esgotado ao carregar ${url}`));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      const texture = Texture.from(img);
      texture.source.scaleMode = 'nearest';
      resolve(texture);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Falha ao carregar ${url}`));
    };
    img.src = url;
  });
}

/**
 * Resolve chaves lógicas (`furni:chair_norja:2`, `avatar:<figure>:3`) para texturas,
 * tentando as URLs em ordem e caindo para a arte provisória gerada por código.
 * Cada chave é carregada uma única vez; o cache HTTP do navegador cuida do resto.
 */
export class AssetLoader {
  private readonly cache = new Map<string, Promise<LoadedTexture>>();
  private readonly listeners = new Set<(stats: AssetStats) => void>();
  readonly stats: AssetStats;

  constructor(offline: boolean) {
    this.stats = { loaded: 0, failed: 0, offline };
  }

  onChange(listener: (stats: AssetStats) => void): void {
    this.listeners.add(listener);
    listener(this.stats);
  }

  load(
    key: string,
    urls: readonly string[],
    placeholder: () => Placeholder,
  ): Promise<LoadedTexture> {
    let entry = this.cache.get(key);
    if (!entry) {
      entry = track(this.resolve(urls, placeholder));
      this.cache.set(key, entry);
    }
    return entry;
  }

  private async resolve(
    urls: readonly string[],
    placeholder: () => Placeholder,
  ): Promise<LoadedTexture> {
    if (!this.stats.offline) {
      for (const url of urls) {
        try {
          const texture = await loadImageTexture(url);
          this.stats.loaded++;
          this.emit();
          return { texture, source: 'habboassets' };
        } catch (err) {
          console.warn('[assets]', (err as Error).message);
        }
      }
      this.stats.failed++;
      this.emit();
    }
    const ph = placeholder();
    return { texture: ph.texture, anchor: ph.anchor, source: 'placeholder' };
  }

  private emit(): void {
    for (const l of this.listeners) l(this.stats);
  }
}
