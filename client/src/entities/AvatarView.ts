import {
  directionBetween,
  STEP_MS,
  tileToScreen,
  type DepthBox,
  type TilePoint,
} from '@office/shared';
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { AvatarFrames } from '../assets/AvatarTextureCache.js';

/** Deslocamento vertical (px) por quarto de passo: o "bob" da caminhada procedural. */
const BOB_Y = [0, -1, -2, -1];
/** Com passos acumulados (atraso de rede), anda um pouco mais rápido para alcançar o servidor. */
const CATCH_UP_SPEED = 1.5;
/** Altura do nome acima dos pés. */
const NAME_Y = -88;

/** O que a cena sabe de um jogador do estado sincronizado. */
export interface AvatarSnapshot {
  name: string;
  figure: string;
  x: number;
  y: number;
  nextX: number;
  nextY: number;
  dir: number;
  away: boolean;
}

interface Step {
  from: TilePoint;
  to: TilePoint;
  elapsed: number;
}

/**
 * Avatar na cena, dirigido pelo servidor. A cada passo o servidor publica o próximo tile
 * (`nextX/nextY`); a view enfileira o passo e interpola em `STEP_MS`. Se a posição recebida
 * não for vizinha da atual (entrada na sala, atraso grande), teleporta.
 * A animação de caminhada é procedural (o imager só tem a pose parada): bob vertical
 * e leve balanço lateral alternado.
 */
export class AvatarView extends Container {
  tile: TilePoint;
  dir: number;
  /** Figure das texturas atuais (para recarregar quando a pessoa troca de visual). */
  figure: string;
  private frames: AvatarFrames | null = null;
  private readonly body = new Sprite();
  private readonly shadow = new Graphics();
  private readonly nameTag: Text;
  private step: Step | null = null;
  private readonly queue: TilePoint[] = [];
  private walkTime = 0;
  private stepCount = 0;

  constructor(
    readonly avatarId: string,
    snapshot: AvatarSnapshot,
    readonly isLocal: boolean,
    private readonly heightAt: (x: number, y: number) => number,
  ) {
    super();
    this.label = `avatar:${avatarId}`;
    this.tile = { x: snapshot.x, y: snapshot.y };
    this.dir = snapshot.dir;
    this.figure = snapshot.figure;
    this.shadow.ellipse(0, 0, 14, 6).fill({ color: 0x000000, alpha: 0.22 });
    this.nameTag = new Text({
      text: snapshot.name,
      resolution: 2,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        fontWeight: isLocal ? '700' : '500',
        fill: isLocal ? 0xffe28a : 0xffffff,
        stroke: { color: 0x101114, width: 3 },
      },
    });
    this.nameTag.anchor.set(0.5, 1);
    this.nameTag.position.set(0, NAME_Y);
    this.addChild(this.shadow, this.body, this.nameTag);
    this.applySnapshot(snapshot);
    this.applyPosition();
  }

  setFrames(frames: AvatarFrames): void {
    this.frames = frames;
    this.applyFrame();
  }

  get isWalking(): boolean {
    return this.step !== null || this.queue.length > 0;
  }

  /** Aplica um estado novo vindo do servidor. */
  applySnapshot(s: AvatarSnapshot): void {
    this.nameTag.text = s.name;
    this.alpha = s.away ? 0.45 : 1;

    const target = { x: s.nextX, y: s.nextY };
    const last = this.queue.at(-1) ?? this.step?.to ?? this.tile;
    if (target.x === last.x && target.y === last.y) {
      if (!this.isWalking && s.dir !== this.dir) {
        this.dir = s.dir;
        this.applyFrame();
      }
      return;
    }
    if (Math.max(Math.abs(target.x - last.x), Math.abs(target.y - last.y)) === 1) {
      this.queue.push(target);
      if (!this.step) this.startNextStep();
      return;
    }
    // Fora de sincronia: teleporta para o tile atual do servidor e segue dali.
    this.queue.length = 0;
    this.step = null;
    this.tile = { x: s.x, y: s.y };
    this.dir = s.dir;
    if (s.nextX !== s.x || s.nextY !== s.y) this.queue.push(target);
    this.startNextStep();
    this.applyFrame();
    this.applyPosition();
  }

  update(dtMs: number): void {
    const speed = this.queue.length > 0 ? CATCH_UP_SPEED : 1;
    let remaining = dtMs * speed;
    while (this.step && remaining > 0) {
      const used = Math.min(STEP_MS - this.step.elapsed, remaining);
      this.step.elapsed += used;
      remaining -= used;
      if (this.step.elapsed >= STEP_MS) {
        this.tile = this.step.to;
        this.step = null;
        this.stepCount++;
        this.startNextStep();
      }
    }
    this.walkTime = this.step ? this.walkTime + dtMs * speed : 0;
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
    const next = this.queue.shift();
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
