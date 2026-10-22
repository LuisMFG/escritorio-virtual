import {
  deskOfSeat,
  tileToScreen,
  depthOrder,
  footprint,
  hasWall,
  parseHeightmap,
  WALL_PX,
  Z_UNIT,
  pointInTile,
  acceptsOnTop,
  isRug,
  stackedOn,
  RoomGrid,
  talkDurationMs,
  tileCorners,
  tileHeight,
  type DepthBox,
  type EmoteId,
  type EffectId,
  type FurniManifestEntry,
  type FurniResult,
  type Heightmap,
  type PlacedFurni,
  type PlacementContext,
  type RoomDefinition,
  type RoomLayoutMessage,
  type TilePoint,
  type DayLight,
} from '@office/shared';
import {
  Container,
  Graphics,
  Text,
  type Application,
  type FederatedPointerEvent,
  type Point,
} from 'pixi.js';
import type { AssetLoader } from '../assets/AssetLoader.js';
import type { EffectLibrary } from '../assets/EffectLibrary.js';
import type { FurniVisualLibrary } from '../assets/FurniVisualLibrary.js';
import type { AvatarTextureCache } from '../assets/AvatarTextureCache.js';
import type { PlaceholderFactory } from '../assets/PlaceholderFactory.js';
import { DEBUG } from '../config.js';
import { AvatarView, type AvatarSnapshot } from '../entities/AvatarView.js';
import { ChatBubble } from '../entities/ChatBubble.js';
import { FurniView } from '../entities/FurniView.js';
import { PetView, type PetSnapshot } from '../entities/PetView.js';
import { Camera, type TapInfo } from './Camera.js';
import {
  DecorMode,
  type DecorActions,
  type DecorHost,
  type DecorListener,
  type DecorPointer,
} from './DecorMode.js';
import { FurniPending } from './FurniPending.js';
import { drawRoom } from './RoomRenderer.js';

/** Destaque ao achar a pessoa pela lista (ms). */
const SPOTLIGHT_MS = 1800;

/** Ponta do balão: um pouco acima do nome do avatar. */
const HEAD_OFFSET_Y = -100;
const MAX_BUBBLES = 10;
/** zIndex do fantasma do modo decorar: sempre por cima. */
const GHOST_Z = 1_000_000;
/** Brilho sobre os dois no toca aqui (ms). */
const HIGH_FIVE_SPARKLE_MS = 1400;
/** Folga (px de tela) do clique em objetos pequenos em cima de uma mesa (DE10). */
const PICK_SLACK_PX = 3;

/** Novas tentativas de montar um avatar que falhou (ms). */
const POSER_RETRY_MS = [4_000, 15_000, 45_000];

export interface SceneDeps {
  loader: AssetLoader;
  placeholders: PlaceholderFactory;
  avatars: AvatarTextureCache;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
  /** Efeitos do Habbo (Fase 34). */
  effects?: EffectLibrary;
  /** Móveis por camadas e animados (Fase 37). */
  furniVisuals?: FurniVisualLibrary;
  /** Busca a definição de um móvel do catálogo completo que ainda não está em `furniDefs`. */
  requestDef?: (defId: string) => Promise<FurniManifestEntry | null>;
  /** Hora do servidor (epoch ms): o compasso das danças (Fase 55). */
  serverNow?: () => number;
}

