import {
  BLINK_MS,
  COFFEE_ITEM,
  EFFECT_IDS,
  SIP_EVERY_MS,
  SIP_MS,
  type EffectId,
  directionBetween,
  emotePose,
  emoteBodyDy,
  EMOTES,
  DANCES,
  danceFrame,
  danceFrameIndex,
  type AnimFrame,
  type DanceId,
  nextBlinkDelay,
  poseKey,
  TALK_FRAME_MS,
  headTurn,
  walkFrame,
  type FigurePose,
  focusLeft,
  layFacing,
  STEP_MS,
  type EmoteId,
  tileToScreen,
  type DepthBox,
  type TilePoint,
} from '@office/shared';
import { Container, Graphics, Sprite, Text, type Point } from 'pixi.js';
import type { AvatarFrame, AvatarFrames, AvatarPoser } from '../assets/AvatarTextureCache.js';
import { dropTexture, holdTexture } from '../assets/textureHold.js';
import { spriteHitTest } from '../assets/hitTest.js';
import type { EffectLibrary } from '../assets/EffectLibrary.js';
import { EffectLayer } from './EffectLayer.js';

const isEffect = (id: string): id is EffectId => (EFFECT_IDS as readonly string[]).includes(id);

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
/**
 * Com a pose sentada real, quanto o desenho desce para assentar no móvel (meio tile: calibrado
 * contra cadeiras e sofás desenhados pelas camadas do Habbo, 20/10/2026). No chão não desce.
 */
const SIT_OFFSET = 16;
/**
 * Deitado, o desenho do Habbo fica todo de um lado do ponto dos pés (a cabeça ~60 px para trás):
 * empurra o corpo ao longo da cama (meio tile de x para cada tile de y, como a grade) e desce.
 * Direção 2: cama no eixo x; direção 4 (espelho): cama no eixo y.
 */
const LAY_OFFSET: Record<number, { x: number; y: number }> = {
  2: { x: 36, y: 24 },
  4: { x: -36, y: 24 },
};
/**
 * Sem o avatar montado (só o desenho parado do imager), deitar inclina o boneco ao longo da cama,
 * girando em volta dos pés até a cabeça chegar ao travesseiro. Antes era desenhado sentado.
 */
const FAKE_LAY_TILT = Math.atan2(2, 1);
const FAKE_LAY_FEET: Record<number, { x: number; y: number }> = {
  2: { x: 36, y: 12 },
  4: { x: -36, y: 12 },
};
const SIT_CUT_Y = -2;
/** Altura do "…" de digitando e do emoji dos emotes. */
const TYPING_Y = -96;
const EMOJI_Y = -100;
/** Selo sobre a cabeça (Fase 42): cor e desenho por estado; "reunião" vem da sala. */
const STATUS_COLORS: Record<string, number> = {
  busy: 0xe05555,
  away: 0xe0a82e,
  meeting: 0x8b5cf6,
};
const BADGE_R = 7;

/**
 * Entre um passo e o próximo (o pacote do servidor chega um pouco depois), continua com a pose
 * de andar por um instante em vez de piscar a pose parada (o andar "engasgava").
 */
