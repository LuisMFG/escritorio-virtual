import { avatarImageUrl } from '@office/shared';
import type { Texture } from 'pixi.js';
import { IMAGER_AVATAR_FEET } from '../config.js';
import type { AssetLoader, AssetSource, PixelAnchor } from './AssetLoader.js';
import type { PlaceholderFactory } from './PlaceholderFactory.js';

export interface AvatarFrame {
  texture: Texture;
  /** Ponto dos pés, em pixels da textura. */
  anchor: PixelAnchor;
  source: AssetSource;
}

/** Uma textura por direção (0–7) para uma figure string. */
export type AvatarFrames = readonly AvatarFrame[];

/**
 * Fonte das texturas do avatar. Hoje: render parado do imager por direção.
 * Pode ser trocada por um renderer de partes (bibliotecas .nitro) sem mexer na cena.
 */
export interface AvatarRenderer {
  render(figure: string): Promise<AvatarFrames>;
}

export class ImagerAvatarRenderer implements AvatarRenderer {
  constructor(
    private readonly loader: AssetLoader,
    private readonly placeholders: PlaceholderFactory,
    private readonly imagerUrl?: string,
  ) {}

  render(figure: string): Promise<AvatarFrames> {
    const base = this.imagerUrl?.replace(/\/avatar\.png$/, '');
    return Promise.all(
      Array.from({ length: 8 }, async (_, dir): Promise<AvatarFrame> => {
        const loaded = await this.loader.load(
          `avatar:${figure}:${dir}`,
          [avatarImageUrl(figure, { direction: dir }, base)],
          () => this.placeholders.avatar(figure, dir),
        );
        return {
          texture: loaded.texture,
          anchor: loaded.anchor ?? IMAGER_AVATAR_FEET,
          source: loaded.source,
        };
      }),
    );
  }
}

/**
 * Cache LRU por figure string: as 8 texturas de uma combinação são montadas uma única vez,
 * nunca por frame. Com até 10 pessoas online, 64 entradas sobram.
 */
export class AvatarTextureCache {
  private readonly entries = new Map<string, Promise<AvatarFrames>>();

  constructor(
    private readonly renderer: AvatarRenderer,
    private readonly maxEntries = 64,
  ) {}

  get(figure: string): Promise<AvatarFrames> {
    const hit = this.entries.get(figure);
    if (hit) {
      // Reinsere para marcar como usado recentemente.
      this.entries.delete(figure);
      this.entries.set(figure, hit);
      return hit;
    }
    const frames = this.renderer.render(figure);
    this.entries.set(figure, frames);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return frames;
  }
}
