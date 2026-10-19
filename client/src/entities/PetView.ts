import {
  directionBetween,
  furniSprites,
  FURNI_FPS,
  habboPetType,
  petPosture,
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
import type { FurniVisualLibrary, LoadedFurniVisual } from '../assets/FurniVisualLibrary.js';

/** Pet do Habbo sem internet: a arte própria mais parecida. */
const FALLBACK_SPECIES: Record<string, PetSpecies> = {
  cat: 'cat',
  kittenbaby: 'cat',
  lion: 'cat',
  bunnyeaster: 'bunny',
  bunnyevil: 'bunny',
  bunnydepressed: 'bunny',
  bunnylove: 'bunny',
  chicken: 'chick',
  pigeongood: 'chick',
  pigeonevil: 'chick',
};
/** Gesto (carinha) por alguns segundos quando o pet obedece. */
const GESTURE_MS = 2500;

/** O que a cena sabe de um pet do estado sincronizado. */
export interface PetSnapshot {
  name: string;
  ownerName: string;
  species: string;
  color: number;
  /** Pets do Habbo: cor que tinge a paleta (hex). */
  tint?: string;
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
  /** Pet do Habbo por camadas (Fase 38). */
  private habbo: {
    key: string;
    lib: LoadedFurniVisual | null;
    layer: Container;
    sprites: Sprite[];
  } | null = null;
  private petTint = 0xffffff;
  private animKey = '';
  private animStart = 0;
  private gesture: { name: string; until: number } | null = null;

  constructor(
    readonly petId: string,
    snapshot: PetSnapshot,
    private readonly heightAt: (x: number, y: number) => number,
    private readonly visuals?: FurniVisualLibrary,
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
    if (this.habbo?.lib)
      return this.habbo.sprites.some((sp) => sp.visible && spriteHitTest(sp, global));
    return spriteHitTest(this.sprite, global);
  }

  setNameVisible(on: boolean): void {
    this.nameTag.visible = on;
  }

  applySnapshot(s: PetSnapshot): void {
    const habboType = habboPetType(s.species);
    this.species = (PET_SPECIES as readonly string[]).includes(s.species)
      ? (s.species as PetSpecies)
      : (FALLBACK_SPECIES[habboType ?? ''] ?? 'dog');
    this.color = habboType ? 0 : s.color;
    // Obedeceu (sentou/deitou): uma carinha feliz por alguns segundos.
    if (s.action !== this.action && (s.action === 'sit' || s.action === 'lie')) {
      this.gesture = { name: 'sml', until: performance.now() + GESTURE_MS };
    }
    this.action = s.action;
    this.petTint = parseInt(s.tint || 'ffffff', 16) || 0xffffff;
    if (habboType) this.useHabbo(habboType, s.color);
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

  /** Carrega o pet do Habbo (tipo + paleta); até chegar, fica a arte própria. */
  private useHabbo(type: string, palette: number): void {
    const key = `${type}:${palette}`;
    if (!this.visuals || this.habbo?.key === key) return;
    this.habbo?.layer.destroy({ children: true });
    const layer = new Container();
    this.addChildAt(layer, 1);
    const entry = { key, lib: null as LoadedFurniVisual | null, layer, sprites: [] as Sprite[] };
    this.habbo = entry;
    void this.visuals.loadPet(type, palette).then((lib) => {
      if (this.destroyed || this.habbo !== entry || !lib) return;
      entry.lib = lib;
      this.applyFrame();
    });
  }

  /** Desenha o pet do Habbo: postura da ação (andando = `mv`) e o gesto na cabeça. */
  private drawHabbo(lib: LoadedFurniVisual): void {
    const v = lib.visual;
    const postures = v.postures ?? { std: 0 };
    const posture = petPosture(this.action, Boolean(this.step), postures);
    const anim = postures[posture] ?? 0;
    const now = performance.now();
    if (this.gesture && now > this.gesture.until) this.gesture = null;
    const gesture = this.gesture ? v.gestures?.[this.gesture.name] : undefined;
    const key = `${posture}:${this.dir}:${gesture ?? ''}`;
    if (key !== this.animKey) {
      this.animKey = key;
      this.animStart = now;
    }
    const tick = Math.floor(((now - this.animStart) * FURNI_FPS) / 1000);
    const list = furniSprites(v, this.dir, anim, tick, undefined, gesture);
    const h = this.habbo!;
    while (h.sprites.length < list.length) {
      const sp = new Sprite();
      h.layer.addChild(sp);
      h.sprites.push(sp);
    }
    h.sprites.forEach((sp, i) => {
      const s = list[i];
      sp.visible = Boolean(s);
      if (!s) return;
      const tex = lib.textures.get(s.image)!;
      sp.texture = tex;
      sp.scale.x = s.flip ? -1 : 1;
      // Origem do Habbo: vértice de cima do tile (o container fica no centro do tile).
      sp.position.set(s.x + (s.flip ? tex.width : 0), s.y - 16);
      sp.alpha = s.alpha / 255;
      sp.blendMode = s.ink === 33 ? 'add' : 'normal';
      sp.tint = s.palette ? this.petTint : 0xffffff;
    });
  }

  private applyFrame(): void {
    const lib = this.habbo?.lib;
    this.sprite.visible = !lib;
    this.shadow.visible = !lib;
    if (lib) return this.drawHabbo(lib);
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
    if (this.habbo?.lib) {
      this.habbo.layer.position.set(0, 0);
      return;
    }
    const quarter = Math.floor((this.walkTime / STEP_MS) * 4) % 4;
    this.sprite.position.set(0, this.step ? HOP_Y[quarter]! * 2 + 3 : 3);
  }
}
