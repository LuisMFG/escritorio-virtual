import {
  directionBetween,
  PET_SPECIES,
  STEP_MS,
  tileToScreen,
  type DepthBox,
  type PetSpecies,
  type TilePoint,
} from '@office/shared';
import { Container, Graphics, Sprite, Text, type Point } from 'pixi.js';
import { spriteHitTest } from '../assets/hitTest.js';
import { petTexture, type PetPose } from '../assets/petArt.js';

/** O que a cena sabe de um pet do estado sincronizado. */
export interface PetSnapshot {
  name: string;
  ownerName: string;
  species: string;
  color: number;
  x: number;
  y: number;
  nextX: number;
  nextY: number;
  dir: number;
  /** 'idle' | 'walk' | 'sit' | 'lie' */
  action: string;
}

interface Step {
  from: TilePoint;
  to: TilePoint;
  elapsed: number;
}

const CATCH_UP_SPEED = 1.5;
/** Pulinho da caminhada (px) a cada meio passo. */
const HOP_Y = [0, -1, 0, -1];

/**
 * Pet na sala. Mesma interpolação de passos do avatar (o servidor manda `nextX/nextY` no
 * começo de cada passo); a arte é de perfil e vira para a esquerda nas direções 4–7.
 */
export class PetView extends Container {
  private readonly sprite = new Sprite();
  private readonly shadow = new Graphics();
  private readonly nameTag: Text;
  private tile: TilePoint;
  private dir: number;
  private step: Step | null = null;
  private readonly queue: TilePoint[] = [];
  private walkTime = 0;
  private species: PetSpecies = 'dog';
  private color = 0;
  private action = 'idle';
  private pose: PetPose | '' = '';

  constructor(
    readonly petId: string,
    snapshot: PetSnapshot,
    private readonly heightAt: (x: number, y: number) => number,
  ) {
    super();
    this.label = `pet:${petId}`;
    this.tile = { x: snapshot.x, y: snapshot.y };
    this.dir = snapshot.dir;
    this.shadow.ellipse(0, 0, 15, 5).fill({ color: 0x000000, alpha: 0.2 });
    this.sprite.anchor.set(0.5, 1);
    this.nameTag = new Text({
      text: '',
      resolution: 2,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 10,
        fontWeight: '600',
        fill: 0xffffff,
        stroke: { color: 0x101114, width: 3 },
      },
    });
    this.nameTag.anchor.set(0.5, 1);
    this.nameTag.position.set(0, -46);
    this.nameTag.visible = false;
    this.addChild(this.shadow, this.sprite, this.nameTag);
    this.applySnapshot(snapshot);
    this.applyPosition();
  }

  hitTest(global: Point): boolean {
    return spriteHitTest(this.sprite, global);
  }

  setNameVisible(on: boolean): void {
    this.nameTag.visible = on;
  }

  applySnapshot(s: PetSnapshot): void {
    this.species = (PET_SPECIES as readonly string[]).includes(s.species)
      ? (s.species as PetSpecies)
      : 'dog';
    this.color = s.color;
    this.action = s.action;
    this.nameTag.text = `${s.name} · pet de ${s.ownerName}`;
    const target = { x: s.nextX, y: s.nextY };
    const last = this.queue.at(-1) ?? this.step?.to ?? this.tile;
    if (target.x !== last.x || target.y !== last.y) {
      if (Math.max(Math.abs(target.x - last.x), Math.abs(target.y - last.y)) === 1) {
        this.queue.push(target);
        if (!this.step) this.startNextStep();
      } else {
        // Fora de sincronia (entrou agora, sala mudou): pula para o tile do servidor.
        this.queue.length = 0;
        this.step = null;
        this.tile = { x: s.x, y: s.y };
        if (s.nextX !== s.x || s.nextY !== s.y) this.queue.push(target);
        this.startNextStep();
      }
    } else if (!this.step && this.queue.length === 0) {
      this.dir = s.dir;
    }
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
        this.startNextStep();
      }
    }
    this.walkTime = this.step ? this.walkTime + dtMs * speed : 0;
    this.applyFrame();
    this.applyPosition();
  }

  get depthBox(): DepthBox {
    const a = this.tile;
    const b = this.step?.to ?? a;
    return {
      id: this.label,
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
  }

  private applyFrame(): void {
    let pose: PetPose;
    if (this.step) pose = Math.floor(this.walkTime / (STEP_MS / 2)) % 2 === 0 ? 'walkA' : 'walkB';
    else if (this.action === 'sit') pose = 'sit';
    else if (this.action === 'lie') pose = 'lie';
    else pose = 'stand';
    const key = `${this.species}:${this.color}:${pose}`;
    if (key !== this.pose) {
      this.pose = key as PetPose;
      this.sprite.texture = petTexture(this.species, this.color, pose);
    }
    // Arte virada para a direita; direções 4–7 olham para a esquerda da tela.
    this.sprite.scale.x = this.dir >= 4 ? -1 : 1;
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
    const quarter = Math.floor((this.walkTime / STEP_MS) * 4) % 4;
    this.sprite.position.set(0, this.step ? HOP_Y[quarter]! * 2 + 3 : 3);
  }
}
