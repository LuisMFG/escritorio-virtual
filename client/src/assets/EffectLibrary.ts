import { effectSheetUrl, type EffectSheet, type FigureData } from '@office/shared';
import { Assets, Rectangle, Texture } from 'pixi.js';

/** Um efeito pronto: a animação e uma textura por imagem da folha. */
export interface LoadedEffect {
  sheet: EffectSheet;
  textures: Map<string, Texture>;
}

/**
 * Efeitos do Habbo (Fase 34): o servidor converte o SWF de cada um em folha + animação
 * (`/hh/effect/{lib}`); aqui cada biblioteca é baixada uma vez e recortada em texturas.
 * Sem dados (modo offline, por exemplo), não há efeitos.
 */
export class EffectLibrary {
  private data: Promise<FigureData | null> | null = null;
  private readonly loaded = new Map<string, Promise<LoadedEffect | null>>();

  constructor(private readonly enabled = true) {}

  load(lib: string): Promise<LoadedEffect | null> {
    let hit = this.loaded.get(lib);
    if (!hit) {
      hit = this.fetch(lib).catch((err: Error) => {
        console.warn(`[efeito] ${lib}: ${err.message}`);
        this.loaded.delete(lib);
        return null;
      });
      this.loaded.set(lib, hit);
    }
    return hit;
  }

  private async fetch(lib: string): Promise<LoadedEffect | null> {
    if (!this.enabled) return null;
    this.data ??= fetch('/assets/figure/figuredata.json').then((r) => (r.ok ? r.json() : null));
    const info = (await this.data)?.effects?.[lib];
    if (!info) return null;
    const res = await fetch(effectSheetUrl(lib, info.revision, 'json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sheet = (await res.json()) as EffectSheet;
    const base = await Assets.load<Texture>({
      src: effectSheetUrl(lib, info.revision, 'png'),
      loadParser: 'loadTextures',
    });
    base.source.scaleMode = 'nearest';
    const textures = new Map<string, Texture>();
    for (const [name, f] of Object.entries(sheet.frames)) {
      textures.set(
        name,
        new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }),
      );
    }
    return { sheet, textures };
  }
}
