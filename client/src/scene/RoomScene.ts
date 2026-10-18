import {
  depthOrder,
  footprint,
  parseHeightmap,
  pointInTile,
  RoomGrid,
  talkDurationMs,
  tileCorners,
  tileHeight,
  type DepthBox,
  type EmoteId,
  type EffectId,
  type FurniManifestEntry,
  type Heightmap,
  type PlacedFurni,
  type PlacementContext,
  type RoomDefinition,
  type RoomLayoutMessage,
  type TilePoint,
  type DayLight,
} from '@office/shared';
import { Container, Graphics, Text, type Application, type Point } from 'pixi.js';
import type { AssetLoader } from '../assets/AssetLoader.js';
import type { EffectLibrary } from '../assets/EffectLibrary.js';
import type { AvatarTextureCache } from '../assets/AvatarTextureCache.js';
import type { PlaceholderFactory } from '../assets/PlaceholderFactory.js';
import { DEBUG } from '../config.js';
import { AvatarView, type AvatarSnapshot } from '../entities/AvatarView.js';
import { ChatBubble } from '../entities/ChatBubble.js';
import { FurniView } from '../entities/FurniView.js';
import { PetView, type PetSnapshot } from '../entities/PetView.js';
import { Camera } from './Camera.js';
import { DecorMode, type DecorActions, type DecorHost, type DecorListener } from './DecorMode.js';
import { drawRoom } from './RoomRenderer.js';

/** Ponta do balão: um pouco acima do nome do avatar. */
const HEAD_OFFSET_Y = -100;
const MAX_BUBBLES = 10;
/** zIndex do fantasma do modo decorar: sempre por cima. */
const GHOST_Z = 1_000_000;

export interface SceneDeps {
  loader: AssetLoader;
  placeholders: PlaceholderFactory;
  avatars: AvatarTextureCache;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
  /** Efeitos do Habbo (Fase 34). */
  effects?: EffectLibrary;
}

export interface SceneActions extends DecorActions {
  move(tile: TilePoint): void;
  interact(furniId: string): void;
  /** Clique num mural de recados. */
  openBoard(furniId: string): void;
  /** Clique num quadro branco. */
  openWhiteboard(furniId: string): void;
  /** Clique numa mesa de jogos. */
  openGame(furniId: string): void;
  /** Clique no Quadro de Elogios. */
  openKudos(): void;
  /** Clique no Quadro de Demandas (Jira). */
  openJira(): void;
  /** Clique num avatar (abre o cartão). `at` = posição na tela. */
  avatarClick(sessionId: string, at: { x: number; y: number }): void;
}

/**
 * Cena de uma sala: piso/paredes, móveis, avatares, balões, ordenação de profundidade e
 * cliques. Não decide nada: mostra o estado do servidor e repassa as intenções (andar,
 * sentar, decorar).
 */