const WALK_GRACE_MS = 160;
/** Gestos de um braço só (o esquerdo): dá para fazer segurando o item no direito. */
const LEFT_ARM_GESTURES = new Set(['wav', 'respect', 'sig']);

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
  /** Efeito em uso (id de `EFFECTS`); vazio = nenhum. */
  effect: string;
  /** Item na mão (id do Habbo); 0 = nada. */
  handItem: number;
  /** Dança em andamento (Fase 55); vazio = não. */
  dance: string;
  /** Começo do compasso da dança (epoch ms do servidor). */
  danceStart: number;
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
  /** Olhando para quem falou: direção do olhar e até quando. */
  private look: { dir: number; until: number } | null = null;
  private blinkAt = nextBlinkDelay();
  private lying = false;
  private handItem = 0;
  /**
   * Direção e ação que o servidor mandou por último. A direção de sentar/deitar chega no mesmo
   * pacote do último passo; se o passo ainda está animando, é aplicada quando ele acaba (antes
   * se perdia: sentava de lado, de costas ou "em pé" na diagonal).
   */
  private serverDir = 0;
  private serverAction = 'idle';
  private stepEndedAt = -Infinity;
  private shownTexture: AvatarFrame['texture'] | null = null;
  /** Efeitos do Habbo (em uso e comemorações), quando a cena tem a biblioteca. */
  private fxLayer: EffectLayer | null = null;
  /** "zZ" sobre a cabeça de quem está ausente (olhos fechados). */
  private readonly sleep: Text;
  /** Nota 🎵 flutuando sobre quem dança. */
  private readonly danceNote: Text;
  /** Dança de agora (Fase 55) e o começo do compasso, no relógio do servidor. */
  private dance: DanceId | null = null;
  private danceStart = 0;
  /** Hora do servidor (a cena liga no relógio da conexão; sem ela, a daqui). */
  serverNow: () => number = Date.now;
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
  /** Falando numa chamada (Fase 49): anel verde nos pés. */
  private readonly speakRing = new Graphics();
  /** Em reunião (a sala tem reunião agora): selo roxo se a pessoa estiver disponível. */
  private inMeeting = false;
  /** Deslocamento do nome para cima (px do mundo) para não encavalar com outros nomes. */
  private nameShift = 0;
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
    this.danceNote = new Text({ text: '🎵', resolution: 2, style: { fontSize: 13 } });
    this.danceNote.anchor.set(0.5, 1);
    this.danceNote.visible = false;
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
      this.speakRing,
      this.shadow,
      this.body,
      this.legMask,
      this.statusBadge,
      this.cake,
      this.focusTag,
      this.sleep,
      this.danceNote,
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

  /** Liga os efeitos (a cena passa a biblioteca). */
  useEffects(library: EffectLibrary, worn: string): void {
    this.fxLayer = new EffectLayer(library);
    this.fxLayer.setWorn(isEffect(worn) ? worn : null);
    this.addChildAt(this.fxLayer.back, this.getChildIndex(this.body));
    this.addChildAt(this.fxLayer.front, this.getChildIndex(this.body) + 1);
  }

  /** Comemoração: efeito por alguns segundos. */
  flashEffect(id: EffectId, ms: number): void {
    this.fxLayer?.flashFor(id, ms);
  }

  /** Alguém por perto falou: vira a cabeça para lá por um tempo (o corpo fica como está). */
  lookAt(dir: number, durationMs: number): void {
    this.look = { dir, until: this.clock + durationMs };
  }

  /** Quanto a cabeça está virada para quem falou agora (testes e depuração). */
  get lookingTurn(): number {
    const look = this.look;
    if (!look || this.clock >= look.until || this.step || this.lying || this.emote) return 0;
    if (this.danceNow()) return 0;
    return headTurn(this.dir, look.dir) ?? 0;
  }

  /** Falou no chat: a boca mexe por um tempo. */
  talk(durationMs: number): void {
    this.talkUntil = this.clock + durationMs;
  }

  /** Tile onde o avatar vai terminar o que já recebeu do servidor. */
  get destination(): TilePoint {
    return this.queue.at(-1) ?? this.step?.to ?? this.tile;
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.shownTexture) dropTexture(this.shownTexture);
    this.shownTexture = null;
    super.destroy(options);
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

  /** Emote tocando agora (`null` = nenhum). */
  get currentEmote(): EmoteId | null {
    return this.emote?.id ?? null;
  }

  /** Dança de agora e o quadro dela (`null` = não está dançando), para os testes. */
  get currentDance(): { id: DanceId; frame: number } | null {
    return this.dance
      ? { id: this.dance, frame: danceFrameIndex(this.dance, this.serverNow() - this.danceStart) }
      : null;
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
    this.handItem = s.handItem;
    this.dance = s.dance in DANCES ? (s.dance as DanceId) : null;
    this.danceStart = s.danceStart;
    this.serverDir = s.dir;
    this.serverAction = s.action;
    this.fxLayer?.setWorn(isEffect(s.effect) ? s.effect : null);
    this.setSitting(s.action === 'sit' || this.lying, s.z);
    this.setStatus(s.status);
    this.typingBubble.visible = s.typing;

    const target = { x: s.nextX, y: s.nextY };
    const last = this.queue.at(-1) ?? this.step?.to ?? this.tile;
    if (target.x === last.x && target.y === last.y) {
      // Andando ainda: a direção é aplicada quando o último passo acabar (ver `update`).
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
        if (!this.step) {
          this.stepEndedAt = this.clock;
          // Chegou: vira para onde o servidor mandou (o assento, a cama, o móvel usado).
          if (this.serverDir !== this.dir) {
            this.dir = this.serverDir;
            this.applyFrame();
          }
        }
      }
    }
    const grace = !this.step && this.walkGrace();
    this.walkTime = this.step || grace ? this.walkTime + dtMs * speed : 0;
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
    this.updateDanceNote();
    if (this.fxLayer) {
      this.fxLayer.update(dtMs, this.dir);
      // As camadas acompanham o corpo (sentado, pulando…).
      this.fxLayer.back.position.copyFrom(this.body.position);
      this.fxLayer.front.position.copyFrom(this.body.position);
    }
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
    this.drawBadge();
  }

  setSpeaking(on: boolean): void {
    if (on === this.speakRing.visible && this.speakRing.width > 0) return;
    this.speakRing.clear();
    if (on) {
      this.speakRing
        .ellipse(0, 0, 17, 8)
        .stroke({ width: 3, color: 0x3fbf6f, alpha: 0.95 })
        .ellipse(0, 0, 21, 10)
        .stroke({ width: 1.5, color: 0x3fbf6f, alpha: 0.45 });
    }
    this.speakRing.visible = on;
  }

  /** A sala está em reunião: mostra o selo de reunião em quem está disponível. */
  setMeeting(on: boolean): void {
    if (this.inMeeting === on) return;
    this.inMeeting = on;
    this.drawBadge();
  }

  /** Selo sobre a cabeça: ocupado (traço), ausente (relógio) ou em reunião (duas pessoas). */
  private drawBadge(): void {
    const kind =
      this.status === 'busy' || this.status === 'away'
        ? this.status
        : this.inMeeting
          ? 'meeting'
          : '';
    const g = this.statusBadge.clear();
    g.visible = kind !== '';
    if (kind) {
      g.circle(0, 0, BADGE_R).fill(STATUS_COLORS[kind]!).stroke({ width: 1.5, color: 0x101114 });
      if (kind === 'busy') g.roundRect(-4, -1.25, 8, 2.5, 1).fill(0xffffff);
      else if (kind === 'away') {
        g.circle(0, 0, 4.2).stroke({ width: 1.3, color: 0xffffff });
        g.moveTo(0, 0)
          .lineTo(0, -2.8)
          .moveTo(0, 0)
          .lineTo(2, 1)
          .stroke({ width: 1.3, color: 0xffffff });
      } else {
        g.circle(-2.4, -1.4, 1.6).circle(2.4, -1.4, 1.6).fill(0xffffff);
        g.roundRect(-5, 1, 4.6, 3, 1.5).roundRect(0.4, 1, 4.6, 3, 1.5).fill(0xffffff);
      }
    }
    this.layoutOverlays();
  }

  /** Nome deslocado para cima (`px` do mundo, negativo = sobe) para não encavalar. */
  setNameShift(px: number): void {
    if (this.nameShift === px) return;
    this.nameShift = px;
    this.layoutOverlays();
  }

  /** Meio do desenho do corpo na tela (testes de ponta a ponta clicam aqui). */
  bodyCenter(): { x: number; y: number } {
    const b = this.body.getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height * 0.55 };
  }

  /** Retângulo do nome na tela (para afastar nomes que se encostam). */
  nameBounds(): { x: number; y: number; width: number; height: number } {
    const b = this.nameTag.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  /** Selo de status ao lado do nome (ou da cabeça, com o nome escondido). */
  private layoutOverlays(): void {
    const nameY = (this.cargoTag.text ? NAME_Y - CARGO_LINE : NAME_Y) + this.nameShift;
    this.nameTag.position.y = nameY;
    this.cargoTag.position.y = NAME_Y + this.nameShift;
    const bounds = this.nameVisible ? this.nameTag.width / 2 + BADGE_R + 3 : 13;
    this.statusBadge.position.set(bounds, this.nameVisible ? nameY - 7 : -82);
    this.typingBubble.position.set(0, this.nameVisible ? nameY - 20 : TYPING_Y);
  }

  private updateEmote(dtMs: number): void {
    const e = this.emote;
    if (!e) return;
    e.elapsed += dtMs;
    const def = EMOTES[e.id];
    if (e.elapsed >= def.durationMs) return this.stopEmote();
    const t = e.elapsed / def.durationMs;
    e.emoji.position.set(0, (this.nameVisible ? NAME_Y - 14 : EMOJI_Y) - t * 28);
    e.emoji.alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
  }

  private stopEmote(): void {
    const e = this.emote;
    if (!e) return;
    this.emote = null;
    e.emoji.destroy();
  }

  /**
   * Quadro da dança agora (Fase 55): pelo relógio do servidor, então todo mundo vê o mesmo.
   * Andando, sentado, deitado ou no meio de um emote, a dança espera.
   */
  private danceNow(): AnimFrame | null {
    if (!this.dance || this.step || this.walkGrace() || this.sitting || this.lying || this.emote) {
      return null;
    }
    return danceFrame(this.dance, this.serverNow() - this.danceStart);
  }

  /** "🎵" balançando sobre quem dança. */
  private updateDanceNote(): void {
    const on = this.dance !== null && !this.step;
    this.danceNote.visible = on;
    if (!on) return;
    const t = (this.clock % 1600) / 1600;
    this.danceNote.position.set(
      14 + Math.round(Math.sin(t * Math.PI * 2) * 3),
      -84 - Math.round(t * 8),
    );
    this.danceNote.alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
  }

  /** Acabou um passo e o servidor ainda diz "andando": o próximo passo está chegando. */
  private walkGrace(): boolean {
    return this.serverAction === 'walk' && this.clock - this.stepEndedAt < WALK_GRACE_MS;
  }

  /** Corpo inteiro subindo nos emotes animados (Fase 54): só em pé e parado. */
  private animHop(): number {
    const e = this.emote;
    if (!e || this.step || this.sitting || this.lying) return 0;
    return emoteBodyDy(e.id, e.elapsed) ?? 0;
  }

  /** Deslocamento extra do corpo durante um emote (aceno, risada, pulinho, dança). */
  private emoteOffset(): { x: number; y: number } {
    const e = this.emote;
    if (!e || this.step) return { x: 0, y: 0 };
    // Emote animado (Fase 54): o pulo da própria animação, sem o pulinho genérico.
    if (emoteBodyDy(e.id, e.elapsed) !== null) return { x: 0, y: this.animHop() };
    const s = e.elapsed / 1000;
    switch (e.id) {
      case 'wave':
        return { x: Math.round(Math.sin(s * 18) * 2), y: 0 };
      case 'laugh':
        return { x: 0, y: -Math.round(Math.abs(Math.sin(s * 22)) * 2) };
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
    const fake = on && !this.poser && !this.lying;
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
      // A revisão muda quando o posador passa a ter o item da mão: pede a pose de novo.
      const key = `${poseKey(pose)}#${this.poser.revision ?? 0}`;
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
    if (this.step || this.walkGrace()) {
      pose.posture = 'wlk';
      pose.frame = walkFrame(this.walkTime);
    } else if (this.lying) {
      pose.posture = 'lay';
    } else if (this.sitting) {
      pose.posture = 'sit';
    }
    if (this.emote) {
      // Sentado, o emote não mexe tronco e pernas; deitado, só o rosto (Fase 54).
      const posture = this.lying ? 'lay' : this.sitting && !this.step ? 'sit' : 'stand';
      Object.assign(pose, emotePose(this.emote.id, this.emote.elapsed, posture));
      if (!this.step && this.lying) pose.posture = 'lay';
      else if (!this.step && this.sitting) pose.posture = 'sit';
    }
    // Dança (Fase 55): o quadro do compasso, com o corpo girando quando a coreografia pede.
    const dance = this.danceNow();
    if (dance) {
      if (dance.parts) pose.parts = dance.parts;
      if (dance.expression) pose.expression = dance.expression;
      if (dance.talk)
        Object.assign(pose, { talk: true, talkFrame: Math.floor(this.clock / 120) % 2 });
      if (dance.bodyDd) pose.direction = (this.dir + dance.bodyDd + 8) % 8;
    }
    // Roupa animada: 8 quadros por segundo (começa em 1; 0 = parada).
    if (this.poser?.animated) pose.clothingFrame = 1 + Math.floor(this.clock / 125);
    // Item na mão: segura o tempo todo e dá um gole de vez em quando (o ☕ também mostra a xícara).
    const item = this.handItem || (this.emote?.id === 'coffee' ? COFFEE_ITEM : 0);
    if (item && !this.lying) {
      pose.handItem = item;
      const hold = this.clock % SIP_EVERY_MS < SIP_MS ? 'drk' : 'crr';
      // Com um gesto do braço esquerdo (acenar, joinha), o direito continua segurando o item.
      if (!pose.gesture) pose.gesture = hold;
      else if (LEFT_ARM_GESTURES.has(pose.gesture)) pose.handGesture = 'crr';
    }
    if (this.step && pose.posture !== 'wlk') pose.posture = 'wlk';
    // Olhando para quem falou: só a cabeça gira, e só parado (andando, deitado, no meio de um
    // emote ou dançando, segue como está).
    if (this.look && this.clock >= this.look.until) this.look = null;
    if (this.look && !this.step && !this.lying && !this.emote && !dance) {
      const dd = headTurn(this.dir, this.look.dir);
      if (dd !== null) pose.parts = { ...pose.parts, head: { ...pose.parts?.head, dd } };
    }
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
    // Segura a textura enquanto estiver na tela (os caches não a destroem nesse tempo).
    if (frame.texture !== this.shownTexture) {
      holdTexture(frame.texture);
      if (this.shownTexture) dropTexture(this.shownTexture);
      this.shownTexture = frame.texture;
    }
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
    // Deitado, o avatar inteiro (corpo, nome, selo) vai para cima da cama.
    // A mesma regra de direção da montagem (2 ou o espelho 4), para o corpo cair na cama.
    const lay = !this.step && this.lying ? LAY_OFFSET[layFacing(this.dir)]! : null;
    this.position.set(Math.round(p.sx) + (lay?.x ?? 0), Math.round(p.sy) + (lay?.y ?? 0));

    this.body.rotation = 0;
    if (this.poser) {
      // Pose real: sem balanço simulado (a dança ainda pula um pouquinho; pular e comemorar,
      // do jeito da animação, só em pé).
      const hop = this.animHop();
      const onSeat = this.sitting && this.sitZ > this.heightAt(this.tile.x, this.tile.y) + 0.05;
      const rest = this.step || this.lying || !onSeat ? 0 : SIT_OFFSET;
      // Dança (Fase 55): o corpo inteiro pula e desliza (o moonwalk); no espelho, o x inverte.
      const dance = this.danceNow();
      const facing = (this.dir + (dance?.bodyDd ?? 0) + 8) % 8;
      const flip = facing >= 4 && facing <= 6 ? -1 : 1;
      this.body.position.set(flip * (dance?.bodyDx ?? 0), rest + hop + (dance?.bodyDy ?? 0));
    } else if (this.step) {
      const quarter = Math.floor((this.walkTime / STEP_MS) * 4) % 4;
      const sway = quarter === 2 ? (this.stepCount % 2 === 0 ? 1 : -1) : 0;
      this.body.position.set(sway, BOB_Y[quarter]!);
    } else if (this.lying) {
      const facing = layFacing(this.dir);
      const feet = FAKE_LAY_FEET[facing]!;
      this.body.rotation = facing === 4 ? FAKE_LAY_TILT : -FAKE_LAY_TILT;
      this.body.position.set(feet.x, feet.y);
    } else {
      const o = this.emoteOffset();
      this.body.position.set(o.x, (this.sitting ? SIT_DROP : 0) + o.y);
    }
  }
}
