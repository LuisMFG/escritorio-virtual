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
import { Container, Graphics, Matrix, Sprite, Texture, type Point } from 'pixi.js';
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
  /** Tabuleiro do jogo da velha deitado no tampo (mesa de jogos). */
  private gameBoard: Graphics | null = null;
  private game: { board: string; line: number[] } | null = null;

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
        ? [
            furniImageUrl(def.sprite ?? def.id, opts, '/hh'),
            furniImageUrl(def.sprite ?? def.id, opts),
          ]
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
    this.drawGameBoard();
  }

  /** Mostra a partida no tampo da mesa (`null` tira). */
  setGame(game: { board: string; line: number[] } | null): void {
    this.game = game;
    this.drawGameBoard();
  }

  /**
   * Tabuleiro em perspectiva isométrica sobre o tampo: um losango 3×3 centrado no meio do
   * tampo (medido na PNG da mesa redonda: ~27% da altura a partir do topo).
   */
  private drawGameBoard(): void {
    if (!this.game) {
      this.gameBoard?.destroy();
      this.gameBoard = null;
      return;
    }
    if (!this.gameBoard) {
      this.gameBoard = new Graphics();
      this.gameBoard.eventMode = 'none';
      this.addChild(this.gameBoard);
    }
    const tex = this.sprite.texture;
    const cx = -this.sprite.anchor.x * tex.width + tex.width / 2;
    const cy = -this.sprite.anchor.y * tex.height + tex.height * 0.27;
    const W = 27;
    const H = 13.5;
    // (u, v) de 0 a 3: canto de cima (0,0), direita (3,0), esquerda (0,3), baixo (3,3).
    const pt = (u: number, v: number): [number, number] => [
      cx + ((u - v) * W) / 3,
      cy - H + ((u + v) * H) / 3,
    ];
    const g = this.gameBoard.clear();
    g.poly([...pt(0, 0), ...pt(3, 0), ...pt(3, 3), ...pt(0, 3)], true)
      .fill({ color: 0xfdf6e3, alpha: 0.95 })
      .stroke({ width: 1.5, color: 0x5b4636 });
    for (const k of [1, 2]) {
      g.moveTo(...pt(k, 0))
        .lineTo(...pt(k, 3))
        .moveTo(...pt(0, k))
        .lineTo(...pt(3, k));
    }
    g.stroke({ width: 1, color: 0x5b4636, alpha: 0.8 });
    const { board, line } = this.game;
    for (let i = 0; i < 9; i++) {
      const u = (i % 3) + 0.5;
      const v = Math.floor(i / 3) + 0.5;
      if (board[i] === 'X') {
        g.moveTo(...pt(u - 0.28, v - 0.28))
          .lineTo(...pt(u + 0.28, v + 0.28))
          .moveTo(...pt(u + 0.28, v - 0.28))
          .lineTo(...pt(u - 0.28, v + 0.28))
          .stroke({ width: 2, color: 0xdc2626 });
      } else if (board[i] === 'O') {
        const [x, y] = pt(u, v);
        g.ellipse(x, y, W * 0.11, H * 0.11).stroke({ width: 2, color: 0x2563eb });
      }
    }
    if (line.length === 3) {
      const a = pt((line[0]! % 3) + 0.5, Math.floor(line[0]! / 3) + 0.5);
      const b = pt((line[2]! % 3) + 0.5, Math.floor(line[2]! / 3) + 0.5);
      g.moveTo(...a)
        .lineTo(...b)
        .stroke({ width: 2.5, color: 0xf59e0b, alpha: 0.9 });
    }
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
