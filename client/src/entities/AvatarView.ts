import {
  BLINK_MS,
  directionBetween,
  emotePose,
  EMOTES,
  nextBlinkDelay,
  poseKey,
  TALK_FRAME_MS,
  walkFrame,
  type FigurePose,
  focusLeft,
  STEP_MS,
  type EmoteId,
  tileToScreen,
  type DepthBox,
  type TilePoint,
} from '@office/shared';
import { Container, Graphics, Sprite, Text, type Point } from 'pixi.js';
import type { AvatarFrame, AvatarFrames, AvatarPoser } from '../assets/AvatarTextureCache.js';
import { spriteHitTest } from '../assets/hitTest.js';

/** Deslocamento vertical (px) por quarto de passo: o "bob" da caminhada procedural. */
const BOB_Y = [0, -1, -2, -1];
/** Com passos acumulados (atraso de rede), anda um pouco mais rápido para alcançar o servidor. */
const CATCH_UP_SPEED = 1.5;
/** Altura do nome acima dos pés. */
const NAME_Y = -88;
/** Com cargo, o nome sobe uma linha e o cargo fica logo acima da cabeça. */
const CARGO_LINE = 12;
/** Pose sentada simulada (o imager não tem): desce o corpo e esconde as pernas abaixo do assento. */
const SIT_DROP = 8;
/** Com a pose sentada real, quanto o desenho desce para assentar no móvel. */
const SIT_OFFSET = 0;
const SIT_CUT_Y = -2;
/** Altura do "…" de digitando e do emoji dos emotes. */
const TYPING_Y = -96;
const EMOJI_Y = -100;
const STATUS_COLORS: Record<string, number> = { busy: 0xe05555, away: 0xf2c94c };
/** Direções percorridas na dança. */
const DANCE_DIRS = [2, 3, 4, 5, 6, 5, 4, 3];

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
  /** 'idle' | 'walk' | 'sit' | 'lay' */
  action: string;
  /** Altura em que o servidor colocou o avatar (assento quando sentado). */
  z: number;
  /** 'available' | 'busy' | 'away' */
  status: string;
  typing: boolean;
  /** Cargo e cor da etiqueta (`#rrggbb`); vazio = sem cargo. */
  cargo: string;
  cargoColor: string;
  /** Faz aniversário hoje. */
  birthday: boolean;
  /** Modo foco: fim da fase (epoch ms; 0 = fora) e qual fase. */
  focusUntil: number;
  focusKind: string;
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
  /** Avatar montado (Fase 32): pose real a cada quadro. Sem ele, animação simulada. */
  private poser: AvatarPoser | null = null;
  private poseShown = '';
  private talkUntil = 0;
  private blinkAt = nextBlinkDelay();
  private lying = false;
  /** "zZ" sobre a cabeça de quem está ausente (olhos fechados). */
  private readonly sleep: Text;
  private readonly body = new Sprite();
  private readonly shadow = new Graphics();
  private readonly nameTag: Text;
  private readonly cargoTag: Text;
  private readonly cake: Text;
  /** "🍅 12m" / "☕ 3m" sobre a cabeça durante o foco. */
  private readonly focusTag: Text;
  private focusUntil = 0;
  private focusKind = '';
  private readonly legMask = new Graphics();
  private readonly statusBadge = new Graphics();
  private readonly typingBubble = new Container();
  private readonly typingDots: Graphics[] = [];
  private sitting = false;
  private sitZ = 0;
  private nameVisible = false;
  private emote: { id: EmoteId; elapsed: number; baseDir: number; emoji: Text } | null = null;
  private clock = 0;
  displayName: string;
  status = 'available';
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
    this.displayName = snapshot.name;
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
    this.nameTag.visible = false;
    this.cargoTag = new Text({
      text: '',
      resolution: 2,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 9,
        fontWeight: '600',
        fill: 0xffffff,
        stroke: { color: 0x101114, width: 3 },
      },
    });
    this.cargoTag.anchor.set(0.5, 1);
    this.cargoTag.position.set(0, NAME_Y);
    this.cargoTag.visible = false;
    this.cake = new Text({ text: '🎂', resolution: 2, style: { fontSize: 12 } });
    this.cake.anchor.set(0.5, 1);
    this.cake.position.set(-14, -76);
    this.cake.visible = false;
    this.focusTag = new Text({
      text: '',
      resolution: 2,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 10,
        fontWeight: '700',
        fill: 0xffffff,
        stroke: { color: 0x7f1d1d, width: 3 },
      },
    });
    this.focusTag.anchor.set(0.5, 1);
    this.focusTag.position.set(16, -76);
    this.focusTag.visible = false;
    this.sleep = new Text({
      text: 'z',
      resolution: 2,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        fontWeight: '700',
        fill: 0xdbe7ff,
        stroke: { color: 0x101114, width: 3 },
      },
    });
    this.sleep.anchor.set(0, 1);
    this.sleep.visible = false;
    this.legMask.rect(-60, -220, 120, 220 + SIT_CUT_Y).fill(0xffffff);
    this.legMask.visible = false;
    this.statusBadge.visible = false;

    // "…" de digitando: balãozinho com três pontos que piscam em sequência.
    const bg = new Graphics()
      .roundRect(-13, -8, 26, 14, 6)
      .fill(0xfdfdf7)
      .stroke({ width: 1, color: 0x2a2d36 });
    this.typingBubble.addChild(bg);
    for (let i = 0; i < 3; i++) {
      const dot = new Graphics().circle(-6 + i * 6, -1, 2).fill(0x2a2d36);
      this.typingDots.push(dot);
      this.typingBubble.addChild(dot);
    }
    this.typingBubble.visible = false;
    this.typingBubble.position.set(0, TYPING_Y);

    this.addChild(
      this.shadow,
      this.body,
      this.legMask,
      this.statusBadge,
      this.cake,
      this.focusTag,
      this.sleep,
      this.typingBubble,
      this.cargoTag,
      this.nameTag,
    );
    this.applySnapshot(snapshot);
    this.applyPosition();
  }

  setFrames(frames: AvatarFrames): void {
    this.frames = frames;
    this.applyFrame();
  }

  /** Avatar montado: daqui em diante as poses são reais (andar, sentar, gestos, rosto). */
  setPoser(poser: AvatarPoser | null): void {
    this.poser = poser;
    this.poseShown = '';
    this.setSitting(this.sitting, this.sitZ);
    this.applyFrame();
    this.applyPosition();
  }

  /** Falou no chat: a boca mexe por um tempo. */
  talk(durationMs: number): void {
    this.talkUntil = this.clock + durationMs;
  }

  /** Tile onde o avatar vai terminar o que já recebeu do servidor. */
  get destination(): TilePoint {
    return this.queue.at(-1) ?? this.step?.to ?? this.tile;
  }

  /** O ponteiro está sobre o desenho do avatar? */
  hitTest(global: Point): boolean {
    return spriteHitTest(this.body, global);
  }

  /** Nome visível só ao passar o mouse (ou quando a cena pedir). */
  setNameVisible(on: boolean): void {
    this.nameVisible = on;
    this.nameTag.visible = on;
    this.cargoTag.visible = on && this.cargoTag.text !== '';
    this.layoutOverlays();
  }

  /** Toca um emote: animação no corpo e o emoji subindo sobre a cabeça. */
  playEmote(id: EmoteId): void {
    this.stopEmote();
    const emoji = new Text({ text: EMOTES[id].emoji, resolution: 2, style: { fontSize: 18 } });
    emoji.anchor.set(0.5, 1);
    emoji.position.set(0, EMOJI_Y);
    this.addChild(emoji);
    this.emote = { id, elapsed: 0, baseDir: this.dir, emoji };
  }

  get isWalking(): boolean {
    return this.step !== null || this.queue.length > 0;
  }

  /** Aplica um estado novo vindo do servidor. */
  applySnapshot(s: AvatarSnapshot): void {
    this.nameTag.text = s.birthday ? `${s.name} 🎂` : s.name;
    this.displayName = s.name;
    this.cargoTag.text = s.cargo;
    this.cargoTag.style.fill = s.cargoColor || 0xffffff;
    this.cargoTag.visible = this.nameVisible && s.cargo !== '';
    this.cake.visible = s.birthday;
    this.focusUntil = s.focusUntil;
    this.focusKind = s.focusKind;
    this.drawFocus();
    this.alpha = s.away ? 0.45 : 1;
    this.lying = s.action === 'lay';
    this.setSitting(s.action === 'sit' || this.lying, s.z);
    this.setStatus(s.status);
    this.typingBubble.visible = s.typing;

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
    // O 🍅 conta os minutos (redesenha só quando o texto muda).
    if (
      this.focusKind &&
      Math.floor((this.clock + dtMs) / 1000) !== Math.floor(this.clock / 1000)
    ) {
      this.drawFocus();
    }
    this.clock += dtMs;
    this.updateEmote(dtMs);
    if (this.poser) this.applyFrame();
    this.updateSleep();
    if (this.typingBubble.visible) {
      const active = Math.floor(this.clock / 250) % 3;
      this.typingDots.forEach((d, i) => (d.alpha = i === active ? 1 : 0.35));
    }
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
      // Sentado, fica acima do assento (na frente do móvel em que senta, encosto incluso).
      z:
        this.sitting && !this.step
          ? Math.max(this.sitZ, this.heightAt(a.x, a.y)) + 0.01
          : Math.max(this.heightAt(a.x, a.y), this.heightAt(b.x, b.y)),
    };
  }

  private setStatus(status: string): void {
    this.status = status;
    const color = STATUS_COLORS[status];
    this.statusBadge.clear();
    this.statusBadge.visible = color !== undefined;
    if (color !== undefined) {
      this.statusBadge.circle(0, 0, 4).fill(color).stroke({ width: 1.5, color: 0x101114 });
    }
    this.layoutOverlays();
  }

  /** Selo de status ao lado do nome (ou da cabeça, com o nome escondido). */
  private layoutOverlays(): void {
    const nameY = this.cargoTag.text ? NAME_Y - CARGO_LINE : NAME_Y;
    this.nameTag.position.y = nameY;
    const bounds = this.nameVisible ? this.nameTag.width / 2 + 7 : 12;
    this.statusBadge.position.set(bounds, this.nameVisible ? nameY - 6 : -80);
    this.typingBubble.position.set(0, this.nameVisible ? nameY - 20 : TYPING_Y);
  }

  private updateEmote(dtMs: number): void {
    const e = this.emote;
    if (!e) return;
    e.elapsed += dtMs;
    const def = EMOTES[e.id];
    // Andar interrompe a dança (os outros emotes terminam sozinhos).
    if (e.elapsed >= def.durationMs || (e.id === 'dance' && this.step)) return this.stopEmote();
    const t = e.elapsed / def.durationMs;
    const rise = e.id === 'dance' ? Math.abs(Math.sin(e.elapsed / 180)) * 4 : t * 28;
    e.emoji.position.set(0, (this.nameVisible ? NAME_Y - 14 : EMOJI_Y) - rise);
    e.emoji.alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
    if (e.id === 'dance') {
      const dir = DANCE_DIRS[Math.floor(e.elapsed / 280) % DANCE_DIRS.length]!;
      if (dir !== this.dir) {
        this.dir = dir;
        this.applyFrame();
      }
    }
  }

  private stopEmote(): void {
    const e = this.emote;
    if (!e) return;
    this.emote = null;
    e.emoji.destroy();
    if (e.id === 'dance' && !this.step) {
      this.dir = e.baseDir;
      this.applyFrame();
    }
  }

  /** Deslocamento extra do corpo durante um emote (aceno, risada, pulinho, dança). */
  private emoteOffset(): { x: number; y: number } {
    const e = this.emote;
    if (!e || this.step) return { x: 0, y: 0 };
    const s = e.elapsed / 1000;
    switch (e.id) {
      case 'wave':
        return { x: Math.round(Math.sin(s * 18) * 2), y: 0 };
      case 'laugh':
        return { x: 0, y: -Math.round(Math.abs(Math.sin(s * 22)) * 2) };
      case 'dance':
        return { x: 0, y: -Math.round(Math.abs(Math.sin(s * 11)) * 4) };
      default:
        return { x: 0, y: s < 0.3 ? -Math.round(Math.sin((Math.PI * s) / 0.3) * 4) : 0 };
    }
  }

  private drawFocus(): void {
    const on = Boolean(this.focusKind) && this.focusUntil > Date.now();
    this.focusTag.visible = on;
    if (!on) return;
    const text = `${this.focusKind === 'break' ? '☕' : '🍅'} ${focusLeft(this.focusUntil)}`;
    if (this.focusTag.text !== text) this.focusTag.text = text;
    this.focusTag.style.stroke = {
      color: this.focusKind === 'break' ? 0x14532d : 0x7f1d1d,
      width: 3,
    };
  }

  private setSitting(on: boolean, z: number): void {
    this.sitting = on;
    this.sitZ = z;
    // A pose sentada simulada esconde as pernas; com o avatar montado a pose já é real.
    const fake = on && !this.poser;
    this.body.mask = fake ? this.legMask : null;
    this.legMask.visible = fake;
    this.shadow.visible = !on;
  }

  private startNextStep(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.step = { from: this.tile, to: next, elapsed: 0 };
    this.dir = directionBetween(this.tile, next, this.dir);
    this.applyFrame();
  }

  private applyFrame(): void {
    if (this.poser) {
      const pose = this.currentPose();
      const key = poseKey(pose);
      if (key === this.poseShown) return;
      this.poseShown = key;
      return this.showFrame(this.poser.frame(pose));
    }
    const frame = this.frames?.[this.dir];
    if (frame) this.showFrame(frame);
  }

  /** Pose de agora: postura, gesto/expressão do emote, fala, piscar e sono. */
  private currentPose(): FigurePose {
    const pose: FigurePose = { direction: this.dir };
    if (this.step) {
      pose.posture = 'wlk';
      pose.frame = walkFrame(this.walkTime);
    } else if (this.lying) {
      pose.posture = 'lay';
    } else if (this.sitting) {
      pose.posture = 'sit';
    }
    if (this.emote) Object.assign(pose, emotePose(this.emote.id, this.emote.elapsed));
    if (this.step && pose.posture !== 'wlk') pose.posture = 'wlk';
    if (this.clock < this.talkUntil && !pose.talk) {
      pose.talk = true;
      pose.talkFrame = Math.floor(this.clock / TALK_FRAME_MS) % 2;
    }
    if (this.status === 'away') {
      pose.expression = 'eyb';
    } else if (!pose.expression) {
      if (this.clock >= this.blinkAt + BLINK_MS) this.blinkAt = this.clock + nextBlinkDelay();
      if (this.clock >= this.blinkAt) pose.expression = 'eyb';
    }
    return pose;
  }

  /** "z… zZ" subindo sobre quem está ausente. */
  private updateSleep(): void {
    const on = this.status === 'away' && Boolean(this.poser);
    this.sleep.visible = on;
    if (!on) return;
    const t = (this.clock % 2400) / 2400;
    this.sleep.text = t < 0.33 ? 'z' : t < 0.66 ? 'z Z' : 'z Z Z';
    this.sleep.position.set(10, -78 - Math.round(t * 6));
    this.sleep.alpha = t > 0.85 ? (1 - t) / 0.15 : 1;
  }

  private showFrame(frame: AvatarFrame): void {
    this.body.texture = frame.texture;
    this.body.anchor.set(
      frame.anchor.x / frame.texture.width,
      frame.anchor.y / frame.texture.height,
    );
  }

  private applyPosition(): void {
    let x = this.tile.x;
    let y = this.tile.y;
    let z = this.sitting && !this.step ? this.sitZ : this.heightAt(x, y);
    if (this.step) {
      const t = this.step.elapsed / STEP_MS;
      const { from, to } = this.step;
      x = from.x + (to.x - from.x) * t;
      y = from.y + (to.y - from.y) * t;
      z = this.heightAt(from.x, from.y) * (1 - t) + this.heightAt(to.x, to.y) * t;
    }
    const p = tileToScreen(x, y, z);
    this.position.set(Math.round(p.sx), Math.round(p.sy));

    if (this.poser) {
      // Pose real: sem balanço simulado (a dança ainda pula um pouquinho).
      const hop = this.emote?.id === 'dance' && !this.step ? this.emoteOffset().y : 0;
      this.body.position.set(0, (this.sitting && !this.step ? SIT_OFFSET : 0) + hop);
    } else if (this.step) {
      const quarter = Math.floor((this.walkTime / STEP_MS) * 4) % 4;
      const sway = quarter === 2 ? (this.stepCount % 2 === 0 ? 1 : -1) : 0;
      this.body.position.set(sway, BOB_Y[quarter]!);
    } else {
      const o = this.emoteOffset();
      this.body.position.set(o.x, (this.sitting ? SIT_DROP : 0) + o.y);
    }
  }
}
