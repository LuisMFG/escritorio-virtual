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
import { Container, Sprite, type Point } from 'pixi.js';
import type { AssetLoader } from '../assets/AssetLoader.js';
import { spriteHitTest } from '../assets/hitTest.js';
import type { PlaceholderFactory } from '../assets/PlaceholderFactory.js';

/** Sprite de um móvel posicionado. O ponto de origem é o vértice de baixo do footprint. */
export class FurniView extends Container {
  private readonly sprite = new Sprite();
  private loadedDir: number | null = null;
  private loadToken = 0;

  constructor(
    public placed: PlacedFurni,
    readonly def: FurniManifestEntry,
    private readonly loader: AssetLoader,
    private readonly placeholders: PlaceholderFactory,
  ) {
    super();
    this.label = `furni:${placed.id}`;
    this.addChild(this.sprite);
    this.updatePosition();
  }

  /** Carrega a textura da direção atual (só se mudou). */
  async load(): Promise<void> {
    const { def, placed } = this;
    const dir = renderDirection(def, placed.rot);
    if (dir === this.loadedDir) return;
    const token = ++this.loadToken;
    const opts = { direction: dir, revision: def.revision, color: def.color };
    // Proxy com cache do servidor primeiro; imager direto se o servidor não responder.
    // Locais (CC0 ou próprios): client/public/assets/local/furni/{id}_{dir}.png.
    const urls =
      def.source === 'habboassets'
        ? [furniImageUrl(def.id, opts, '/hh'), furniImageUrl(def.id, opts)]
        : [`/assets/local/furni/${def.id}_${dir}.png`];
    const loaded = await this.loader.load(`furni:${def.id}:${dir}:${def.color ?? ''}`, urls, () =>
      this.placeholders.furni(def, placed.rot),
    );
    if (token !== this.loadToken || this.destroyed) return;
    const tex = loaded.texture;
    const anchor = loaded.anchor ?? anchorFromManifest(def, dir, tex.width, tex.height);
    this.sprite.texture = tex;
    this.sprite.anchor.set(anchor.x / tex.width, anchor.y / tex.height);
    this.loadedDir = dir;
  }

  /** Aplica posição/rotação novas vindas do servidor (ou do fantasma do modo decorar). */
  update(placed: PlacedFurni): void {
    this.placed = placed;
    this.updatePosition();
    void this.load();
  }

  /** O ponto de tela cai num pixel visível do desenho deste móvel? */
  hitTest(global: Point): boolean {
    return this.visible && spriteHitTest(this.sprite, global);
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
