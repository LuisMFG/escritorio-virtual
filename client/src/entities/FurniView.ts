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
import { Container, Matrix, Sprite, Texture, type Point } from 'pixi.js';
import type { AssetLoader } from '../assets/AssetLoader.js';
import { spriteHitTest } from '../assets/hitTest.js';
import type { PlaceholderFactory } from '../assets/PlaceholderFactory.js';

/** Sprite de um móvel posicionado. O ponto de origem é o vértice de baixo do footprint. */
export class FurniView extends Container {
  private readonly sprite = new Sprite();
  /** `direção:estado` da textura atual. */
  private loadedKey: string | null = null;
  private loadToken = 0;
  /** Miniatura do quadro branco por cima do papel (se o móvel tiver `surface`). */
  private surface: { sprite: Sprite; canvas: HTMLCanvasElement; texture: Texture } | null = null;
  private loadedDir = -1;

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

  /**
   * Estado que o imager sabe desenhar (senão, o padrão). Luzes ficam sempre no desenho
   * "apagado": no Habbo o facho de luz é uma camada somada (ink ADD) que o imager achata
   * num disco escuro; o brilho aceso é desenhado pela cena.
   */
  get state(): number {
    if (this.def.light) return 0;
    const s = this.placed.state ?? 0;
    return s > 0 && this.def.states.includes(s) ? s : 0;
  }

  /** Carrega a textura da direção e do estado atuais (só se mudaram). */
  async load(): Promise<void> {
    const { def, placed } = this;
    const dir = renderDirection(def, placed.rot);
    const state = this.state;
    const key = `${dir}:${state}`;
    if (key === this.loadedKey) return;
    const token = ++this.loadToken;
    const opts = {
      direction: dir,
      revision: def.revision,
      color: def.color,
      state: state > 0 ? state : undefined,
    };
    // Proxy com cache do servidor primeiro; imager direto se o servidor não responder.
    // Locais (CC0 ou próprios): client/public/assets/local/furni/{id}_{dir}.png.
    const urls =
      def.source === 'habboassets'
        ? [furniImageUrl(def.id, opts, '/hh'), furniImageUrl(def.id, opts)]
        : [`/assets/local/furni/${def.id}_${dir}.png`];
    const loaded = await this.loader.load(
      `furni:${def.id}:${dir}:${def.color ?? ''}:${state}`,
      urls,
      () => this.placeholders.furni(def, placed.rot),
    );
    if (token !== this.loadToken || this.destroyed) return;
    const tex = loaded.texture;
    const anchor = loaded.anchor ?? anchorFromManifest(def, dir, state, tex.width, tex.height);
    this.sprite.texture = tex;
    this.sprite.anchor.set(anchor.x / tex.width, anchor.y / tex.height);
    this.loadedKey = key;
    this.loadedDir = dir;
    this.placeSurface();
  }

  /** Mostra (ou atualiza) a miniatura do desenho no papel do quadro. */
  setSurfaceCanvas(canvas: HTMLCanvasElement): void {
    if (!this.def.surface) return;
    if (!this.surface || this.surface.canvas !== canvas) {
      this.surface?.sprite.destroy();
      this.surface?.texture.destroy();
      const texture = Texture.from(canvas);
      const sprite = new Sprite(texture);
      this.addChild(sprite);
      this.surface = { sprite, canvas, texture };
    } else {
      this.surface.texture.source.update();
    }
    this.placeSurface();
  }

  /**
   * Encaixa a miniatura no paralelogramo do papel (cantos medidos na PNG daquela direção):
   * transformação afim do retângulo da textura para os cantos, com uma margem de 6%.
   */
  private placeSurface(): void {
    const corners = this.def.surface?.[String(this.loadedDir)];
    if (!this.surface || !corners) {
      if (this.surface) this.surface.sprite.visible = false;
      return;
    }
    const [tl, tr, bl] = corners;
    const tex = this.sprite.texture;
    // Canto superior esquerdo da PNG, no espaço deste container (o sprite usa âncora).
    const ox = -this.sprite.anchor.x * tex.width;
    const oy = -this.sprite.anchor.y * tex.height;
    const u = [tr[0] - tl[0], tr[1] - tl[1]];
    const v = [bl[0] - tl[0], bl[1] - tl[1]];
    const m = 0.06;
    const { width: w, height: h } = this.surface.canvas;
    const sx = (1 - 2 * m) / w;
    const sy = (1 - 2 * m) / h;
    this.surface.sprite.setFromMatrix(
      new Matrix(
        u[0]! * sx,
        u[1]! * sx,
        v[0]! * sy,
        v[1]! * sy,
        ox + tl[0] + m * (u[0]! + v[0]!),
        oy + tl[1] + m * (u[1]! + v[1]!),
      ),
    );
    this.surface.sprite.visible = true;
  }

  /** Móvel de luz aceso? (A cena desenha o brilho.) */
  get lit(): boolean {
    return this.def.light && (this.placed.state ?? 0) > 0;
  }

  /** Ponto (na cena) de onde sai a luz: perto do topo do desenho. */
  get glowPoint(): { x: number; y: number } {
    const h = this.sprite.texture.height || 64;
    return { x: this.x, y: this.y - h * 0.7 };
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
function anchorFromManifest(
  def: FurniManifestEntry,
  dir: number,
  state: number,
  w: number,
  h: number,
) {
  const a = (state > 0 && def.stateAnchors[`${dir}:${state}`]) || def.anchors[String(dir)];
  return a ? { x: a[0], y: a[1] } : { x: w / 2, y: h };
}