export class RoomScene implements DecorHost {
  readonly world = new Container({ label: 'world' });
  readonly camera: Camera;
  readonly map: Heightmap;
  readonly decor: DecorMode;
  readonly overlay = new Graphics({ label: 'decor-overlay' });
  private grid: RoomGrid;
  private readonly objects = new Container({ label: 'objects', sortableChildren: true });
  private readonly hover = new Graphics({ label: 'hover' });
  private readonly target = new Graphics({ label: 'target' });
  private readonly debugLayer = new Graphics({ label: 'debug' });
  private readonly bubbles = new Container({ label: 'bubbles' });
  /** Luz do dia/noite: multiplica a cena por uma cor (branco = dia). */
  private readonly nightShade = new Graphics({ label: 'night' });
  /** Brilho das luzes acesas (soma por cima da sombra da noite). */
  private readonly glows = new Container({ label: 'glows' });
  private darkness = 0;
  /** Salas com reunião acontecendo agora (placa na porta). */
  private busyRooms = new Map<string, string>();
  /** Partidas em andamento por mesa (desenhadas no tampo). */
  private readonly games = new Map<string, { board: string; line: number[] }>();
  private readonly doorLabel = new Text({
    text: '',
    resolution: 2,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 12,
      fontWeight: '700',
      fill: 0xffffff,
      stroke: { color: 0x1d4ed8, width: 4 },
    },
  });
  private readonly furni = new Map<string, FurniView>();
  private readonly avatars = new Map<string, AvatarView>();
  private readonly pets = new Map<string, PetView>();
  private hoveredPet: PetView | null = null;
  private depthKey = '';
  private targetFade = 0;
  private localId: string | null = null;
  private hoveredAvatar: AvatarView | null = null;

  constructor(
    private readonly app: Application,
    readonly layout: RoomLayoutMessage,
    private readonly deps: SceneDeps,
    private readonly actions: SceneActions,
    decorListener: DecorListener,
  ) {
    this.map = parseHeightmap(layout.heightmap);
    this.grid = this.buildGrid();

    const room: RoomDefinition = { ...layout, id: layout.roomId, furni: [] };
    this.world.addChild(
      drawRoom(this.map, room),
      this.hover,
      this.target,
      this.overlay,
      this.objects,
      this.nightShade,
      this.glows,
      this.debugLayer,
      this.bubbles,
      this.doorLabel,
    );
    this.nightShade.rect(-4000, -4000, 8000, 8000).fill(0xffffff);
    this.nightShade.blendMode = 'multiply';
    this.nightShade.eventMode = 'none';
    this.glows.blendMode = 'add';
    this.glows.eventMode = 'none';
    this.doorLabel.anchor.set(0.5, 1);
    this.doorLabel.visible = false;
    app.stage.addChild(this.world);

    this.decor = new DecorMode(this, actions, decorListener);
    this.camera = new Camera(app, this.world);
    this.camera.setPointerGuard((g) => this.decor.pointerDown(g));
    this.camera.onTap((p) => this.handleTap(p));
    app.stage.on('globalpointermove', this.onPointerMove, this);
    app.stage.on('pointerup', this.onPointerUp, this);
    app.stage.on('pointerupoutside', this.onPointerUp, this);
    app.canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  get defs(): ReadonlyMap<string, FurniManifestEntry> {
    return this.deps.furniDefs;
  }

  /** Centraliza a câmera (os móveis chegam pelo estado). */
  load(): void {
    this.camera.center();
  }

  // ---------- Móveis ----------

  /** Cria ou atualiza um móvel a partir do estado do servidor. */
  setFurni(id: string, placed: PlacedFurni): void {
    const existing = this.furni.get(id);
    if (existing) {
      existing.update(placed);
    } else {
      const def = this.deps.furniDefs.get(placed.defId);
      if (!def) {
        console.warn(`[sala] móvel sem definição no manifesto: ${placed.defId}`);
        return;
      }
      const view = new FurniView(placed, def, this.deps.loader, this.deps.placeholders);
      this.furni.set(id, view);
      this.objects.addChild(view);
      if (this.games.has(id)) view.setGame(this.games.get(id)!);
      void view.load().then(() => this.drawGlows());
    }
    this.onFurniChanged();
    this.drawGlows();
  }

  /** Reuniões em andamento por sala (a placa aparece ao passar o mouse na porta). */
  setBusyRooms(busy: Map<string, string>): void {
    this.busyRooms = busy;
  }

  /** Tabuleiro de uma mesa de jogos (`null` = mesa sem partida). */
  setGame(furniId: string, game: { board: string; line: number[] } | null): void {
    if (game) this.games.set(furniId, game);
    else this.games.delete(furniId);
    this.furni.get(furniId)?.setGame(game);
  }

  /** Miniatura do quadro branco no móvel. */
  setWhiteboardThumb(furniId: string, canvas: HTMLCanvasElement): void {
    this.furni.get(furniId)?.setSurfaceCanvas(canvas);
  }

  /** Luz do ambiente (dia/noite). */
  setDayLight(light: DayLight): void {
    this.darkness = light.darkness;
    this.nightShade.tint = light.tint;
    this.nightShade.visible = light.darkness > 0.01;
    this.drawGlows();
  }

  /** Brilho de cada luz acesa: mais forte quanto mais escuro estiver. */
  private drawGlows(): void {
    this.glows.removeChildren().forEach((c) => c.destroy());
    const strength = 0.18 + this.darkness * 0.55;
    for (const f of this.furni.values()) {
      if (!f.lit) continue;
      const { x, y } = f.glowPoint;
      const g = new Graphics();
      // Muitas elipses concêntricas com alfa baixo: um degradê radial barato e suave.
      const rings = 14;
      for (let i = rings; i >= 1; i--) {
        g.ellipse(x, y + i * 2, 9 * i, 7 * i).fill({ color: 0xffd27a, alpha: strength / rings });
      }
      this.glows.addChild(g);
    }
  }

  removeFurni(id: string): void {
    const view = this.furni.get(id);
    if (!view) return;
    this.furni.delete(id);
    this.decor.forget(id);
    view.destroy({ children: true });
    this.onFurniChanged();
  }

  furniView(id: string): FurniView | undefined {
    return this.furni.get(id);
  }

  createGhost(defId: string, x: number, y: number, rot: number): FurniView {
    const def = this.deps.furniDefs.get(defId)!;
    const ghost = new FurniView(
      { id: '__fantasma__', defId, x, y, z: 0, rot },
      def,
      this.deps.loader,
      this.deps.placeholders,
    );
    ghost.alpha = 0.65;
    ghost.zIndex = GHOST_Z;
    this.objects.addChild(ghost);
    void ghost.load();
    return ghost;
  }

  /** Contexto para validar colocações no cliente (mesmas regras do servidor). */
  placementContext(): PlacementContext {
    return {
      map: this.map,
      furni: [...this.furni.values()].map((f) => f.placed),
      defs: this.deps.furniDefs,
      doors: this.layout.doors,
      spawn: this.layout.spawn,
      avatars: [...this.avatars.values()].flatMap((a) => [a.tile, a.destination]),
    };
  }

  /**
   * Móvel sob o ponteiro: o desenho mais à frente com pixel visível no ponto; senão, o que
   * ocupa o tile apontado (sólido antes de tapete).
   */
  pickFurni(global: Point): FurniView | null {
    const views = [...this.furni.values()];
    const drawn = views
      .filter((f) => !f.def.canWalk && f.hitTest(global))
      .sort((a, b) => b.zIndex - a.zIndex)[0];
    if (drawn) return drawn;
    const tile = this.pickTile(global);
    if (!tile) return null;
    const onTile = views
      .filter((f) => {
        const fp = f.footprint;
        return tile.x >= fp.minX && tile.x <= fp.maxX && tile.y >= fp.minY && tile.y <= fp.maxY;
      })
      .sort((a, b) => Number(a.def.canWalk) - Number(b.def.canWalk));
    return onTile[0] ?? null;
  }

  private onFurniChanged(): void {
    this.grid = this.buildGrid();
    this.decor.refresh();
  }

  private buildGrid(): RoomGrid {
    return new RoomGrid(
      this.map,
      [...this.furni.values()].map((f) => f.placed),
      this.deps.furniDefs,
      {
        seatsAsGoal: false,
      },
    );
  }

  // ---------- Avatares ----------

  addAvatar(id: string, snapshot: AvatarSnapshot, isLocal: boolean): void {
    if (this.avatars.has(id)) return this.updateAvatar(id, snapshot);
    const view = new AvatarView(id, snapshot, isLocal, (x, y) => this.grid.heightAt(x, y));
    this.avatars.set(id, view);
    if (this.deps.effects) view.useEffects(this.deps.effects, snapshot.effect);
    if (isLocal) this.localId = id;
    this.objects.addChild(view);
    this.loadFrames(view, snapshot.figure);
  }

  updateAvatar(id: string, snapshot: AvatarSnapshot): void {
    const view = this.avatars.get(id);
    if (!view) return;
    view.applySnapshot(snapshot);
    if (view.figure !== snapshot.figure) this.loadFrames(view, snapshot.figure);
  }

  /** Busca (no cache por figure) as 8 texturas; ignora respostas de um visual já trocado. */
  private loadFrames(view: AvatarView, figure: string): void {
    view.figure = figure;
    void this.deps.avatars.get(figure).then((frames) => {
      if (!view.destroyed && view.figure === figure) view.setFrames(frames);
    });
    // Avatar montado: poses reais (sem ele, a animação simulada continua).
    void this.deps.avatars.poser(figure).then((poser) => {
      if (!view.destroyed && view.figure === figure) view.setPoser(poser);
    });
  }

  /** Comemoração: efeito por alguns segundos sobre alguém. */
  flashEffect(sessionId: string, effect: EffectId, ms: number): void {
    this.avatars.get(sessionId)?.flashEffect(effect, ms);
  }

  /** Toca um emote no avatar de quem mandou. */
  playEmote(sessionId: string, emote: EmoteId): void {
    this.avatars.get(sessionId)?.playEmote(emote);
  }

  /** Dados para o cartão do avatar. */
  avatarInfo(sessionId: string) {
    const a = this.avatars.get(sessionId);
    return a
      ? {
          name: a.displayName,
          status: a.status,
          isLocal: a.isLocal,
          tile: a.destination,
          figure: a.figure,
        }
      : null;
  }

  /** Avatar sob o ponteiro (pixel visível do desenho), o mais à frente primeiro. */
  pickAvatar(global: Point): AvatarView | null {
    return (
      [...this.avatars.values()]
        .filter((a) => a.hitTest(global))
        .sort((a, b) => b.zIndex - a.zIndex)[0] ?? null
    );
  }

  // ---------- Pets ----------

  setPet(id: string, snapshot: PetSnapshot): void {
    const view = this.pets.get(id);
    if (view) return view.applySnapshot(snapshot);
    const pet = new PetView(id, snapshot, (x, y) => this.grid.heightAt(x, y));
    this.pets.set(id, pet);
    this.objects.addChild(pet);
  }

  removePet(id: string): void {
    const view = this.pets.get(id);
    if (!view) return;
    if (this.hoveredPet === view) this.hoveredPet = null;
    this.pets.delete(id);
    view.destroy({ children: true });
  }

  removeAvatar(id: string): void {
    const view = this.avatars.get(id);
    if (!view) return;
    if (this.hoveredAvatar === view) this.hoveredAvatar = null;
    this.avatars.delete(id);
    view.destroy({ children: true });
  }

  /**
   * Balão de fala sobre a cabeça de quem falou. Como no Habbo, os balões já na tela sobem
   * para dar lugar ao novo e somem depois de alguns segundos.
   */
  say(sessionId: string, name: string, text: string, highlight = false): void {
    const avatar = this.avatars.get(sessionId);
    if (!avatar) return;
    avatar.talk(talkDurationMs(text));
    const bubble = new ChatBubble(name, text, avatar.isLocal, highlight);
    const gap = 3;
    for (const b of this.bubbles.children as ChatBubble[]) b.targetY -= bubble.stackHeight + gap;
    bubble.position.set(avatar.x, avatar.y + HEAD_OFFSET_Y);
    bubble.targetY = bubble.y;
    this.bubbles.addChild(bubble);
    while (this.bubbles.children.length > MAX_BUBBLES) {
      this.bubbles.children[0]?.destroy({ children: true });
    }
  }

  // ---------- Ciclo ----------

  update(dtMs: number): void {
    for (const a of this.avatars.values()) a.update(dtMs);
    for (const p of this.pets.values()) p.update(dtMs);
    for (const b of [...this.bubbles.children] as ChatBubble[]) {
      b.update(dtMs);
      if (b.expired) b.destroy({ children: true });
    }
    this.sortDepth();
    if (this.targetFade > 0) {
      this.targetFade = Math.max(0, this.targetFade - dtMs / 900);
      this.target.alpha = this.targetFade;
    }
  }

  destroy(): void {
    this.decor.destroy();
    this.camera.destroy();
    this.app.stage.off('globalpointermove', this.onPointerMove, this);
    this.app.stage.off('pointerup', this.onPointerUp, this);
    this.app.stage.off('pointerupoutside', this.onPointerUp, this);
    this.app.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.world.destroy({ children: true });
  }

  /** Reordena só quando alguma caixa muda (avatar troca de tile, móvel muda, alguém sai). */
  private sortDepth(): void {
    const boxes: DepthBox[] = [...this.furni.values()].map((f) => f.depthBox);
    for (const a of this.avatars.values()) boxes.push(a.depthBox);
    for (const p of this.pets.values()) boxes.push(p.depthBox);
    const key = boxes
      .map((b) => `${b.id}:${b.minX},${b.minY},${b.maxX},${b.maxY},${b.z}`)
      .join('|');
    if (key === this.depthKey) return;
    this.depthKey = key;

    const views = new Map<string, Container>([...this.furni].map(([id, f]) => [id, f]));
    for (const [id, a] of this.avatars) views.set(id, a);
    for (const p of this.pets.values()) views.set(p.label, p);
    depthOrder(boxes).forEach((id, i) => {
      const v = views.get(id);
      if (v) v.zIndex = i;
    });
    if (DEBUG) this.drawDebug(boxes);
  }

  // ---------- Entrada ----------

  /** Tile sob um ponto da tela, considerando a altura (testa de frente para trás). */
  pickTile(global: Point): TilePoint | null {
    const p = this.world.toLocal(global);
    let best: TilePoint | null = null;
    let bestDepth = -Infinity;
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const z = tileHeight(this.map, x, y);
        if (z === null) continue;
        if (x + y > bestDepth && pointInTile(p.x, p.y, x, y, z)) {
          best = { x, y };
          bestDepth = x + y;
        }
      }
    }
    return best;
  }

  private handleTap(global: Point): void {
    if (this.decor.active) return this.decor.tap(global);
    const tile = this.pickTile(global);
    if (!this.localId) return;

    // Clique numa pessoa: cartão com nome, status e ações.
    const avatar = this.pickAvatar(global);
    if (avatar) return this.actions.avatarClick(avatar.avatarId, { x: global.x, y: global.y });

    // Porta tem prioridade: um móvel alto na frente (cavalete, estante…) não pode "roubar" o
    // clique de quem quer sair da sala.
    if (tile && this.layout.doors.some((d) => d.x === tile.x && d.y === tile.y)) {
      this.flashTarget(tile, 0x7aa7ff);
      return this.actions.move(tile);
    }

    // Clique num assento (no tile dele ou no desenho, se o tile não dá para andar): sentar.
    const seat = this.seatAt(global, tile);
    if (seat) {
      this.flashTarget({ x: seat.placed.x, y: seat.placed.y }, 0x7aa7ff);
      return this.actions.interact(seat.placed.id);
    }
    // Móvel de usar (luz, TV, café) ou mural, clicando no desenho dele.
    const usable = this.usableAt(global);
    if (usable) {
      if (usable.def.interaction === 'board') return this.actions.openBoard(usable.placed.id);
      if (usable.def.interaction === 'whiteboard') {
        return this.actions.openWhiteboard(usable.placed.id);
      }
      if (usable.def.interaction === 'tictactoe') return this.actions.openGame(usable.placed.id);
      if (usable.def.interaction === 'kudos') return this.actions.openKudos();
      if (usable.def.interaction === 'jira') return this.actions.openJira();
      this.flashTarget({ x: usable.placed.x, y: usable.placed.y }, 0xffd27a);
      return this.actions.interact(usable.placed.id);
    }
    if (!tile) return;
    // O servidor decide o caminho; aqui é só um retorno visual imediato.
    this.flashTarget(tile, this.grid.isWalkable(tile.x, tile.y, true) ? 0xffffff : 0xe0a040);
    this.actions.move(tile);
  }

  /** Móvel interativo sob o ponteiro (pixel visível do desenho). */
  private usableAt(global: Point): FurniView | null {
    const f = this.pickFurni(global);
    return f?.def.interaction && f.hitTest(global) ? f : null;
  }

  /** Assento clicado: pixel do desenho da cadeira/sofá, ou o tile dele. */
  private seatAt(global: Point, tile: TilePoint | null): FurniView | null {
    const f = this.pickFurni(global);
    if (!f?.def.canSit && !f?.def.canLay) return null;
    if (f.hitTest(global)) return f;
    const fp = footprint(f.def, f.placed.x, f.placed.y, f.placed.rot);
    const onTile =
      tile && tile.x >= fp.minX && tile.x <= fp.maxX && tile.y >= fp.minY && tile.y <= fp.maxY;
    return onTile ? f : null;
  }

  private onPointerUp(): void {
    this.decor.pointerUp();
  }

  /** O ponteiro foi para um painel HTML: esconde o nome e o destaque do tile. */
  private readonly onPointerLeave = (): void => {
    this.hoveredAvatar?.setNameVisible(false);
    this.hoveredAvatar = null;
    this.app.canvas.style.cursor = '';
    this.hover.clear();
    this.doorLabel.visible = false;
  };

  private onPointerMove(e: { global: Point }): void {
    this.decor.pointerMove(e.global);
    // Nome só de quem está sob o ponteiro.
    const avatar = this.decor.active ? null : this.pickAvatar(e.global);
    if (avatar !== this.hoveredAvatar) {
      this.hoveredAvatar?.setNameVisible(false);
      avatar?.setNameVisible(true);
      this.hoveredAvatar = avatar;
    }
    // Pet sob o ponteiro: mostra o nome e de quem é.
    const pet =
      avatar || this.decor.active
        ? null
        : ([...this.pets.values()].find((p) => p.hitTest(e.global)) ?? null);
    if (pet !== this.hoveredPet) {
      this.hoveredPet?.setNameVisible(false);
      pet?.setNameVisible(true);
      this.hoveredPet = pet;
    }
    // Mãozinha em pessoas e em móveis que dá para usar.
    const usable = !avatar && !this.decor.active && this.usableAt(e.global);
    this.app.canvas.style.cursor = avatar || usable ? 'pointer' : '';
    const t = this.pickTile(e.global);
    this.hover.clear();
    if (!t) {
      this.doorLabel.visible = false;
      return;
    }
    const z = tileHeight(this.map, t.x, t.y) ?? 0;
    const pts = tileCorners(t.x, t.y, z).flatMap((c) => [c.sx, c.sy]);
    const door = this.layout.doors.find((d) => d.x === t.x && d.y === t.y);
    this.doorLabel.visible = Boolean(door) && !this.decor.active;
    if (this.decor.active) return;
    if (door) {
      // Porta: contorno azul e para onde ela leva.
      this.hover.poly(pts, true).stroke({ width: 2, color: 0x7aa7ff, alpha: 0.95 });
      const busy = this.busyRooms.get(door.targetRoomId);
      this.doorLabel.text = `→ ${door.targetName ?? door.targetRoomId}${busy ? `\n🔴 Em reunião: ${busy}` : ''}`;
      this.doorLabel.position.set(pts[0]!, pts[1]! - 6);
      return;
    }
    const ok = this.grid.isWalkable(t.x, t.y, true);
    this.hover.poly(pts, true).stroke({ width: 2, color: ok ? 0xffffff : 0xe05555, alpha: 0.7 });
  }

  private flashTarget(t: TilePoint, color: number): void {
    const z = tileHeight(this.map, t.x, t.y) ?? 0;
    const corners = tileCorners(t.x, t.y, z);
    const c = { sx: corners[0].sx, sy: (corners[0].sy + corners[2].sy) / 2 };
    // Losango menor no centro do tile.
    const pts = corners.flatMap((p) => [c.sx + (p.sx - c.sx) * 0.45, c.sy + (p.sy - c.sy) * 0.45]);
    this.target.clear().poly(pts).fill({ color, alpha: 0.55 });
    this.target.alpha = 1;
    this.targetFade = 1;
  }

  private drawDebug(boxes: DepthBox[]): void {
    const g = this.debugLayer.clear();
    for (const b of boxes) {
      const pts = [
        tileCorners(b.minX, b.minY, b.z)[0],
        tileCorners(b.maxX, b.minY, b.z)[1],
        tileCorners(b.maxX, b.maxY, b.z)[2],
        tileCorners(b.minX, b.maxY, b.z)[3],
      ].flatMap((c) => [c.sx, c.sy]);
      g.poly(pts, true).stroke({ width: 1, color: 0x00e0ff, alpha: 0.8 });
    }
  }
}
