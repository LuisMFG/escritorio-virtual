import { avatarImageUrl, type FigurePose } from '@office/shared';
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

/** Quadros sob demanda de um avatar montado: qualquer pose (andar, sentar, acenar…). */
export interface AvatarPoser {
  frame(pose: FigurePose): AvatarFrame;
  /**
   * Muda quando o posador passa a desenhar algo que antes não podia (a biblioteca de itens da
   * mão chegou): a cena pede a pose de novo em vez de ficar com a sem o copo.
   */
  readonly revision?: number;
  /** Veste alguma roupa animada (a cena avança `clothingFrame`). */
  readonly animated?: boolean;
  /** Poses guardadas agora (diagnóstico de memória). */
  readonly size?: number;
  /** Saiu do cache: libera as texturas. */
  dispose?(): void;
}

/**
 * Fonte das texturas do avatar: as 8 direções em pé e, quando o avatar é montado no navegador
 * (Fase 31), um "posador" com todas as poses. Pelo imager não há posador (só a pose parada).
 */
export interface AvatarRenderer {
  render(figure: string): Promise<AvatarFrames>;
  poser?(figure: string): Promise<AvatarPoser | null>;
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
          // Proxy com cache do servidor primeiro; imager direto se o servidor não responder.
          [
            avatarImageUrl(figure, { direction: dir }, '/hh'),
            avatarImageUrl(figure, { direction: dir }, base),
          ],
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

  private readonly posers = new Map<string, Promise<AvatarPoser | null>>();

  /** Posador da figure (ou `null`: animação simulada sobre as texturas paradas). */
  poser(figure: string): Promise<AvatarPoser | null> {
    let hit = this.posers.get(figure);
    if (hit) {
      this.posers.delete(figure);
      this.posers.set(figure, hit);
      return hit;
    }
    hit = this.renderer.poser?.(figure) ?? Promise.resolve(null);
    this.posers.set(figure, hit);
    // Não montou (roupa que não baixou, servidor ocupado): não guarda, para tentar de novo.
    const mine = hit;
    void mine.then((p) => {
      if (!p && this.posers.get(figure) === mine) this.posers.delete(figure);
    });
    if (this.posers.size > this.maxEntries) {
      const oldest = this.posers.keys().next().value;
      if (oldest !== undefined) {
        void this.posers.get(oldest)!.then((p) => p?.dispose?.());
        this.posers.delete(oldest);
      }
    }
    return hit;
  }

  /** Quantas poses estão guardadas, somando todas as figuras (diagnóstico). */
  async poseCount(): Promise<number> {
    const posers = await Promise.all(this.posers.values());
    return posers.reduce((n, p) => n + (p?.size ?? 0), 0);
  }

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
