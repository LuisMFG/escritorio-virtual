import {
  furniVisualUrl,
  petVisualUrl,
  type FurniVisual,
  type HabboPetCatalog,
} from '@office/shared';
import { Assets, Rectangle, Texture } from 'pixi.js';
import { track } from './progress.js';

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

  private pets: Promise<HabboPetCatalog | null> | null = null;

  load(classname: string, revision: number): Promise<LoadedFurniVisual | null> {
    return this.cached(`${classname}@${revision}`, classname, (ext) =>
      furniVisualUrl(classname, revision, ext),
    );
  }

  /** Catálogo dos pets do Habbo (Fase 38). */
  petCatalog(): Promise<HabboPetCatalog | null> {
    this.pets ??= fetch('/assets/pets/pets.json')
      .then((r) => (r.ok ? (r.json() as Promise<HabboPetCatalog>) : null))
      .catch(() => null);
    return this.pets;
  }

  /** Pet do Habbo com a paleta escolhida (`null` sem internet ou tipo desconhecido). */
  async loadPet(type: string, palette: number): Promise<LoadedFurniVisual | null> {
    if (!this.enabled) return null;
    const pet = (await this.petCatalog())?.pets.find((p) => p.type === type);
    if (!pet) return null;
    const pal = palette < pet.palettes.length ? palette : 0;
    return this.cached(`pet:${type}@${pet.revision}:${pal}`, type, (ext) =>
      petVisualUrl(type, pet.revision, pal, ext),
    );
  }

  private cached(
    key: string,
    label: string,
    url: (ext: 'png' | 'json') => string,
  ): Promise<LoadedFurniVisual | null> {
    let hit = this.loaded.get(key);
    if (!hit) {
      hit = track(
        this.fetch(url).catch((err: Error) => {
          console.warn(`[camadas] ${label}: ${err.message}`);
          return null;
        }),
      );
      this.loaded.set(key, hit);
    }
    return hit;
  }

  private async fetch(url: (ext: 'png' | 'json') => string): Promise<LoadedFurniVisual | null> {
    if (!this.enabled) return null;
    const res = await fetch(url('json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const visual = (await res.json()) as FurniVisual;
    const base = await Assets.load<Texture>({
      src: url('png'),
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
