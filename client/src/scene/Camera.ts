import type { Application, Container, FederatedPointerEvent, Point } from 'pixi.js';

/** Níveis de zoom (Fase 41: com intermediários, para a sala caber inteira em notebooks). */
export const ZOOM_LEVELS = [0.4, 0.5, 0.75, 1, 1.5, 2, 3];
const DEFAULT_ZOOM = 1;
/** Maior zoom que o enquadramento automático escolhe (salas pequenas não viram um borrão). */
const MAX_FIT_ZOOM = 2;
/** Folga (px) entre a sala e as bordas da área livre. */
const FIT_PADDING = 16;
/** Quanto a distância entre os dedos precisa mudar para a pinça trocar de nível. */
const PINCH_STEP = 1.2;
/** Segurar parado por isto (ms) vira "segurar" em vez de toque (Fase 46). */
const LONG_PRESS_MS = 500;

/** Faixas da tela cobertas pela interface (px); a câmera enquadra no que sobra. */
export interface CameraInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Zoom em que uma sala `w`×`h` (em 1×) cabe inteira na área livre `areaW`×`areaH`.
 * Abaixo de 1× é contínuo (de 0,05 em 0,05) para aproveitar a tela; de 1× para cima fica num
 * dos níveis (1×, 1,5×, 2×) para a pixel art seguir nítida. Entre 0,4× (celular) e `MAX_FIT_ZOOM`.
 */
export function fitZoom(w: number, h: number, areaW: number, areaH: number): number {
  const raw = Math.min((areaW - FIT_PADDING * 2) / w, (areaH - FIT_PADDING * 2) / h);
  const min = ZOOM_LEVELS[0]!;
  if (!(raw > min)) return min;
  if (raw < 1) return Math.floor(raw * 20) / 20;
  return [...ZOOM_LEVELS].reverse().find((z) => z <= Math.min(raw, MAX_FIT_ZOOM)) ?? 1;
}
/** Distância (px) a partir da qual um clique vira arrasto. */
const DRAG_THRESHOLD = 5;

/** De onde veio um toque/clique: dedo ou mouse, e qual ponteiro. */
export interface TapInfo {
  touch: boolean;
  id: number;
}

/**
 * Câmera 2D: arrastar para mover; roda do mouse, pinça ou botões para zoom. Ao abrir, a sala é
 * enquadrada na área livre da tela (descontando a interface). Cliques sem arrasto vão para `onTap`.
 */
export class Camera {
  private zoomValue = DEFAULT_ZOOM;
  /** A pessoa escolheu o zoom (botões/roda): o enquadramento automático não mexe mais. */
  private userZoomed = false;
  private pointerDown: {
    x: number;
    y: number;
    worldX: number;
    worldY: number;
    touch: boolean;
    id: number;
  } | null = null;
  private dragging = false;
  private userMoved = false;
  /** Acumula a roda do mouse para trackpads não pularem vários níveis de uma vez. */
  private wheelAccum = 0;
  private readonly tapListeners: ((global: Point, info: TapInfo) => void)[] = [];
  private readonly pinchListeners: (() => void)[] = [];
  private readonly longPressListeners: ((global: Point) => void)[] = [];
  private longPressTimer = 0;
  /** O gesto atual já virou "segurar": soltar não conta como toque. */
  private longPressed = false;
  private insets: CameraInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Dedos na tela (pinça): id → posição. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchBase = 0;
  /** Durante e logo após a pinça nada vira toque nem arrasto até todos os dedos saírem. */
  private pinching = false;
  /** Se devolver true no pointerdown, a câmera ignora o gesto (ex.: arrastar um móvel). */
  private pointerGuard: ((e: FederatedPointerEvent) => boolean) | null = null;
  /** Se devolver true, a roda não dá zoom (ex.: Shift + roda ajusta a altura no Decorar). */
  private wheelGuard: ((e: WheelEvent) => boolean) | null = null;

