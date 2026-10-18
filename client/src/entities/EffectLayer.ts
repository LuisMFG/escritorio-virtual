import { EFFECT_FPS, type EffectId, EFFECTS, STAND_CANVAS } from '@office/shared';
import { Container, Sprite } from 'pixi.js';
import type { EffectLibrary, LoadedEffect } from '../assets/EffectLibrary.js';
import { IMAGER_AVATAR_FEET } from '../config.js';

/**
 * Efeito do Habbo tocando sobre um avatar: camadas atrás e na frente do corpo, com brilho
 * aditivo onde o efeito pede. O efeito em uso fica sempre; uma comemoração passa por cima
 * por alguns segundos.
 */
export class EffectLayer {
  readonly back = new Container();
  readonly front = new Container();
  private worn: EffectId | null = null;
  private flash: { id: EffectId; until: number } | null = null;
  private showing: EffectId | null = null;
  private loaded: LoadedEffect | null = null;
  private sprites = new Map<string, Sprite>();
  private clock = 0;
  private token = 0;

  constructor(private readonly library: EffectLibrary) {}

  setWorn(id: EffectId | null): void {
    this.worn = id;
  }

  flashFor(id: EffectId, ms: number): void {
    this.flash = { id, until: this.clock + ms };
  }

  update(dtMs: number, dir: number): void {
    this.clock += dtMs;
    if (this.flash && this.clock >= this.flash.until) this.flash = null;
    const want = this.flash?.id ?? this.worn;
    if (want !== this.showing) this.show(want);
    if (this.loaded) this.draw(dir);
  }

  private show(id: EffectId | null): void {
    this.showing = id;
    this.loaded = null;
    this.clear();
    if (!id) return;
    const token = ++this.token;
    void this.library.load(EFFECTS[id].lib).then((fx) => {
      if (token !== this.token || !fx) return;
      this.loaded = fx;
      for (const s of fx.sheet.animation.sprites) {
        const sprite = new Sprite();
        if (s.ink === 33) sprite.blendMode = 'add';
        this.sprites.set(s.id, sprite);
      }
    });
  }

  private clear(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
  }

  /** Quadro atual de cada camada, na direção do avatar (sem desenho: espelho ou direção 0). */
  private draw(dir: number): void {
    const { sheet, textures } = this.loaded!;
    const anim = sheet.animation;
    const frames = anim.frames;
    const tick = Math.floor((this.clock * EFFECT_FPS) / 1000);
    const layers = frames.length
      ? frames[tick % frames.length]!
      : anim.sprites.map((s) => ({ id: s.id, frame: 0, dx: 0, dy: 0 }));
    const visible = new Set<string>();
    for (const layer of layers) {
      const def = anim.sprites.find((s) => s.id === layer.id);
      const sprite = this.sprites.get(layer.id);
      if (!def || !sprite) continue;
      const mirrored = dir >= 4 && dir <= 6 ? 6 - dir : dir;
      const tries: [number, boolean][] = [
        [dir, false],
        [mirrored, mirrored !== dir],
        [0, false],
      ];
      let hit: { name: string; flip: boolean } | null = null;
      for (const [d, flip] of tries) {
        const name = `h_${def.member}_${d}_${layer.frame}`;
        if (sheet.assets[name] && textures.has(name)) {
          hit = { name, flip };
          break;
        }
      }
      if (!hit) continue;
      const asset = sheet.assets[hit.name]!;
      const tex = textures.get(hit.name)!;
      sprite.texture = tex;
      // Mesmo registro das partes do avatar (quadro 64×110, pés em IMAGER_AVATAR_FEET).
      const left = STAND_CANVAS.regX - asset.x + layer.dx;
      const top = STAND_CANVAS.regY - asset.y + layer.dy;
      sprite.scale.x = hit.flip ? -1 : 1;
      sprite.position.set(
        (hit.flip ? STAND_CANVAS.width - left : left) - IMAGER_AVATAR_FEET.x,
        top - IMAGER_AVATAR_FEET.y,
      );
      const behind = (def.dz[String(dir)] ?? def.dz['0'] ?? 0) < 0;
      const parent = behind ? this.back : this.front;
      if (sprite.parent !== parent) parent.addChild(sprite);
      visible.add(layer.id);
    }
    for (const [id, s] of this.sprites) s.visible = visible.has(id);
  }
}