/** Ponto escolhido numa parede: tile, lado (2 ou 4) e altura acima do piso. */
export interface WallSpot {
  x: number;
  y: number;
  rot: 2 | 4;
  h: number;
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
  /** Clique numa TV (Fase 51). */
  openTv(furniId: string): void;
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
  /** Contornos do Decorar por cima dos móveis, na altura do alvo (Fase 53). */
  readonly overlayTop = new Graphics({ label: 'decor-overlay-top' });
  /** Mover/girar esperando o servidor: a tela mostra o esperado (Fase 53). */
  private readonly pendingFurni = new FurniPending();
  /** Algum avatar mudou: o verde/vermelho do Decorar é refeito no próximo quadro. */
  private avatarsDirty = false;
  private grid: RoomGrid;
  /** Piso e paredes: o que a câmera enquadra. */
  private readonly roomArt: Container;
  private readonly objects = new Container({ label: 'objects', sortableChildren: true });
  /** Itens de parede (quadros, janelas): atrás de tudo que está no piso. */
  private readonly wallItems = new Container({ label: 'wall-items' });
  /** Móveis cuja definição ainda está chegando do servidor. */
  private readonly waitingDef = new Map<string, PlacedFurni>();
  private readonly hover = new Graphics({ label: 'hover' });
  private readonly target = new Graphics({ label: 'target' });
  private readonly debugLayer = new Graphics({ label: 'debug' });
  private readonly bubbles = new Container({ label: 'bubbles' });
  /** Plaquinhas com o nome do dono de cada mesa (Fase 42). */
  private readonly plaques = new Container({ label: 'plaques' });
  private deskOwners: ReadonlyMap<string, string> = new Map();
  /** Alt segurado: todos os nomes aparecem, afastados para não encavalar. */
  private allNames = false;
  private spreadTimer = 0;
  private plaquesDirty = false;
  /** Destaque de quem foi achado pela lista: círculo pulsando por cima de tudo. */
  private readonly spotlight = new Graphics({ label: 'spotlight' });
  private spotlightOn: { view: AvatarView; left: number } | null = null;
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
    const roomArt = drawRoom(this.map, room);
    this.roomArt = roomArt;
    this.world.addChild(
      roomArt,
      this.wallItems,
      this.hover,
      this.target,
      this.overlay,
      this.objects,
      this.nightShade,
      this.glows,
      this.overlayTop,
      this.debugLayer,
      this.plaques,
      this.spotlight,
      this.bubbles,
      this.doorLabel,
    );
    this.nightShade.rect(-4000, -4000, 8000, 8000).fill(0xffffff);
    this.nightShade.blendMode = 'multiply';
    this.nightShade.eventMode = 'none';
    this.glows.blendMode = 'add';
    this.glows.eventMode = 'none';
    this.overlay.eventMode = 'none';
    this.overlayTop.eventMode = 'none';
    this.doorLabel.anchor.set(0.5, 1);
    this.doorLabel.visible = false;
    app.stage.addChild(this.world);