  constructor(
    private readonly app: Application,
    private readonly world: Container,
    /** Retângulo da sala (em coordenadas do mundo) para enquadrar; padrão: tudo do mundo. */
    private readonly contentBounds: () => {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    } = () => world.getLocalBounds(),
  ) {
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;
    stage.on('pointerdown', this.onDown, this);
    stage.on('globalpointermove', this.onMove, this);
    stage.on('pointerup', this.onUp, this);
    stage.on('pointerupoutside', this.reset, this);
    app.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    app.canvas.addEventListener('pointerdown', this.handleTouchDown);
    window.addEventListener('pointermove', this.handleTouchMove);
    window.addEventListener('pointerup', this.handleTouchUp);
    window.addEventListener('pointercancel', this.handleTouchUp);
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
    this.app.canvas.removeEventListener('pointerdown', this.handleTouchDown);
    window.removeEventListener('pointermove', this.handleTouchMove);
    window.removeEventListener('pointerup', this.handleTouchUp);
    window.removeEventListener('pointercancel', this.handleTouchUp);
    this.app.renderer.off('resize', this.onResize, this);
    this.tapListeners.length = 0;
    this.pinchListeners.length = 0;
  }

  private readonly handleWheel = (e: WheelEvent) => this.onWheel(e);

  private onResize(): void {
    if (!this.userMoved) this.center();
  }

  get zoom(): number {
    return this.zoomValue;
  }

  setPointerGuard(guard: ((e: FederatedPointerEvent) => boolean) | null): void {
    this.pointerGuard = guard;
  }

  setWheelGuard(guard: ((e: WheelEvent) => boolean) | null): void {
    this.wheelGuard = guard;
  }

  onTap(listener: (global: Point, info: TapInfo) => void): void {
    this.tapListeners.push(listener);
  }

  /** O segundo dedo encostou (começou a pinça). */
  onPinchStart(listener: () => void): void {
    this.pinchListeners.push(listener);
  }

  /** Segurar o dedo (ou o botão) parado num ponto. */
  onLongPress(listener: (global: Point) => void): void {
    this.longPressListeners.push(listener);
  }

  /** Faixas cobertas pela interface; se a pessoa não mexeu na câmera, reenquadra. */
  setInsets(insets: CameraInsets): void {
    const i = this.insets;
    if (
      i.top === insets.top &&
      i.right === insets.right &&
      i.bottom === insets.bottom &&
      i.left === insets.left
    ) {
      return;
    }
    this.insets = { ...insets };
    if (!this.userMoved && !this.userZoomed) this.center();
  }

  /** Área livre da tela (sem a interface por cima). */
  private area() {
    const { width, height } = this.app.screen;
    const i = this.insets;
    // Em telas estreitas a interface cobriria quase tudo: aí usa a tela inteira.
    const useInsets = width - i.left - i.right >= width * 0.5;
    const left = useInsets ? i.left : 0;
    const right = useInsets ? i.right : 0;
    const top = height - i.top - i.bottom >= height * 0.5 ? i.top : 0;
    const bottom = top ? i.bottom : 0;
    return { x: left, y: top, w: width - left - right, h: height - top - bottom };
  }

  /** Enquadra a sala inteira na área livre (com o maior zoom que couber) e volta ao automático. */
  fit(): void {
    this.userZoomed = false;
    this.center();
  }

  /** Centraliza o conteúdo do mundo na área livre. */
  center(): void {
    const b = this.contentBounds();
    const a = this.area();
    if (!this.userZoomed && b.maxX > b.minX) {
      this.zoomValue = fitZoom(b.maxX - b.minX, b.maxY - b.minY, a.w, a.h);
    }
    this.world.scale.set(this.zoom);
    this.lookAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    this.userMoved = false;
  }

  /** Põe o ponto do mundo (`x`, `y`, em coordenadas da cena) no meio da área livre. */
  lookAt(x: number, y: number): void {
    const a = this.area();
    this.world.position.set(
      Math.round(a.x + a.w / 2 - x * this.zoom),
      Math.round(a.y + a.h / 2 - y * this.zoom),
    );
  }

  /** Centraliza num ponto do mundo (ex.: o próprio avatar); se estiver longe, aproxima até 1×. */
  focusOn(x: number, y: number): void {
    if (this.zoom < 1) {
      this.userZoomed = true;
      this.zoomValue = DEFAULT_ZOOM;
      this.world.scale.set(this.zoom);
    }
    this.lookAt(x, y);
    this.userMoved = true;
  }

  zoomIn(): void {
    this.userZoomed = true;
    this.step(1);
  }

  zoomOut(): void {
    this.userZoomed = true;
    this.step(-1);
  }

