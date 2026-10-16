import {
  footprint,
  furniImageUrl,
  renderDirection,
  tileToScreen,
  TILE_H,
  type DepthBox,
  type FurniManifestEntry,
  type PlacedFurni,
} from '@office/shared';
import { Container, Sprite } from 'pixi.js';
import type { AssetLoader } from '../assets/AssetLoader.js';
import type { PlaceholderFactory } from '../assets/PlaceholderFactory.js';

/** Sprite de um móvel posicionado. O ponto de origem é o vértice de baixo do footprint. */
export class FurniView extends Container {
  private readonly sprite = new Sprite();

  constructor(
    readonly placed: PlacedFurni,
    readonly def: FurniManifestEntry,
  ) {
    super();
    this.label = `furni:${placed.id}`;
    this.addChild(this.sprite);
    this.updatePosition();
  }

  async load(loader: AssetLoader, placeholders: PlaceholderFactory): Promise<void> {
    const { def, placed } = this;
    const dir = renderDirection(def, placed.rot);
    const opts = { direction: dir, revision: def.revision, color: def.color };
    // Proxy com cache do servidor primeiro; imager direto se o servidor não responder.
    const urls =
      def.source === 'habboassets'
        ? [furniImageUrl(def.id, opts, '/hh'), furniImageUrl(def.id, opts)]
        : [];
    const loaded = await loader.load(`furni:${def.id}:${dir}:${def.color ?? ''}`, urls, () =>
      placeholders.furni(def, placed.rot),
    );
    const tex = loaded.texture;
    const anchor = loaded.anchor ?? anchorFromManifest(def, dir, tex.width, tex.height);
    this.sprite.texture = tex;
    this.sprite.anchor.set(anchor.x / tex.width, anchor.y / tex.height);
  }

  get footprint() {
    return footprint(this.def, this.placed.x, this.placed.y, this.placed.rot);
  }

  get depthBox(): DepthBox {
    return {
      id: this.placed.id,
      ...this.footprint,
      z: this.placed.z,
      layer: this.def.canWalk ? -1 : 0,
    };
  }

  private updatePosition(): void {
    const fp = this.footprint;
    const p = tileToScreen(fp.maxX, fp.maxY, this.placed.z);
    this.position.set(p.sx, p.sy + TILE_H / 2);
  }
}

/** Âncora calibrada no manifesto ou, sem ela, o centro da base da imagem. */
function anchorFromManifest(def: FurniManifestEntry, dir: number, w: number, h: number) {
  const a = def.anchors[String(dir)];
  return a ? { x: a[0], y: a[1] } : { x: w / 2, y: h };
}
