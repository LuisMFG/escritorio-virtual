import {
  canPlace,
  footprint,
  tileCorners,
  tileHeight,
  WALL_PX,
  type FurniColorMessage,
  type FurniManifestEntry,
  type FurniMoveMessage,
  type FurniPlaceMessage,
  type Heightmap,
  type PlacementContext,
  type TilePoint,
} from '@office/shared';
import type { Graphics, Point } from 'pixi.js';
import type { FurniView } from '../entities/FurniView.js';
import type { WallSpot } from './RoomScene.js';

export interface DecorActions {
  placeFurni(msg: FurniPlaceMessage): void;
  moveFurni(msg: FurniMoveMessage): void;
  removeFurni(furniId: string): void;
  colorFurni(msg: FurniColorMessage): void;
}

/** O que o modo decorar precisa da cena. */
export interface DecorHost {
  readonly map: Heightmap;
  readonly defs: ReadonlyMap<string, FurniManifestEntry>;
  /** Camada para desenhar footprints (verde/vermelho/seleção). */
  readonly overlay: Graphics;
  pickTile(global: Point): TilePoint | null;
  pickFurni(global: Point): FurniView | null;
  /** Ponto de parede sob o ponteiro (itens de parede). */
  pickWall(global: Point): WallSpot | null;
  furniView(id: string): FurniView | undefined;
  placementContext(): PlacementContext;
  /** Cria um móvel "fantasma" semitransparente por cima de tudo. */
  createGhost(defId: string, x: number, y: number, rot: number): FurniView;
}

/** Móvel selecionado no modo decorar. */
export interface DecorSelection {
  id: string;
  name: string;
  defId: string;
  interaction?: string;
}

export interface DecorListener {
  onPickChange(defId: string | null): void;
  onSelectionChange(selected: DecorSelection | null): void;
  onError(message: string): void;
}

const OK = 0x3fbf6f;
const BAD = 0xe05555;
const SELECT = 0x7aa7ff;
/** Distância (px) a partir da qual pressionar um móvel vira arrastar. */
const DRAG_THRESHOLD = 5;

interface Ghost {
  view: FurniView;
  defId: string;
  rot: number;
  tile: TilePoint | null;
  /** Itens de parede: altura acima do piso. */
  h?: number;
  ok: boolean;
  reason?: string;
}

/** Onde o fantasma está: tile (piso) ou ponto de parede. */
type Target = { tile: TilePoint; rot?: number; h?: number } | null;

/**
 * Modo "editar sala": escolher no catálogo e clicar para colocar, clicar num móvel para
 * selecionar, arrastar para mover, R para girar e Delete para remover. Valida no cliente
 * com as mesmas regras do servidor (`canPlace`) só para mostrar verde/vermelho; quem decide
 * é o servidor.
 */
export class DecorMode {
  active = false;
  private picking: Ghost | null = null;
  private selectedId: string | null = null;
  private drag: {
    furniId: string;
    start: { x: number; y: number };
    grab: TilePoint;
    ghost: Ghost | null;
  } | null = null;

