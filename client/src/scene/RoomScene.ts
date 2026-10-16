import {
  depthOrder,
  parseHeightmap,
  pointInTile,
  RoomGrid,
  tileCorners,
  tileHeight,
  type DepthBox,
  type FurniManifestEntry,
  type Heightmap,
  type RoomDefinition,
  type RoomLayoutMessage,
  type TilePoint,
} from '@office/shared';
import { Container, Graphics, type Application, type Point } from 'pixi.js';
import type { AssetLoader } from '../assets/AssetLoader.js';
import type { AvatarTextureCache } from '../assets/AvatarTextureCache.js';
import type { PlaceholderFactory } from '../assets/PlaceholderFactory.js';
import { DEBUG } from '../config.js';
import { AvatarView, type AvatarSnapshot } from '../entities/AvatarView.js';
import { FurniView } from '../entities/FurniView.js';
import { Camera } from './Camera.js';
import { drawRoom } from './RoomRenderer.js';

export interface SceneDeps {
  loader: AssetLoader;
  placeholders: PlaceholderFactory;
  avatars: AvatarTextureCache;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
}

/**
 * Cena de uma sala: piso/paredes, móveis, avatares, ordenação de profundidade e cliques.
 * Não decide nada sobre movimento: só mostra o estado do servidor e repassa cliques.
 */
export class RoomScene {
  readonly world = new Container({ label: 'world' });
  readonly camera: Camera;
  private readonly map: Heightmap;
  private readonly grid: RoomGrid;
  private readonly objects = new Container({ label: 'objects', sortableChildren: true });
  private readonly hover = new Graphics({ label: 'hover' });
  private readonly target = new Graphics({ label: 'target' });
  private readonly debugLayer = new Graphics({ label: 'debug' });
  private readonly furni: FurniView[] = [];
  private readonly avatars = new Map<string, AvatarView>();
  private depthKey = '';
  private targetFade = 0;
  private localId: string | null = null;

  constructor(
    private readonly app: Application,
    readonly layout: RoomLayoutMessage,
    private readonly deps: SceneDeps,
    private readonly onTileClick: (tile: TilePoint) => void,
  ) {
    this.map = parseHeightmap(layout.heightmap);
    this.grid = new RoomGrid(this.map, layout.furni, deps.furniDefs, { seatsAsGoal: false });

    const room: RoomDefinition = { ...layout, id: layout.roomId };
    this.world.addChild(
      drawRoom(this.map, room),
      this.hover,
      this.target,
      this.objects,
      this.debugLayer,
    );
    app.stage.addChild(this.world);
    this.camera = new Camera(app, this.world);
    this.camera.onTap((p) => this.handleTap(p));
    app.stage.on('globalpointermove', this.onPointerMove, this);
  }

  /** Carrega os móveis e centraliza a câmera. */
  async load(): Promise<void> {
    const { loader, placeholders, furniDefs } = this.deps;
    for (const placed of this.layout.furni) {
      const def = furniDefs.get(placed.defId);
      if (!def) {
        console.warn(`[sala] móvel sem definição no manifesto: ${placed.defId}`);
        continue;
      }
      const view = new FurniView(placed, def);
      this.furni.push(view);
      this.objects.addChild(view);
    }
    await Promise.all(this.furni.map((f) => f.load(loader, placeholders)));
    this.camera.center();
  }

  addAvatar(id: string, snapshot: AvatarSnapshot, isLocal: boolean): void {
    if (this.avatars.has(id)) return this.updateAvatar(id, snapshot);
    const view = new AvatarView(id, snapshot, isLocal, (x, y) => this.grid.heightAt(x, y));
    this.avatars.set(id, view);
    if (isLocal) this.localId = id;
    this.objects.addChild(view);
    this.loadFrames(view, snapshot.figure);
  }

  updateAvatar(id: string, snapshot: AvatarSnapshot): void {
    const view = this.avatars.get(id);
    if (!view) return;
    view.applySnapshot(snapshot);
    if (view.figure !== snapshot.figure) this.loadFrames(view, snapshot.figure);
  }

  /** Busca (no cache por figure) as 8 texturas; ignora respostas de um visual já trocado. */
  private loadFrames(view: AvatarView, figure: string): void {
    view.figure = figure;
    void this.deps.avatars.get(figure).then((frames) => {
      if (!view.destroyed && view.figure === figure) view.setFrames(frames);
    });
  }

