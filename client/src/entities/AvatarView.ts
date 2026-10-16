import {
  directionBetween,
  STEP_MS,
  tileToScreen,
  type DepthBox,
  type TilePoint,
} from '@office/shared';
import { Container, Graphics, Sprite } from 'pixi.js';
import type { AvatarFrames } from '../assets/AvatarTextureCache.js';

/** Deslocamento vertical (px) por quarto de passo: o "bob" da caminhada procedural. */
const BOB_Y = [0, -1, -2, -1];

interface Step {
  from: TilePoint;
  to: TilePoint;
  elapsed: number;
}

/**
 * Avatar na cena. A posição lógica é sempre um tile; durante um passo, a posição de tela
 * é interpolada entre o tile atual e o próximo. A animação de caminhada é procedural
 * (o imager só tem a pose parada): bob vertical + leve balanço lateral alternado.
 */
export class AvatarView extends Container {
  tile: TilePoint;
  dir: number;
  private frames: AvatarFrames | null = null;
  private readonly body = new Sprite();
  private readonly shadow = new Graphics();
  private step: Step | null = null;
  private path: TilePoint[] = [];
  private walkTime = 0;
  private stepCount = 0;

  constructor(
    readonly avatarId: string,
    start: TilePoint,
    dir: number,
    private readonly heightAt: (x: number, y: number) => number,
  ) {
    super();
    this.label = `avatar:${avatarId}`;
    this.tile = { x: start.x, y: start.y };
    this.dir = dir;
    this.shadow.ellipse(0, 0, 14, 6).fill({ color: 0x000000, alpha: 0.22 });
    this.addChild(this.shadow, this.body);
    this.applyPosition();
  }

  setFrames(frames: AvatarFrames): void {
    this.frames = frames;
    this.applyFrame();
  }

  /** Tile de onde um novo caminho deve partir (o passo em andamento sempre termina). */
  get nextTile(): TilePoint {
    return this.step ? this.step.to : this.tile;
  }

  get isWalking(): boolean {
    return this.step !== null || this.path.length > 0;
  }

  /** Substitui o caminho pendente. `path` começa no tile seguinte a `nextTile`. */
  walk(path: TilePoint[]): void {
    this.path = [...path];
    if (!this.step) this.startNextStep();
  }

  update(dtMs: number): void {
    let remaining = dtMs;
    while (this.step && remaining > 0) {
      const left = STEP_MS - this.step.elapsed;
      const used = Math.min(left, remaining);
      this.step.elapsed += used;
      remaining -= used;
      if (this.step.elapsed >= STEP_MS) {
        this.tile = this.step.to;
        this.step = null;
        this.stepCount++;
        this.startNextStep();
      }
    }
    this.walkTime = this.step ? this.walkTime + dtMs : 0;
    this.applyPosition();
  }

  /** Caixa para a ordenação de profundidade: andando, ocupa o tile atual e o próximo. */
  get depthBox(): DepthBox {
    const a = this.tile;
    const b = this.step?.to ?? a;
    return {
      id: this.avatarId,
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxY: Math.max(a.y, b.y),
      z: Math.max(this.heightAt(a.x, a.y), this.heightAt(b.x, b.y)),
    };
  }

  private startNextStep(): void {
    const next = this.path.shift();
    if (!next) return;
    this.step = { from: this.tile, to: next, elapsed: 0 };
    this.dir = directionBetween(this.tile, next, this.dir);
    this.applyFrame();
  }

  private applyFrame(): void {
    const frame = this.frames?.[this.dir];
    if (!frame) return;
    this.body.texture = frame.texture;
    this.body.anchor.set(
      frame.anchor.x / frame.texture.width,
      frame.anchor.y / frame.texture.height,
    );
  }

  private applyPosition(): void {
    let x = this.tile.x;
    let y = this.tile.y;
    let z = this.heightAt(x, y);
    if (this.step) {
      const t = this.step.elapsed / STEP_MS;
      const { from, to } = this.step;
      x = from.x + (to.x - from.x) * t;
      y = from.y + (to.y - from.y) * t;
      z = this.heightAt(from.x, from.y) * (1 - t) + this.heightAt(to.x, to.y) * t;
    }
    const p = tileToScreen(x, y, z);
    this.position.set(Math.round(p.sx), Math.round(p.sy));

    if (this.step) {
      const quarter = Math.floor((this.walkTime / STEP_MS) * 4) % 4;
      const sway = quarter === 2 ? (this.stepCount % 2 === 0 ? 1 : -1) : 0;
      this.body.position.set(sway, BOB_Y[quarter]!);
    } else {
      this.body.position.set(0, 0);
    }
  }
}