  constructor(
    private readonly host: DecorHost,
    private readonly actions: DecorActions,
    private readonly listener: DecorListener,
  ) {
    document.addEventListener('keydown', this.onKey);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey);
    this.cancelAll();
  }

  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    if (!on) this.cancelAll();
    this.redraw();
  }

  /** Escolheu um item no catálogo: o fantasma passa a seguir o mouse. */
  pick(defId: string | null): void {
    this.endPicking();
    this.select(null);
    if (!defId || !this.host.defs.has(defId)) return this.listener.onPickChange(null);
    const def = this.host.defs.get(defId)!;
    this.picking = {
      view: this.host.createGhost(defId, -99, -99, def.directions[0] ?? 0),
      defId,
      rot: def.wall ? 2 : 0,
      tile: null,
      ok: false,
    };
    this.picking.view.visible = false;
    this.listener.onPickChange(defId);
  }

  rotate(): void {
    // Item de parede vira junto com a parede: arraste para a outra parede.
    const wallPick = this.picking && this.host.defs.get(this.picking.defId)?.wall;
    const sel = this.selectedId ? this.host.furniView(this.selectedId) : undefined;
    if (wallPick || (!this.picking && sel?.def.wall)) return;
    if (this.picking) {
      this.picking.rot = (this.picking.rot + 2) % 8;
      this.updateGhost(this.picking, this.retarget(this.picking), undefined);
      return;
    }
    const f = this.selectedId ? this.host.furniView(this.selectedId) : undefined;
    if (!f) return;
    const rot = (f.placed.rot + 2) % 8;
    const res = canPlace(this.host.placementContext(), { ...f.placed, rot, ignoreId: f.placed.id });
    if (!res.ok) return this.listener.onError(res.reason);
    this.actions.moveFurni({
      furniId: f.placed.id,
      x: f.placed.x,
      y: f.placed.y,
      rot: rot as 0 | 2 | 4 | 6,
    });
  }

  removeSelected(): void {
    if (this.selectedId) this.actions.removeFurni(this.selectedId);
    this.select(null);
  }

  /** Um móvel some do estado (removido por alguém). */
  forget(furniId: string): void {
    if (this.selectedId === furniId) this.select(null);
    if (this.drag?.furniId === furniId) this.cancelDrag();
  }

  /** Troca a cor do móvel selecionado (outra variação do mesmo móvel). */
  setColor(defId: string): void {
    const f = this.selectedId ? this.host.furniView(this.selectedId) : undefined;
    if (f && f.placed.defId !== defId) this.actions.colorFurni({ furniId: f.placed.id, defId });
  }

  /** Móvel selecionado agora (`null` = nenhum). */
  get selected(): string | null {
    return this.selectedId;
  }

  /** Seleciona de novo um móvel recriado (trocou de cor). */
  reselect(furniId: string): void {
    if (this.active) this.select(furniId);
  }

  /** Algo mudou na sala (móvel/avatar): recalcula verde/vermelho. */
  refresh(): void {
    if (this.picking) this.updateGhost(this.picking, this.retarget(this.picking), undefined);
    this.redraw();
  }

  // ---------- Ponteiro (chamado pela cena) ----------

  /** Pressionou: se for num móvel (e não estiver colocando), começa um possível arrasto. */
  pointerDown(global: Point): boolean {
    if (!this.active || this.picking) return false;
    const f = this.host.pickFurni(global);
    if (!f) return false;
    const tile = this.host.pickTile(global) ?? { x: f.placed.x, y: f.placed.y };
    this.drag = {
      furniId: f.placed.id,
      start: { x: global.x, y: global.y },
      grab: { x: tile.x - f.placed.x, y: tile.y - f.placed.y },
      ghost: null,
    };
    return true;
  }

  pointerMove(global: Point): void {
    if (!this.active) return;
    if (this.picking) {
      this.updateGhost(this.picking, this.targetAt(this.picking.defId, global), undefined);
      return;
    }
    const tile = this.host.pickTile(global);
    const d = this.drag;
    if (!d) return;
    const f = this.host.furniView(d.furniId);
    if (!f) return this.cancelDrag();
    if (!d.ghost) {
      if (Math.hypot(global.x - d.start.x, global.y - d.start.y) < DRAG_THRESHOLD) return;
      d.ghost = {
        view: this.host.createGhost(f.placed.defId, f.placed.x, f.placed.y, f.placed.rot),
        defId: f.placed.defId,
        rot: f.placed.rot,
        tile: null,
        ok: false,
      };
      f.alpha = 0.3;
      this.select(d.furniId);
    }
    if (f.def.wall) return this.updateGhost(d.ghost, this.targetAt(f.def.id, global), d.furniId);
    const origin = tile ? { tile: { x: tile.x - d.grab.x, y: tile.y - d.grab.y } } : null;
    this.updateGhost(d.ghost, origin, d.furniId);
  }

  pointerUp(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const f = this.host.furniView(d.furniId);
    if (f) f.alpha = 1;
    if (!d.ghost) {
      // Foi um clique: seleciona.
      this.select(d.furniId);
      return;
    }
    const g = d.ghost;
    g.view.destroy({ children: true });
    if (g.tile && g.ok) {
      this.actions.moveFurni({
        furniId: d.furniId,
        x: g.tile.x,
        y: g.tile.y,
        rot: g.rot as 0 | 2 | 4 | 6,
        z: g.h,
      });
    } else if (g.tile && g.reason) {
      this.listener.onError(g.reason);
    }
    this.redraw();
  }

  /** Clique sem arrasto no piso (a câmera repassa). */
  tap(global: Point): void {
    if (!this.active) return;
    if (this.picking) {
      const g = this.picking;
      this.updateGhost(g, this.targetAt(g.defId, global), undefined);
      if (!g.tile) {
        if (this.host.defs.get(g.defId)?.wall) this.listener.onError('Isso vai na parede.');
        return;
      }
      if (!g.ok) return this.listener.onError(g.reason ?? 'Não dá para colocar aí.');
      this.actions.placeFurni({
        defId: g.defId,
        x: g.tile.x,
        y: g.tile.y,
        rot: g.rot as 0 | 2 | 4 | 6,
        z: g.h,
      });
      return;
    }
    this.select(null);
  }

  // ---------- Interno ----------

  /** Alvo sob o ponteiro: ponto de parede para itens de parede, tile para o resto. */
  private targetAt(defId: string, global: Point): Target {
    if (this.host.defs.get(defId)?.wall) {
      const spot = this.host.pickWall(global);
      return spot ? { tile: { x: spot.x, y: spot.y }, rot: spot.rot, h: spot.h } : null;
    }
    const tile = this.host.pickTile(global);
    return tile ? { tile } : null;
  }

  /** O alvo atual do fantasma (para recalcular sem mexer o ponteiro). */
  private retarget(g: Ghost): Target {
    return g.tile ? { tile: g.tile, h: g.h } : null;
  }

  private updateGhost(g: Ghost, target: Target, ignoreId: string | undefined): void {
    const tile = target?.tile ?? null;
    g.tile = tile;
    if (target?.rot !== undefined) g.rot = target.rot;
    g.h = target?.h;
    if (!tile) {
      g.view.visible = false;
      g.ok = false;
      this.redraw();
      return;
    }
    const res = canPlace(this.host.placementContext(), {
      defId: g.defId,
      x: tile.x,
      y: tile.y,
      rot: g.rot,
      z: g.h,
      ignoreId,
    });
    g.ok = res.ok;
    g.reason = res.ok ? undefined : res.reason;
    g.view.visible = true;
    g.view.update({
      id: g.view.placed.id,
      defId: g.defId,
      x: tile.x,
      y: tile.y,
      z: res.ok ? res.z : (tileHeight(this.host.map, tile.x, tile.y) ?? 0) + (g.h ?? 0),
      rot: g.rot,
    });
    this.redraw();
  }

  private select(id: string | null): void {
    this.selectedId = id;
    const f = id ? this.host.furniView(id) : undefined;
    this.listener.onSelectionChange(
      f
        ? {
            id: f.placed.id,
            name: f.def.name,
            defId: f.placed.defId,
            interaction: f.def.interaction,
          }
        : null,
    );
    this.redraw();
  }

  private endPicking(): void {
    this.picking?.view.destroy({ children: true });
    this.picking = null;
  }

  private cancelDrag(): void {
    if (!this.drag) return;
    const f = this.host.furniView(this.drag.furniId);
    if (f) f.alpha = 1;
    this.drag.ghost?.view.destroy({ children: true });
    this.drag = null;
  }

  private cancelAll(): void {
    this.endPicking();
    this.cancelDrag();
    this.select(null);
    this.listener.onPickChange(null);
  }

  /** Footprints: fantasma em verde/vermelho e o selecionado em azul. */
  private redraw(): void {
    const g = this.host.overlay.clear();
    if (!this.active) return;
    const ghost = this.picking ?? this.drag?.ghost ?? null;
    // Colocando ou arrastando: a grade de tiles do piso aparece (Fase 47).
    if (ghost) this.drawTileGrid(g);
    if (ghost?.tile) {
      const def = this.host.defs.get(ghost.defId);
      if (def) this.drawFootprint(g, def, ghost.tile, ghost.rot, ghost.ok ? OK : BAD, true);
    }
    const sel = this.selectedId ? this.host.furniView(this.selectedId) : undefined;
    if (sel && !this.drag?.ghost)
      this.drawFootprint(g, sel.def, sel.placed, sel.placed.rot, SELECT, false);
  }

  /** Contorno fraquinho de todos os tiles do piso. */
  private drawTileGrid(g: Graphics): void {
    const { width, height } = this.host.map;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const z = tileHeight(this.host.map, x, y);
        if (z === null || z === undefined) continue;
        const pts = tileCorners(x, y, z).flatMap((c) => [c.sx, c.sy]);
        g.poly(pts, true).stroke({ width: 1, color: 0xffffff, alpha: 0.18 });
      }
    }
  }

  private drawFootprint(
    g: Graphics,
    def: FurniManifestEntry,
    at: TilePoint,
    rot: number,
    color: number,
    fill: boolean,
  ): void {
    if (def.wall) {
      // Item de parede: destaca a face da parede daquele tile.
      const z = tileHeight(this.host.map, at.x, at.y) ?? 0;
      const [top, right, , left] = tileCorners(at.x, at.y, z);
      const [a, b] = rot === 4 ? [left, top] : [top, right];
      const pts = [a.sx, a.sy, b.sx, b.sy, b.sx, b.sy - WALL_PX, a.sx, a.sy - WALL_PX];
      if (fill) g.poly(pts).fill({ color, alpha: 0.25 });
      g.poly(pts, true).stroke({ width: 2, color, alpha: 0.9 });
      return;
    }
    const fp = footprint(def, at.x, at.y, rot);
    for (let y = fp.minY; y <= fp.maxY; y++) {
      for (let x = fp.minX; x <= fp.maxX; x++) {
        const z = tileHeight(this.host.map, x, y) ?? 0;
        const pts = tileCorners(x, y, z).flatMap((c) => [c.sx, c.sy]);
        if (fill) g.poly(pts).fill({ color, alpha: 0.35 });
        g.poly(pts, true).stroke({ width: 2, color, alpha: 0.9 });
      }
    }
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if ((e.target as HTMLElement).closest('input, textarea, [role=dialog]')) return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.rotate();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.removeSelected();
    } else if (e.key === 'Escape') {
      if (this.picking) this.pick(null);
      else this.select(null);
    }
  };
}