  removeAvatar(id: string): void {
    const view = this.avatars.get(id);
    if (!view) return;
    this.avatars.delete(id);
    view.destroy({ children: true });
  }

  update(dtMs: number): void {
    for (const a of this.avatars.values()) a.update(dtMs);
    this.sortDepth();
    if (this.targetFade > 0) {
      this.targetFade = Math.max(0, this.targetFade - dtMs / 900);
      this.target.alpha = this.targetFade;
    }
  }

  destroy(): void {
    this.camera.destroy();
    this.app.stage.off('globalpointermove', this.onPointerMove, this);
    this.world.destroy({ children: true });
  }

  /** Reordena só quando alguma caixa muda (avatar troca de tile, alguém entra ou sai). */
  private sortDepth(): void {
    const boxes: DepthBox[] = this.furni.map((f) => f.depthBox);
    for (const a of this.avatars.values()) boxes.push(a.depthBox);
    const key = boxes
      .map((b) => `${b.id}:${b.minX},${b.minY},${b.maxX},${b.maxY},${b.z}`)
      .join('|');
    if (key === this.depthKey) return;
    this.depthKey = key;

    const views = new Map<string, Container>(this.furni.map((f) => [f.placed.id, f]));
    for (const [id, a] of this.avatars) views.set(id, a);
    depthOrder(boxes).forEach((id, i) => {
      const v = views.get(id);
      if (v) v.zIndex = i;
    });
    if (DEBUG) this.drawDebug(boxes);
  }

  /** Tile sob um ponto da tela, considerando a altura (testa de frente para trás). */
  pickTile(global: Point): TilePoint | null {
    const p = this.world.toLocal(global);
    let best: TilePoint | null = null;
    let bestDepth = -Infinity;
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const z = tileHeight(this.map, x, y);
        if (z === null) continue;
        if (x + y > bestDepth && pointInTile(p.x, p.y, x, y, z)) {
          best = { x, y };
          bestDepth = x + y;
        }
      }
    }
    return best;
  }

  private handleTap(global: Point): void {
    const tile = this.pickTile(global);
    if (!tile || !this.localId) return;
    // O servidor decide o caminho; aqui é só um retorno visual imediato.
    this.flashTarget(tile, this.grid.isWalkable(tile.x, tile.y, true) ? 0xffffff : 0xe0a040);
    this.onTileClick(tile);
  }

  private onPointerMove(e: { global: Point }): void {
    const t = this.pickTile(e.global);
    this.hover.clear();
    if (!t) return;
    const z = tileHeight(this.map, t.x, t.y) ?? 0;
    const pts = tileCorners(t.x, t.y, z).flatMap((c) => [c.sx, c.sy]);
    const ok = this.grid.isWalkable(t.x, t.y, true);
    this.hover.poly(pts, true).stroke({ width: 2, color: ok ? 0xffffff : 0xe05555, alpha: 0.7 });
  }

  private flashTarget(t: TilePoint, color: number): void {
    const z = tileHeight(this.map, t.x, t.y) ?? 0;
    const corners = tileCorners(t.x, t.y, z);
    const c = { sx: corners[0].sx, sy: (corners[0].sy + corners[2].sy) / 2 };
    // Losango menor no centro do tile.
    const pts = corners.flatMap((p) => [c.sx + (p.sx - c.sx) * 0.45, c.sy + (p.sy - c.sy) * 0.45]);
    this.target.clear().poly(pts).fill({ color, alpha: 0.55 });
    this.target.alpha = 1;
    this.targetFade = 1;
  }

  private drawDebug(boxes: DepthBox[]): void {
    const g = this.debugLayer.clear();
    for (const b of boxes) {
      const pts = [
        tileCorners(b.minX, b.minY, b.z)[0],
        tileCorners(b.maxX, b.minY, b.z)[1],
        tileCorners(b.maxX, b.maxY, b.z)[2],
        tileCorners(b.minX, b.maxY, b.z)[3],
      ].flatMap((c) => [c.sx, c.sy]);
      g.poly(pts, true).stroke({ width: 1, color: 0x00e0ff, alpha: 0.8 });
    }
  }
}