  /** Vai para o nível vizinho (`dir` = +1 aproxima, −1 afasta) mantendo fixo o ponto `focus`. */
  private step(dir: 1 | -1, focus?: { x: number; y: number }): void {
    const z = this.zoomValue;
    const next =
      dir > 0
        ? ZOOM_LEVELS.find((l) => l > z + 0.001)
        : [...ZOOM_LEVELS].reverse().find((l) => l < z - 0.001);
    if (next === undefined) return;
    const f = focus ?? { x: this.app.screen.width / 2, y: this.app.screen.height / 2 };
    const wx = (f.x - this.world.x) / z;
    const wy = (f.y - this.world.y) / z;
    this.zoomValue = next;
    this.world.scale.set(next);
    this.world.position.set(Math.round(f.x - wx * next), Math.round(f.y - wy * next));
  }

  private onDown(e: FederatedPointerEvent): void {
    if (this.pinching) return;
    // Só o botão principal: o direito (menu de contexto) perdia o "soltar" e a câmera seguia o
    // mouse sozinha.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.pointerGuard?.(e)) {
      this.reset();
      return;
    }
    this.pointerDown = {
      x: e.global.x,
      y: e.global.y,
      worldX: this.world.x,
      worldY: this.world.y,
      touch: e.pointerType === 'touch',
      id: e.pointerId,
    };
    this.dragging = false;
    this.longPressed = false;
    clearTimeout(this.longPressTimer);
    if (this.longPressListeners.length) {
      const at = e.global.clone();
      this.longPressTimer = window.setTimeout(() => {
        if (!this.pointerDown || this.dragging || this.pinching) return;
        this.longPressed = true;
        for (const l of this.longPressListeners) l(at);
      }, LONG_PRESS_MS);
    }
  }

  private onMove(e: FederatedPointerEvent): void {
    const d = this.pointerDown;
    if (!d || this.pinching) return;
    // O "soltar" se perdeu (menu de contexto, janela trocada): solta agora.
    if (!d.touch && e.buttons === 0) return this.reset();
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (!this.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      this.dragging = true;
      clearTimeout(this.longPressTimer);
    }
    if (this.dragging) {
      this.world.position.set(Math.round(d.worldX + dx), Math.round(d.worldY + dy));
      this.userMoved = true;
    }
  }

  private onUp(e: FederatedPointerEvent): void {
    const d = this.pointerDown;
    const wasTap = d && !this.dragging && !this.pinching && !this.longPressed;
    this.reset();
    if (wasTap) for (const l of this.tapListeners) l(e.global, { touch: d.touch, id: d.id });
  }

  private reset(): void {
    clearTimeout(this.longPressTimer);
    this.pointerDown = null;
    this.dragging = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.wheelGuard?.(e)) return;
    this.wheelAccum += e.deltaY;
    if (Math.abs(this.wheelAccum) < 60) return;
    const rect = this.app.canvas.getBoundingClientRect();
    const focus = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.userZoomed = true;
    this.step(this.wheelAccum < 0 ? 1 : -1, focus);
    this.wheelAccum = 0;
    this.userMoved = true;
  }

  // ---------- Pinça (dois dedos) ----------

  private readonly handleTouchDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      this.pinching = true;
      this.pinchBase = this.touchDistance();
      this.reset();
      for (const l of this.pinchListeners) l();
    }
  };

  private readonly handleTouchMove = (e: PointerEvent) => {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size !== 2 || !this.pinchBase) return;
    const ratio = this.touchDistance() / this.pinchBase;
    if (ratio < PINCH_STEP && ratio > 1 / PINCH_STEP) return;
    const [p, q] = [...this.touches.values()];
    const rect = this.app.canvas.getBoundingClientRect();
    const focus = { x: (p!.x + q!.x) / 2 - rect.left, y: (p!.y + q!.y) / 2 - rect.top };
    this.userZoomed = true;
    this.userMoved = true;
    this.step(ratio > 1 ? 1 : -1, focus);
    this.pinchBase = this.touchDistance();
  };

  private readonly handleTouchUp = (e: PointerEvent) => {
    if (!this.touches.delete(e.pointerId)) return;
    this.pinchBase = 0;
    if (this.touches.size === 0) this.pinching = false;
  };

  private touchDistance(): number {
    const [p, q] = [...this.touches.values()];
    return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : 0;
  }
}