    this.decor = new DecorMode(this, actions, decorListener);
    this.camera = new Camera(app, this.world, () => this.roomArt.getLocalBounds());
    this.camera.setPointerGuard((e) => this.decor.pointerDown(decorPointer(e)));
    this.camera.setWheelGuard((e) => this.decor.wheel(e));
    this.camera.onTap((p, info) => this.handleTap(p, info));
    // Segundo dedo (pinça) durante um arrasto: cancela, em vez de embaralhar o fantasma (DE9).
    this.camera.onPinchStart(() => this.decor.cancelDrag());
    // Segurar sobre alguém (celular): abre o cartão sem andar.
    this.camera.onLongPress((p) => {
      if (this.decor.active) return;
      const avatar = this.pickAvatar(p);
      if (avatar) this.actions.avatarClick(avatar.avatarId, { x: p.x, y: p.y });
    });
    app.stage.on('globalpointermove', this.onPointerMove, this);
    app.stage.on('pointerup', this.onPointerUp, this);
    app.stage.on('pointerupoutside', this.onPointerUp, this);
    app.canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('blur', this.onWindowBlur);
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
    if (this.deskOwners.size) this.plaquesDirty = true;
    let existing = this.furni.get(id);
    // Trocou de cor (outra definição): recria o desenho (e continua selecionado).
    const reselect = Boolean(
      existing && existing.def.id !== placed.defId && this.decor.selected === id,
    );
    if (existing && existing.def.id !== placed.defId) {
      this.removeFurni(id);
      existing = undefined;
    }
    // Mover/girar esperando o servidor: guarda o estado e mostra quando ele responder.
    const shown = this.pendingFurni.server(placed);
    if (existing) {
      if (shown) existing.update(shown);
    } else {
      const def = this.deps.furniDefs.get(placed.defId);
      if (!def) {
        // Móvel do catálogo completo que este navegador ainda não conhece: busca e desenha.
        if (!this.deps.requestDef) {
          console.warn(`[sala] móvel sem definição no manifesto: ${placed.defId}`);
          return;
        }
        this.waitingDef.set(id, placed);
        void this.deps.requestDef(placed.defId).then((d) => {
          const waiting = this.waitingDef.get(id);
          if (!d || !waiting || waiting.defId !== d.id || this.world.destroyed) return;
          this.waitingDef.delete(id);
          this.setFurni(id, waiting);
        });
        return;
      }
      this.waitingDef.delete(id);
      const view = new FurniView(
        placed,
        def,
        this.deps.loader,
        this.deps.placeholders,
        this.deps.furniVisuals,
      );
      view.enableSlices();
      this.furni.set(id, view);
      (def.wall ? this.wallItems : this.objects).addChild(view);
      if (this.games.has(id)) view.setGame(this.games.get(id)!);
      if (reselect) this.decor.reselect(id);
      void view.load().then(() => this.drawGlows());
    }
    this.onFurniChanged();
    this.drawGlows();
  }

  /** Reuniões em andamento por sala (a placa aparece ao passar o mouse na porta). */
  setBusyRooms(busy: Map<string, string>): void {
    this.busyRooms = busy;
    const meeting = busy.has(this.layout.roomId);
    for (const a of this.avatars.values()) a.setMeeting(meeting);
  }

  // ---------- Minha mesa e presença (Fase 42) ----------

  /** Donos das mesas (id da cadeira → nome): uma plaquinha na frente de cada mesa. */
  setDeskOwners(owners: ReadonlyMap<string, string>): void {
    this.deskOwners = owners;
    this.plaquesDirty = true;
  }

  private drawPlaques(): void {
    for (const c of this.plaques.removeChildren()) c.destroy({ children: true });
    for (const [seat, name] of this.deskOwners) {
      const deskId = deskOfSeat(seat);
      const desk = deskId ? this.furni.get(deskId)?.placed : undefined;
      const def = desk && this.deps.furniDefs.get(desk.defId);
      if (!desk || !def) continue;
      const fp = footprint(def, desk.x, desk.y, desk.rot);
      const p = tileToScreen((fp.minX + fp.maxX + 1) / 2, fp.maxY + 1, desk.z + def.height * 0.55);
      const label = new Text({
        text: name.length > 14 ? `${name.slice(0, 13)}…` : name,
        resolution: 2,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 9,
          fontWeight: '700',
          fill: 0x1c2330,
        },
      });
      label.anchor.set(0.5);
      const plate = new Graphics()
        .roundRect(-label.width / 2 - 5, -7, label.width + 10, 14, 4)
        .fill({ color: 0xf6f1e3 })
        .stroke({ width: 1, color: 0x7a5c2e });
      const tag = new Container({ label: `plaque:${seat}` });
      tag.addChild(plate, label);
      tag.position.set(Math.round(p.sx), Math.round(p.sy));
      tag.eventMode = 'none';
      this.plaques.addChild(tag);
    }
  }

  avatarView(id: string): AvatarView | undefined {
    return this.avatars.get(id);
  }

  /** Chamadas (Fase 49): quem está falando agora ganha um anel verde nos pés. */
  setSpeaking(sessionIds: ReadonlySet<string>): void {
    for (const [id, a] of this.avatars) a.setSpeaking(sessionIds.has(id));
  }

  /** Câmera até a pessoa e um círculo pulsando nos pés (achar alguém pela lista). */
  focusAvatar(id: string): boolean {
    const view = this.avatars.get(id);
    if (!view) return false;
    const p = this.world.toLocal(view.getGlobalPosition());
    this.camera.focusOn(p.x, p.y - 40);
    this.spotlightOn = { view, left: SPOTLIGHT_MS };
    return true;
  }

  private updateSpotlight(dtMs: number): void {
    const s = this.spotlightOn;
    const g = this.spotlight.clear();
    if (!s) return;
    s.left -= dtMs;
    if (s.left <= 0 || s.view.destroyed) {
      this.spotlightOn = null;
      return;
    }
    const p = this.world.toLocal(s.view.getGlobalPosition());
    const pulse = ((1 - s.left / SPOTLIGHT_MS) * 3) % 1;
    g.ellipse(p.x, p.y - 36, 22 + pulse * 16, 40 + pulse * 16).stroke({
      width: 3,
      color: 0x7aa7ff,
      alpha: 1 - pulse,
    });
  }

  /** Mostra (ou esconde) os nomes de todos, afastando os que se encostam. */
  setAllNames(on: boolean): void {
    if (this.allNames === on) return;
    this.allNames = on;
    for (const a of this.avatars.values()) {
      a.setNameVisible(on || a === this.hoveredAvatar);
      if (!on) a.setNameShift(0);
    }
    if (on) this.spreadNames();
  }

  /**
   * Nomes sem encavalar: de quem está mais na frente para trás, cada nome sobe até não
   * encostar nos já colocados.
   */
  private spreadNames(): void {
    const zoom = this.camera.zoom || 1;
    const items = [...this.avatars.values()].map((a) => {
      a.setNameShift(0);
      return { a, b: a.nameBounds() };
    });
    items.sort((p, q) => q.b.y - p.b.y);
    const placed: { x: number; y: number; width: number; height: number }[] = [];
    const hit = (r: (typeof placed)[0]) =>
      placed.some(
        (o) =>
          r.x < o.x + o.width &&
          o.x < r.x + r.width &&
          r.y < o.y + o.height &&
          o.y < r.y + r.height,
      );
    for (const { a, b } of items) {
      const r = { ...b };
      let shift = 0;
      for (let i = 0; i < 12 && hit(r); i++) {
        shift -= b.height + 1;
        r.y = b.y + shift;
      }
      a.setNameShift(shift / zoom);
      placed.push(r);
    }
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

  /** Tira o desenho da superfície (TV desligada). */
  clearSurface(furniId: string): void {
    this.furni.get(furniId)?.clearSurface();
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
    if (this.deskOwners.size) this.plaquesDirty = true;
    this.waitingDef.delete(id);
    this.pendingFurni.forget(id);
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

  toWorld(global: Point): { x: number; y: number } {
    return this.world.toLocal(global);
  }

  previewFurni(id: string, spot: Pick<PlacedFurni, 'x' | 'y' | 'z' | 'rot'>, track = true): void {
    const view = this.furni.get(id);
    if (!view) return;
    if (track) this.pendingFurni.start(id);
    view.update({ ...view.placed, ...spot });
    this.onFurniChanged();
  }

  settleFurni(id: string, result: FurniResult): void {
    const show = this.pendingFurni.finish(id, result.ok ? (result.furni ?? null) : null);
    const view = this.furni.get(id);
    if (!show || !view || show.defId !== view.def.id) return;
    view.update(show);
    this.onFurniChanged();
  }

  hideFurni(id: string, hidden: boolean): void {
    const view = this.furni.get(id);
    if (!view) return;
    view.visible = !hidden;
    for (const c of view.slices.values()) c.visible = !hidden;
    this.decor.refresh();
  }

  createGhost(defId: string, x: number, y: number, rot: number): FurniView {
    const def = this.deps.furniDefs.get(defId)!;
    const ghost = new FurniView(
      { id: '__fantasma__', defId, x, y, z: 0, rot },
      def,
      this.deps.loader,
      this.deps.placeholders,
      this.deps.furniVisuals,
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
   * Móvel sob o ponteiro: o desenho mais à frente com pixel visível no ponto. Sobre uma mesa, um
   * objeto pequeno em cima dela ganha mesmo com o ponteiro 1–3 px fora dele (antes pegava a mesa).
   * Sem pixel nenhum, vale o tile do móvel na altura em que ele está (sólido antes de tapete).
   */
  pickFurni(global: Point): FurniView | null {
    const views = [...this.furni.values()].filter((f) => f.visible);
    const front = (list: FurniView[]) => list.sort((a, b) => b.zIndex - a.zIndex)[0] ?? null;
    // Blocos e plataformas de pisar são bases como as mesas (Fase 56); só o tapete fica por baixo.
    const solid = views.filter((f) => !isRug(f.def) && !f.def.wall);
    const drawn = front(solid.filter((f) => f.hitTest(global)));
    if (drawn && acceptsOnTop(drawn.def)) {
      const placed = views.map((v) => v.placed);
      const onTop = new Set(stackedOn(drawn.placed, placed, this.deps.furniDefs).map((f) => f.id));
      const near = front(solid.filter((f) => onTop.has(f.placed.id) && this.hitNear(f, global)));
      if (near) return near;
    }
    if (drawn) return drawn;
    // Itens de parede ficam atrás de tudo que está no piso.
    const onWall = views.find((f) => f.def.wall && f.hitTest(global));
    if (onWall) return onWall;
    const nearby = front(solid.filter((f) => this.hitNear(f, global)));
    if (nearby) return nearby;
    const p = this.world.toLocal(global);
    const onTile = views.filter((f) => {
      if (f.def.wall) return false;
      const fp = f.footprint;
      for (let y = fp.minY; y <= fp.maxY; y++) {
        for (let x = fp.minX; x <= fp.maxX; x++) {
          if (pointInTile(p.x, p.y, x, y, f.placed.z)) return true;
        }
      }
      return false;
    });
    onTile.sort(
      (a, b) =>
        Number(isRug(a.def)) - Number(isRug(b.def)) ||
        b.placed.z - a.placed.z ||
        b.zIndex - a.zIndex,
    );
    return onTile[0] ?? null;
  }

  /** Pixel do desenho no ponto ou a até `PICK_SLACK_PX` dele. */
  private hitNear(f: FurniView, global: Point): boolean {
    if (f.hitTest(global)) return true;
    const r = PICK_SLACK_PX;
    for (const [dx, dy] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
      [r, r],
      [-r, r],
      [r, -r],
      [-r, -r],
    ] as const) {
      if (f.hitTest(global.clone().set(global.x + dx, global.y + dy))) return true;
    }
    return false;
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

  /** Câmera no próprio avatar (botão "centralizar em mim"). */
  centerOnSelf(): void {
    const view = this.localId ? this.avatars.get(this.localId) : undefined;
    if (!view) return this.camera.center();
    const p = this.world.toLocal(view.getGlobalPosition());
    // O ponto do avatar é o pé: sobe meio corpo para o rosto ficar no meio.
    this.camera.focusOn(p.x, p.y - 40);
  }

  addAvatar(id: string, snapshot: AvatarSnapshot, isLocal: boolean): void {
    if (this.avatars.has(id)) return this.updateAvatar(id, snapshot);
    const view = new AvatarView(id, snapshot, isLocal, (x, y) => this.grid.heightAt(x, y));
    if (this.deps.serverNow) view.serverNow = this.deps.serverNow;
    this.avatars.set(id, view);
    if (this.deps.effects) view.useEffects(this.deps.effects, snapshot.effect);
    if (isLocal) this.localId = id;
    view.setMeeting(this.busyRooms.has(this.layout.roomId));
    if (this.allNames) view.setNameVisible(true);
    this.objects.addChild(view);
    this.loadFrames(view, snapshot.figure);
  }

  updateAvatar(id: string, snapshot: AvatarSnapshot): void {
    const view = this.avatars.get(id);
    if (!view) return;
    view.applySnapshot(snapshot);
    this.avatarsDirty = true;
    if (view.figure !== snapshot.figure) this.loadFrames(view, snapshot.figure);
  }

  /** Busca (no cache por figure) as 8 texturas; ignora respostas de um visual já trocado. */
  private loadFrames(view: AvatarView, figure: string): void {
    view.figure = figure;
    void this.deps.avatars.get(figure).then((frames) => {
      if (!view.destroyed && view.figure === figure) view.setFrames(frames);
    });
    // Avatar montado: poses reais (sem ele, a animação simulada continua). Se não montou
    // (roupa nova que ainda não baixou, servidor ocupado), tenta de novo mais tarde.
    const attempt = (n: number) => {
      void this.deps.avatars.poser(figure).then((poser) => {
        if (view.destroyed || view.figure !== figure) return;
        if (poser) return view.setPoser(poser);
        view.setPoser(null);
        const wait = POSER_RETRY_MS[n];
        if (wait !== undefined) setTimeout(() => attempt(n + 1), wait);
      });
    };
    attempt(0);
  }

  /** Comemoração: efeito por alguns segundos sobre alguém. */
  flashEffect(sessionId: string, effect: EffectId, ms: number): void {
    this.avatars.get(sessionId)?.flashEffect(effect, ms);
  }

  /** Toca um emote no avatar de quem mandou. */
  playEmote(sessionId: string, emote: EmoteId): void {
    this.avatars.get(sessionId)?.playEmote(emote);
  }

  /** Toca aqui (Fase 54): os dois batem as mãos ao mesmo tempo, com brilho. */
  highFive(a: string, b: string): void {
    for (const id of [a, b]) {
      const view = this.avatars.get(id);
      if (!view) continue;
      view.playEmote('highfive');
      view.flashEffect('twinkle', HIGH_FIVE_SPARKLE_MS);
    }
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
    const pet = new PetView(
      id,
      snapshot,
      (x, y) => this.grid.heightAt(x, y),
      this.deps.furniVisuals,
    );
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
    this.avatarsDirty = true;
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
    for (const f of this.furni.values()) f.animate();
    this.updateSpotlight(dtMs);
    if (this.plaquesDirty) {
      this.plaquesDirty = false;
      this.drawPlaques();
    }
    if (this.allNames) {
      this.spreadTimer -= dtMs;
      if (this.spreadTimer <= 0) {
        this.spreadTimer = 250;
        this.spreadNames();
      }
    }
    for (const a of this.avatars.values()) a.update(dtMs);
    for (const p of this.pets.values()) p.update(dtMs);
    // Alguém entrou, andou ou saiu: o fantasma verde/vermelho do Decorar se atualiza (DE15).
    if (this.avatarsDirty) {
      this.avatarsDirty = false;
      if (this.decor.active) this.decor.refresh();
    }
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
    window.removeEventListener('blur', this.onWindowBlur);
    this.world.destroy({ children: true });
  }

  /** Reordena só quando alguma caixa muda (avatar troca de tile, móvel muda, alguém sai). */
  private sortDepth(): void {
    const boxes: DepthBox[] = [];
    const views = new Map<string, Container>();
    for (const [id, f] of this.furni) {
      if (f.def.wall) continue;
      boxes.push(f.depthBox);
      views.set(id, f);
      // Fatias da frente dos assentos: objetos à parte na mesma camada de ordenação.
      for (const sl of f.sliceBoxes) {
        if (sl.view.parent !== this.objects) this.objects.addChild(sl.view);
        sl.view.visible = f.visible;
        // Arrastando um sofá, braços e encosto ficam transparentes junto (DE13).
        sl.view.alpha = f.alpha;
        boxes.push(sl.box);
        views.set(sl.box.id, sl.view);
      }
    }
    for (const a of this.avatars.values()) boxes.push(a.depthBox);
    for (const p of this.pets.values()) boxes.push(p.depthBox);
    const key = boxes
      .map((b) => `${b.id}:${b.minX},${b.minY},${b.maxX},${b.maxY},${b.z}`)
      .join('|');
    if (key === this.depthKey) return;
    this.depthKey = key;

    for (const [id, a] of this.avatars) views.set(id, a);
    for (const p of this.pets.values()) views.set(p.label, p);
    depthOrder(boxes).forEach((id, i) => {
      const v = views.get(id);
      if (v) v.zIndex = i;
    });
    if (DEBUG) this.drawDebug(boxes);
  }

  // ---------- Entrada ----------

  /** Tile sob um ponto da tela, considerando a altura do piso (testa de frente para trás). */
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

  /**
   * Ponto de parede sob o ponteiro: a face de parede (do piso até o topo) que contém o ponto,
   * com a altura em unidades de altura (de 4 em 4 px).
   */
  pickWall(global: Point): WallSpot | null {
    const p = this.world.toLocal(global);
    const ctx = { map: this.map, doors: this.layout.doors };
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const z = tileHeight(this.map, x, y);
        if (z === null) continue;
        const [top, right, , left] = tileCorners(x, y, z);
        for (const rot of [2, 4] as const) {
          const [a, b] = rot === 2 ? [top, right] : [left, top];
          if (p.x < a.sx || p.x > b.sx || !hasWall(ctx, x, y, rot)) continue;
          const edgeY = a.sy + ((p.x - a.sx) * (b.sy - a.sy)) / (b.sx - a.sx);
          const px = edgeY - p.y;
          if (px < 0 || px > WALL_PX) continue;
          return { x, y, rot, h: Math.round(px / 4) * (4 / Z_UNIT) };
        }
      }
    }
    return null;
  }

  private handleTap(global: Point, info: TapInfo): void {
    if (this.decor.active) {
      return this.decor.tap({
        global,
        id: info.id,
        button: 0,
        buttons: 0,
        touch: info.touch,
        overScene: true,
      });
    }
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
      if (usable.def.interaction === 'tv') return this.actions.openTv(usable.placed.id);
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

  private onPointerUp(e: FederatedPointerEvent): void {
    this.decor.pointerUp(decorPointer(e));
  }

  /** A janela perdeu o foco no meio de um arrasto: o "soltar" não vai chegar. */
  private readonly onWindowBlur = (): void => this.decor.cancelDrag();

  /** O ponteiro foi para um painel HTML: esconde o nome e o destaque do tile. */
  private readonly onPointerLeave = (): void => {
    this.hoveredAvatar?.setNameVisible(false);
    this.hoveredAvatar = null;
    this.app.canvas.style.cursor = '';
    this.hover.clear();
    this.doorLabel.visible = false;
  };

  private onPointerMove(e: FederatedPointerEvent): void {
    this.decor.pointerMove(decorPointer(e));
    // Nome só de quem está sob o ponteiro.
    const avatar = this.decor.active ? null : this.pickAvatar(e.global);
    if (avatar !== this.hoveredAvatar) {
      if (!this.allNames) this.hoveredAvatar?.setNameVisible(false);
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

/** O ponteiro como o Decorar usa: qual dedo/botão, os botões apertados e se é toque. */
function decorPointer(e: FederatedPointerEvent): DecorPointer {
  return {
    global: e.global,
    id: e.pointerId,
    button: e.button,
    buttons: e.buttons,
    touch: e.pointerType === 'touch',
    overScene: (e.nativeEvent?.target as Element | null)?.tagName === 'CANVAS',
  };
}
