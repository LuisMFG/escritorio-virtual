import type { Application, Container, FederatedPointerEvent, Point } from 'pixi.js';

const ZOOM_LEVELS = [1, 2, 3];
/** Distância (px) a partir da qual um clique vira arrasto. */
const DRAG_THRESHOLD = 5;

/**
 * Câmera 2D: arrastar para mover, roda do mouse/botões para zoom inteiro (1×, 2×, 3×),
 * mantendo a pixel art nítida. Cliques sem arrasto são repassados via `onTap`.
 */
export class Camera {
  private levelIndex = 0;
  private pointerDown: { x: number; y: number; worldX: number; worldY: number } | null = null;
  private dragging = false;
  private userMoved = false;
  /** Acumula a roda do mouse para trackpads não pularem vários níveis de uma vez. */
  private wheelAccum = 0;
  private readonly tapListeners: ((global: Point) => void)[] = [];
  /** Se devolver true no pointerdown, a câmera ignora o gesto (ex.: arrastar um móvel). */
  private pointerGuard: ((global: Point) => boolean) | null = null;

  constructor(
    private readonly app: Application,
    private readonly world: Container,
  ) {
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;
    stage.on('pointerdown', this.onDown, this);
    stage.on('globalpointermove', this.onMove, this);
    stage.on('pointerup', this.onUp, this);
    stage.on('pointerupoutside', this.reset, this);
    app.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    app.renderer.on('resize', this.onResize, this);
  }

  /** Remove os listeners (a cena é recriada ao trocar de sala ou reconectar). */
  destroy(): void {
    const stage = this.app.stage;
    stage.off('pointerdown', this.onDown, this);
    stage.off('globalpointermove', this.onMove, this);
    stage.off('pointerup', this.onUp, this);
    stage.off('pointerupoutside', this.reset, this);
    this.app.canvas.removeEventListener('wheel', this.handleWheel);
    this.app.renderer.off('resize', this.onResize, this);
    this.tapListeners.length = 0;
  }

  private readonly handleWheel = (e: WheelEvent) => this.onWheel(e);

  private onResize(): void {
    if (!this.userMoved) this.center();
  }

  get zoom(): number {
    return ZOOM_LEVELS[this.levelIndex]!;
  }

  setPointerGuard(guard: ((global: Point) => boolean) | null): void {
    this.pointerGuard = guard;
  }

  onTap(listener: (global: Point) => void): void {
    this.tapListeners.push(listener);
  }

  /** Centraliza o conteúdo do mundo na tela. */
  center(): void {
    this.world.scale.set(this.zoom);
    const b = this.world.getLocalBounds();
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.world.position.set(
      Math.round(this.app.screen.width / 2 - cx * this.zoom),
      Math.round(this.app.screen.height / 2 - cy * this.zoom),
    );
    this.userMoved = false;
  }

  zoomIn(): void {
    this.setLevel(this.levelIndex + 1);
  }

  zoomOut(): void {
    this.setLevel(this.levelIndex - 1);
  }

  /** Troca o zoom mantendo fixo o ponto de tela `focus` (padrão: centro da tela). */
  private setLevel(index: number, focus?: { x: number; y: number }): void {
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index));
    if (next === this.levelIndex) return;
    const f = focus ?? { x: this.app.screen.width / 2, y: this.app.screen.height / 2 };
    const before = this.zoom;
    this.levelIndex = next;
    const after = this.zoom;
    const wx = (f.x - this.world.x) / before;
    const wy = (f.y - this.world.y) / before;
    this.world.scale.set(after);
    this.world.position.set(Math.round(f.x - wx * after), Math.round(f.y - wy * after));
  }

  private onDown(e: FederatedPointerEvent): void {
    if (this.pointerGuard?.(e.global)) {
      this.reset();
      return;
    }
    this.pointerDown = { x: e.global.x, y: e.global.y, worldX: this.world.x, worldY: this.world.y };
    this.dragging = false;
  }

  private onMove(e: FederatedPointerEvent): void {
    const d = this.pointerDown;
    if (!d) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (!this.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.dragging = true;
    if (this.dragging) {
      this.world.position.set(Math.round(d.worldX + dx), Math.round(d.worldY + dy));
      this.userMoved = true;
    }
  }

  private onUp(e: FederatedPointerEvent): void {
    const wasTap = this.pointerDown && !this.dragging;
    this.reset();
    if (wasTap) for (const l of this.tapListeners) l(e.global);
  }

  private reset(): void {
    this.pointerDown = null;
    this.dragging = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.wheelAccum += e.deltaY;
    if (Math.abs(this.wheelAccum) < 60) return;
    const rect = this.app.canvas.getBoundingClientRect();
    const focus = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.setLevel(this.levelIndex + (this.wheelAccum < 0 ? 1 : -1), focus);
    this.wheelAccum = 0;
    this.userMoved = true;
  }
}
