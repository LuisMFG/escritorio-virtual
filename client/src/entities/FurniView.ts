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
import { Container, Sprite, type Point, type Texture } from 'pixi.js';
import type { AssetLoader } from '../assets/AssetLoader.js';
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
    if (!this.visible || !this.sprite.getBounds().containsPoint(global.x, global.y)) return false;
    const local = this.sprite.toLocal(global);
    const tex = this.sprite.texture;
    const px = Math.floor(local.x + this.sprite.anchor.x * tex.width);
    const py = Math.floor(local.y + this.sprite.anchor.y * tex.height);
    return alphaAt(tex, px, py) > 32;
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

/** Canais alfa por textura, lidos uma vez de um canvas (para o teste de clique por pixel). */
const alphaCache = new WeakMap<Texture, { w: number; data: Uint8ClampedArray } | null>();

function alphaAt(tex: Texture, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) return 0;
  let entry = alphaCache.get(tex);
  if (entry === undefined) {
    entry = readPixels(tex);
    alphaCache.set(tex, entry);
  }
  // Sem acesso aos pixels (ex.: textura gerada na GPU): vale a caixa do sprite.
  if (!entry) return 255;
  return entry.data[(y * entry.w + x) * 4 + 3] ?? 0;
}

function readPixels(tex: Texture): { w: number; data: Uint8ClampedArray } | null {
  const resource = tex.source.resource as CanvasImageSource | undefined;
  if (!(resource instanceof HTMLImageElement) && !(resource instanceof HTMLCanvasElement))
    return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = tex.width;
    canvas.height = tex.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(resource, 0, 0);
    return { w: tex.width, data: ctx.getImageData(0, 0, tex.width, tex.height).data };
  } catch {
    return null;
  }
}

/** Âncora calibrada no manifesto ou, sem ela, o centro da base da imagem. */
function anchorFromManifest(def: FurniManifestEntry, dir: number, w: number, h: number) {
  const a = def.anchors[String(dir)];
  return a ? { x: a[0], y: a[1] } : { x: w / 2, y: h };
}
