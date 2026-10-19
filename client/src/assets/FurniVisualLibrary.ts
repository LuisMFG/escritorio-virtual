import { furniVisualUrl, type FurniVisual } from '@office/shared';
import { Assets, Rectangle, Texture } from 'pixi.js';

/** Um móvel por camadas pronto: os dados de desenho e uma textura por imagem da folha. */
export interface LoadedFurniVisual {
  visual: FurniVisual;
  textures: Map<string, Texture>;
}

/**
 * Móveis desenhados por camadas (Fase 37): o servidor converte o SWF de cada móvel em folha +
 * dados (`/hh/furni/{classname}`); aqui cada um é baixado uma vez e recortado em texturas. Sem
 * internet (modo offline), não carrega e os móveis ficam na imagem de sempre.
 */
export class FurniVisualLibrary {
  private readonly loaded = new Map<string, Promise<LoadedFurniVisual | null>>();

  constructor(private readonly enabled = true) {}

  load(classname: string, revision: number): Promise<LoadedFurniVisual | null> {
    const key = `${classname}@${revision}`;
    let hit = this.loaded.get(key);
    if (!hit) {
      hit = this.fetch(classname, revision).catch((err: Error) => {
        console.warn(`[móvel] ${classname}: ${err.message}`);
        return null;
      });
      this.loaded.set(key, hit);
    }
    return hit;
  }

  private async fetch(classname: string, revision: number): Promise<LoadedFurniVisual | null> {
    if (!this.enabled) return null;
    const res = await fetch(furniVisualUrl(classname, revision, 'json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const visual = (await res.json()) as FurniVisual;
    const base = await Assets.load<Texture>({
      src: furniVisualUrl(classname, revision, 'png'),
      loadParser: 'loadTextures',
    });
    base.source.scaleMode = 'nearest';
    const textures = new Map<string, Texture>();
    for (const [name, f] of Object.entries(visual.frames)) {
      textures.set(
        name,
        new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }),
      );
    }
    return { visual, textures };
  }
}
