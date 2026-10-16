import {
  depthOrder,
  findNearestReachable,
  findPath,
  parseHeightmap,
  pointInTile,
  RoomGrid,
  tileCorners,
  tileHeight,
  type DepthBox,
  type FurniManifestEntry,
  type Heightmap,
  type RoomDefinition,
  type TilePoint,
} from '@office/shared';
import { Container, Graphics, type Application, type Point } from 'pixi.js';
import type { AssetLoader } from '../assets/AssetLoader.js';
import type { AvatarTextureCache } from '../assets/AvatarTextureCache.js';
import type { PlaceholderFactory } from '../assets/PlaceholderFactory.js';
import { DEBUG } from '../config.js';
import { AvatarView } from '../entities/AvatarView.js';
import { FurniView } from '../entities/FurniView.js';
import { Camera } from './Camera.js';
import { drawRoom } from './RoomRenderer.js';

interface SceneDeps {
  loader: AssetLoader;
  placeholders: PlaceholderFactory;
  avatars: AvatarTextureCache;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
}

/**
 * Cena de uma sala: piso/paredes, móveis, avatares, ordenação de profundidade e cliques.
 * Na Fase 1 há um único avatar local, movido por pathfinding no próprio cliente.
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
  private avatar: AvatarView | null = null;
  private depthKey = '';
  private targetFade = 0;

  constructor(
    private readonly app: Application,
    readonly room: RoomDefinition,
    private readonly deps: SceneDeps,
  ) {
    this.map = parseHeightmap(room.heightmap);
    // Fase 1: ainda não dá para sentar, então cadeiras não são destino de caminhada.
    this.grid = new RoomGrid(this.map, room.furni, deps.furniDefs, { seatsAsGoal: false });

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
    app.stage.on('globalpointermove', (e) => this.updateHover(e.global));
  }

  async load(figure: string): Promise<void> {
    const { loader, placeholders, furniDefs, avatars } = this.deps;
    for (const placed of this.room.furni) {
      const def = furniDefs.get(placed.defId);
      if (!def) {
        console.warn(`[sala] móvel sem definição no manifesto: ${placed.defId}`);
        continue;
      }
      const view = new FurniView(placed, def);
      this.furni.push(view);
      this.objects.addChild(view);
    }

    const { spawn } = this.room;
    this.avatar = new AvatarView('local', spawn, spawn.dir, (x, y) => this.grid.heightAt(x, y));
    this.objects.addChild(this.avatar);

    await Promise.all([
      ...this.furni.map((f) => f.load(loader, placeholders)),
      avatars.get(figure).then((frames) => this.avatar?.setFrames(frames)),
    ]);
    this.camera.center();
  }

  update(dtMs: number): void {
    this.avatar?.update(dtMs);
    this.sortDepth();
    if (this.targetFade > 0) {
      this.targetFade = Math.max(0, this.targetFade - dtMs / 600);
      this.target.alpha = this.targetFade;
      if (this.avatar && !this.avatar.isWalking) this.targetFade = 0;
    }
  }

  /** Reordena só quando alguma caixa muda (avatar troca de tile, móvel muda). */
  private sortDepth(): void {
    const boxes: DepthBox[] = this.furni.map((f) => f.depthBox);
    if (this.avatar) boxes.push(this.avatar.depthBox);
    const key = boxes
      .map((b) => `${b.id}:${b.minX},${b.minY},${b.maxX},${b.maxY},${b.z}`)
      .join('|');
    if (key === this.depthKey) return;
    this.depthKey = key;

    const order = depthOrder(boxes);
    const views = new Map<string, Container>(this.furni.map((f) => [f.placed.id, f]));
    if (this.avatar) views.set(this.avatar.avatarId, this.avatar);
    order.forEach((id, i) => {
      const v = views.get(id);
      if (v) v.zIndex = i;
    });
    if (DEBUG) this.drawDebug(boxes);
  }

  /** Tile sob um ponto do mundo, considerando a altura (testa de frente para trás). */
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
    const avatar = this.avatar;
    const goal = this.pickTile(global);
    if (!avatar || !goal) return;
    const start = avatar.nextTile;
    let dest = goal;
    let path = findPath(this.grid, start, goal);
    if (!path) {
      const near = findNearestReachable(this.grid, start, goal, 2);
      if (near) {
        dest = near.tile;
        path = near.path;
      }
    }
    if (!path) {
      this.flashTarget(goal, 0xe05555);
      return;
    }
    avatar.walk(path);
    this.flashTarget(dest, 0xffffff);
  }

  private updateHover(global: Point): void {
    const t = this.pickTile(global);
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
