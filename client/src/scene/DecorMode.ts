import {
  nextRotation,
  rotations,
  canPlace,
  canSetHeight,
  footprint,
  groupMoves,
  HEIGHT_STEP,
  isRug,
  surfaceTileAt,
  tileCorners,
  tileHeight,
  tileToScreen,
  WALL_PX,
  type FurniColorMessage,
  type FurniHeightMessage,
  type FurniManifestEntry,
  type FurniMoveMessage,
  type FurniPlaceMessage,
  type FurniResult,
  type Heightmap,
  type PlacedFurni,
  type PlacementContext,
  type TilePoint,
} from '@office/shared';
import type { Graphics, Point } from 'pixi.js';
import type { FurniView } from '../entities/FurniView.js';
import type { WallSpot } from './RoomScene.js';

/** Ações do Decorar: cada uma responde se o servidor aceitou (Fase 53). */
export interface DecorActions {
  placeFurni(msg: FurniPlaceMessage): Promise<FurniResult>;
  moveFurni(msg: FurniMoveMessage): Promise<FurniResult>;
  removeFurni(furniId: string): Promise<FurniResult>;
  colorFurni(msg: FurniColorMessage): Promise<FurniResult>;
  /** Ajuste fino de altura (Fase 56). */
  heightFurni(msg: FurniHeightMessage): Promise<FurniResult>;
}

/** Ponteiro como a cena repassa: qual dedo ou botão, se é toque e os botões apertados. */
export interface DecorPointer {
  global: Point;
  id: number;
  /** Botão que mudou (0 = o principal). */
  button: number;
  /** Botões apertados agora (0 = nenhum: o "soltar" se perdeu). */
  buttons: number;
  touch: boolean;
  /** Sobre a cena (e não sobre o painel ou outro elemento da página por cima dela). */
  overScene: boolean;
}

/** O que o modo decorar precisa da cena. */
export interface DecorHost {
  readonly map: Heightmap;
  readonly defs: ReadonlyMap<string, FurniManifestEntry>;
  /** Camada no piso: a grade de tiles. */
  readonly overlay: Graphics;
  /** Camada por cima dos móveis: fantasma e seleção, na altura do alvo (Fase 53). */
  readonly overlayTop: Graphics;
  /** Ponto da tela → ponto da cena. */
  toWorld(global: Point): { x: number; y: number };
  pickFurni(global: Point): FurniView | null;
  /** Ponto de parede sob o ponteiro (itens de parede). */
  pickWall(global: Point): WallSpot | null;
  furniView(id: string): FurniView | undefined;
  placementContext(): PlacementContext;
  /** Cria um móvel "fantasma" semitransparente por cima de tudo. */
  createGhost(defId: string, x: number, y: number, rot: number): FurniView;
  /**
   * Mostra já o resultado esperado de mover ou girar; o servidor confirma depois. `track = false`:
   * só mostra (um pedido já em andamento responde por ele).
   */
  previewFurni(id: string, spot: Pick<PlacedFurni, 'x' | 'y' | 'z' | 'rot'>, track?: boolean): void;
  /** O servidor respondeu: a tela fica com o aceito, ou volta ao que era. */
  settleFurni(id: string, result: FurniResult): void;
  /** Esconde (remoção esperando o servidor) ou mostra de novo (recusada). */
  hideFurni(id: string, hidden: boolean): void;
}

/** Móvel selecionado no modo decorar. */
export interface DecorSelection {
  id: string;
  name: string;
  defId: string;
  interaction?: string;
}

export interface DecorListener {
  onPickChange(defId: string | null): void;
  onSelectionChange(selected: DecorSelection | null): void;
  onError(message: string): void;
  /** No toque, o fantasma está num lugar e dá para confirmar ("Colocar aqui"). */
  onPlaceReady(ready: boolean): void;
  /** Altura do móvel selecionado (`null` = nenhum ou item de parede), para o painel (Fase 56). */
  onHeightChange(z: number | null): void;
}

const OK = 0x3fbf6f;
const BAD = 0xe05555;
const SELECT = 0x7aa7ff;
/** Fantasma num lugar que não dá: fica avermelhado (além do contorno). */
const BAD_TINT = 0xff8080;
/** Distância (px) a partir da qual pressionar um móvel vira arrastar. */
const DRAG_THRESHOLD = 5;
/** Dois cliques no mesmo lugar dentro disto colocam um móvel só (duplo clique). */
const DOUBLE_TAP_MS = 600;
/** Roda do mouse (px) para um passo de altura com Shift. */
const WHEEL_STEP = 50;
/** Intervalo mínimo entre pedidos de altura (o servidor aceita uns 4 por segundo). */
const HEIGHT_GAP_MS = 250;
/** O mesmo aviso de altura (limite) não se repete dentro disto, girando a roda. */
const HEIGHT_ERROR_MS = 1500;

interface Ghost {
  view: FurniView;
  defId: string;
  rot: number;
  tile: TilePoint | null;
  /** Itens de parede: altura acima do piso. */
  h?: number;
  /** Altura em que o fantasma aparece (a do apoio, válido ou não). */
  z: number;
  ok: boolean;
  reason?: string;
  /** Último alvo validado (para não refazer a validação a cada pixel do mouse). */
  key?: string;
}

/** Onde o fantasma está: tile (piso, com a altura da superfície) ou ponto de parede. */
type Target = { tile: TilePoint; rot?: number; h?: number; z?: number } | null;

interface Drag {
  furniId: string;
  pointerId: number;
  start: { x: number; y: number };
  /** Tile do móvel por onde ele foi pego (o mais perto do ponteiro), a partir da origem. */
  ref: TilePoint;
  /** Do centro desse tile (na altura do móvel) até o ponteiro, em px da cena. */
  offset: { x: number; y: number };
  /** Último ponto do ponteiro (para girar o fantasma com R sem mexer o mouse). */
  last: Point;
  ghost: Ghost | null;
  /** A pilha em cima do que é arrastado, que vai junto (Fase 56): fantasmas que acompanham. */
  carried: { id: string; view: FurniView }[];
}

/**
 * Modo "editar sala": escolher no catálogo e clicar para colocar, clicar num móvel para
 * selecionar, arrastar para mover, R para girar e Delete para remover. Valida no cliente
 * com as mesmas regras do servidor (`canPlace`) só para mostrar verde/vermelho; quem decide
 * é o servidor.
 *
 * Fase 53: o objeto arrastado acompanha o ponteiro pelo ponto em que foi pego (também pela parte
 * de cima, em cima de mesas e nos móveis altos do fundo) e só sobe numa mesa quando esse ponto
 * está sobre o tampo; mover, girar e remover aparecem na hora e voltam atrás se o servidor
 * recusar; R gira o fantasma durante o arrasto e Esc cancela.
 *
 * Fase 56: a pilha em cima do que se move vai junto (fantasmas no arrasto, prévia ao soltar ou
 * girar) e o selecionado sobe e desce de 0,1 em 0,1 (▲▼ no painel ou Shift + roda).
 */
export class DecorMode {
  active = false;
  private picking: Ghost | null = null;
  private selectedId: string | null = null;
  private drag: Drag | null = null;
  /** Colocações esperando o servidor (o mesmo lugar não recebe outra cópia nesse meio tempo). */
  private readonly placing = new Set<string>();
  private lastPlaced: { key: string; at: number } | null = null;
  /** Ajuste de altura: um pedido por vez; o último alvo pedido no meio espera a vez (Fase 56). */
  private heightBusy = false;
  private heightNext: { id: string; z: number } | null = null;
  /** Móveis seguros na tela (com o alvo que espera a vez) até o próximo pedido sair. */
  private heightHeld: string[] = [];
  private heightSentAt = -Infinity;
  private heightTimer = 0;
  private heightError: { reason: string; at: number } | null = null;
  private wheelAccum = 0;
  /** Última altura avisada ao painel. */
  private shownHeight: number | null | undefined;

  constructor(
    private readonly host: DecorHost,
    private readonly actions: DecorActions,
    private readonly listener: DecorListener,
  ) {
    document.addEventListener('keydown', this.onKey);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey);
    this.cancelAll();
  }

  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    if (!on) this.cancelAll();
    this.redraw();
  }

  /** Escolheu um item no catálogo: o fantasma passa a seguir o mouse. */
  pick(defId: string | null): void {
    this.endPicking();
    this.select(null);
    if (!defId || !this.host.defs.has(defId)) return this.listener.onPickChange(null);
    const def = this.host.defs.get(defId)!;
    this.picking = {
      view: this.host.createGhost(defId, -99, -99, def.directions[0] ?? 0),
      defId,
      rot: def.wall ? 2 : rotations(def)[0]!,
      tile: null,
      z: 0,
      ok: false,
    };
    this.picking.view.visible = false;
    this.listener.onPickChange(defId);
  }

  rotate(): void {
    const d = this.drag;
    if (d?.ghost) {
      // Arrastando: gira o fantasma (antes girava o móvel e o soltar desfazia o giro).
      const def = this.host.defs.get(d.ghost.defId)!;
      if (def.wall) return;
      d.ghost.rot = nextRotation(def, d.ghost.rot);
      return this.updateGhost(d.ghost, this.dragTarget(d, d.last), d.furniId);
    }
    if (this.picking) {
      const def = this.host.defs.get(this.picking.defId)!;
      // Item de parede vira junto com a parede: arraste para a outra parede.
      if (def.wall) return;
      this.picking.rot = nextRotation(def, this.picking.rot);
      this.updateGhost(this.picking, this.retarget(this.picking), undefined);
      return;
    }
    const f = this.selectedId ? this.host.furniView(this.selectedId) : undefined;
    if (!f) return;
    if (f.def.wall) {
      return this.listener.onError('Itens de parede viram com a parede: arraste para a outra.');
    }
    const rot = nextRotation(f.def, f.placed.rot);
    if (rot === f.placed.rot) return this.listener.onError('Esse móvel só tem uma direção.');
    const res = canPlace(this.host.placementContext(), { ...f.placed, rot, ignoreId: f.placed.id });
    if (!res.ok) return this.listener.onError(res.reason);
    this.commitMove(f, { x: f.placed.x, y: f.placed.y, rot }, res.z);
  }

  removeSelected(): void {
    const id = this.selectedId;
    if (!id) return;
    this.select(null);
    // Some já; se o servidor recusar (coisas em cima, alguém sentado), volta.
    this.host.hideFurni(id, true);
    void this.actions.removeFurni(id).then((res) => {
      if (!res.ok) this.host.hideFurni(id, false);
    });
  }

  /** Um móvel some do estado (removido por alguém). */
  forget(furniId: string): void {
    if (this.selectedId === furniId) this.select(null);
    if (this.drag?.furniId === furniId) this.cancelDrag();
  }

  /** Troca a cor do móvel selecionado (outra variação do mesmo móvel). */
  setColor(defId: string): void {
    const f = this.selectedId ? this.host.furniView(this.selectedId) : undefined;
    if (f && f.placed.defId !== defId) {
      void this.actions.colorFurni({ furniId: f.placed.id, defId });
    }
  }

  /** Móvel selecionado agora (`null` = nenhum). */
  get selected(): string | null {
    return this.selectedId;
  }

  /** Seleciona de novo um móvel recriado (trocou de cor). */
  reselect(furniId: string): void {
    if (this.active) this.select(furniId);
  }

  /** Algo mudou na sala (móvel/avatar): recalcula verde/vermelho. */
  refresh(): void {
    if (this.picking) {
      this.picking.key = undefined;
      this.updateGhost(this.picking, this.retarget(this.picking), undefined);
    }
    const d = this.drag;
    if (d?.ghost) {
      d.ghost.key = undefined;
      this.updateGhost(d.ghost, this.retarget(d.ghost), d.furniId);
    }
    this.redraw();
  }

  /** "Colocar aqui" (no toque, o toque só posiciona o fantasma). */
  confirmPlace(): void {
    this.placeGhost();
  }

  /** O fantasma de agora (colocando ou arrastando), para os testes. */
  ghostState(): { x: number; y: number; z: number; rot: number; ok: boolean } | null {
    const g = this.drag?.ghost ?? this.picking;
    return g?.tile && g.view.visible ? { ...g.tile, z: g.z, rot: g.rot, ok: g.ok } : null;
  }

  // ---------- Ponteiro (chamado pela cena) ----------

  /** Pressionou: se for num móvel (e não estiver colocando), começa um possível arrasto. */
  pointerDown(p: DecorPointer): boolean {
    // Só o botão principal: o direito/do meio deixava um arrasto "armado" (DE20).
    if (!this.active || this.picking || p.button !== 0) return false;
    const f = this.host.pickFurni(p.global);
    if (!f) return false;
    // Tapete só arrasta se já estiver selecionado: arrastar por cima dele move a câmera.
    if (isRug(f.def) && this.selectedId !== f.placed.id) return false;
    const w = this.host.toWorld(p.global);
    const ref = refTile(f, w);
    const c = tileToScreen(f.placed.x + ref.x, f.placed.y + ref.y, f.placed.z);
    this.drag = {
      furniId: f.placed.id,
      pointerId: p.id,
      start: { x: p.global.x, y: p.global.y },
      ref,
      offset: { x: w.x - c.sx, y: w.y - c.sy },
      last: p.global.clone(),
      ghost: null,
      carried: [],
    };
    return true;
  }

  pointerMove(p: DecorPointer): void {
    if (!this.active) return;
    if (this.picking) {
      // No toque não há "passar por cima": o fantasma fica onde foi tocado. Sobre o painel, o
      // fantasma fica onde estava (antes ia para trás do painel, longe do último lugar).
      if (!p.touch && p.overScene) {
        this.updateGhost(this.picking, this.targetAt(this.picking.defId, p.global), undefined);
      }
      return;
    }
    const d = this.drag;
    // Outro dedo (pinça) não mexe no arrasto.
    if (!d || p.id !== d.pointerId) return;
    // O "soltar" se perdeu (menu de contexto, janela trocada): cancela em vez de arrastar sozinho.
    if (!p.touch && p.buttons === 0) return this.cancelDrag();
    const f = this.host.furniView(d.furniId);
    if (!f) return this.cancelDrag();
    d.last = p.global.clone();
    if (!d.ghost) {
      if (Math.hypot(p.global.x - d.start.x, p.global.y - d.start.y) < DRAG_THRESHOLD) return;
      // Começa no próprio lugar: o primeiro passo na frente de uma mesa não sobe nela.
      d.ghost = {
        view: this.host.createGhost(f.placed.defId, f.placed.x, f.placed.y, f.placed.rot),
        defId: f.placed.defId,
        rot: f.placed.rot,
        tile: f.def.wall ? null : { x: f.placed.x, y: f.placed.y },
        z: f.placed.z,
        ok: false,
      };
      f.alpha = 0.3;
      // O que está em cima vai junto: fantasmas que acompanham o arrastado.
      if (!f.def.wall) {
        const ctx = this.host.placementContext();
        for (const c of groupMoves(ctx, f.placed, f.placed) ?? []) {
          const view = this.host.furniView(c.id);
          if (!view) continue;
          view.alpha = 0.3;
          d.carried.push({ id: c.id, view: this.host.createGhost(c.defId, c.x, c.y, c.rot) });
        }
      }
      this.select(d.furniId);
    }
    if (f.def.wall) {
      return this.updateGhost(d.ghost, this.targetAt(f.def.id, p.global), d.furniId);
    }
    this.updateGhost(d.ghost, this.dragTarget(d, p.global), d.furniId);
  }

  pointerUp(p?: DecorPointer): void {
    const d = this.drag;
    if (!d || (p && p.id !== d.pointerId)) return;
    this.drag = null;
    const f = this.host.furniView(d.furniId);
    if (f) f.alpha = 1;
    this.dropCarried(d);
    if (!d.ghost) {
      // Foi um clique: seleciona.
      this.select(d.furniId);
      return;
    }
    const g = d.ghost;
    g.view.destroy({ children: true });
    if (f && g.tile && g.ok) {
      this.commitMove(f, { x: g.tile.x, y: g.tile.y, rot: g.rot, h: g.h }, g.z);
    } else if (g.tile && g.reason) {
      this.listener.onError(g.reason);
    }
    this.redraw();
  }

  /** Clique ou toque sem arrasto (a câmera repassa). */
  tap(p: DecorPointer): void {
    if (!this.active) return;
    if (this.picking) {
      const g = this.picking;
      this.updateGhost(g, this.targetAt(g.defId, p.global), undefined);
      // No toque, tocar só posiciona o fantasma; o botão "Colocar aqui" confirma.
      if (p.touch) return this.listener.onPlaceReady(Boolean(g.tile));
      this.placeGhost();
      return;
    }
    // Clique num móvel que não arrastou (tapete, por exemplo): seleciona; no piso, desmarca.
    this.select(this.host.pickFurni(p.global)?.placed.id ?? null);
  }

  /** Cancela um arrasto em andamento (Esc, segundo dedo, janela perdeu o foco). */
  cancelDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const f = this.host.furniView(d.furniId);
    if (f) f.alpha = 1;
    this.dropCarried(d);
    d.ghost?.view.destroy({ children: true });
    this.redraw();
  }

  /** Roda do mouse com Shift: ajuste fino de altura do selecionado. `true` = usou a roda. */
  wheel(e: { shiftKey: boolean; deltaX: number; deltaY: number; deltaMode: number }): boolean {
    if (!this.active || !e.shiftKey || !this.selectedId || this.drag || this.picking) return false;
    // Com Shift, o macOS manda a roda como horizontal; em linhas (Firefox), cada linha vale ~40 px.
    this.wheelAccum += (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 40 : 1);
    if (Math.abs(this.wheelAccum) >= WHEEL_STEP) {
      this.nudgeHeight(this.wheelAccum < 0 ? 1 : -1);
      this.wheelAccum = 0;
    }
    return true;
  }

  /**
   * Ajuste fino de altura do selecionado (Fase 56), em `steps` passos de 0,1 (▲▼ no painel ou
   * Shift + roda). Aparece já. Os pedidos saem um por vez, no ritmo que o servidor aceita, sempre
   * com o último alvo (girar a roda rápido mandava um por passo e o servidor dizia "Calma!").
   */
  nudgeHeight(steps: number): void {
    const f = this.selectedId ? this.host.furniView(this.selectedId) : undefined;
    if (!this.active || !f || this.drag) return;
    if (f.def.wall) {
      return this.listener.onError('Itens de parede sobem e descem arrastando na parede.');
    }
    const z = Math.round((f.placed.z + steps * HEIGHT_STEP) * 10) / 10;
    const res = canSetHeight(this.host.placementContext(), f.placed.id, z);
    if (!res.ok) {
      // Girando a roda no limite: um aviso só, não um por passo.
      const now = performance.now();
      const last = this.heightError;
      if (last?.reason === res.reason && now - last.at < HEIGHT_ERROR_MS) return;
      this.heightError = { reason: res.reason, at: now };
      return this.listener.onError(res.reason);
    }
    const wait = this.heightSentAt + HEIGHT_GAP_MS - performance.now();
    // Com um alvo já esperando a vez (o relógio pode atrasar), o novo alvo entra no lugar dele.
    if (!this.heightBusy && !this.heightTimer && wait <= 0) {
      return this.sendHeight(f.placed.id, z, res.moves);
    }
    // Espera a vez: aparece já, e a tela fica segura (o estado que chegar não volta atrás).
    for (const m of res.moves) {
      const hold = !this.heightHeld.includes(m.id);
      this.host.previewFurni(m.id, m, hold);
      if (hold) this.heightHeld.push(m.id);
    }
    this.heightNext = { id: f.placed.id, z };
    if (!this.heightBusy) this.scheduleHeight();
    this.redraw();
  }

  // ---------- Interno ----------

  /** Coloca o fantasma do catálogo onde ele está. */
  private placeGhost(): void {
    const g = this.picking;
    if (!g) return;
    if (!g.tile) {
      if (this.host.defs.get(g.defId)?.wall) this.listener.onError('Isso vai na parede.');
      return;
    }
    if (!g.ok) return this.listener.onError(g.reason ?? 'Não dá para colocar aí.');
    // Duplo clique (ou um clique enquanto o servidor responde) no mesmo lugar: uma cópia só.
    const key = `${g.defId}:${g.tile.x},${g.tile.y}:${g.rot}:${g.h ?? ''}`;
    const now = performance.now();
    const again = this.lastPlaced?.key === key && now - this.lastPlaced.at < DOUBLE_TAP_MS;
    if (this.placing.has(key) || again) return;
    this.placing.add(key);
    this.lastPlaced = { key, at: now };
    void this.actions
      .placeFurni({ defId: g.defId, x: g.tile.x, y: g.tile.y, rot: g.rot as 0 | 2 | 4 | 6, z: g.h })
      .finally(() => this.placing.delete(key));
  }

  /** Move ou gira: aparece já (com a pilha em cima, Fase 56) e o servidor confirma. */
  private commitMove(
    f: FurniView,
    spot: { x: number; y: number; rot: number; h?: number },
    z: number,
  ): void {
    const id = f.placed.id;
    const to = { x: spot.x, y: spot.y, rot: spot.rot, z };
    const carried = f.def.wall
      ? []
      : (groupMoves(this.host.placementContext(), f.placed, to) ?? []);
    this.host.previewFurni(id, to);
    for (const c of carried) this.host.previewFurni(c.id, c);
    void this.actions
      .moveFurni({ furniId: id, x: spot.x, y: spot.y, rot: spot.rot as 0 | 2 | 4 | 6, z: spot.h })
      .then((res) => {
        this.host.settleFurni(id, res);
        for (const c of carried) this.host.settleFurni(c.id, resultFor(res, c.id));
      });
    this.redraw();
  }

  /** Pede a altura nova (o móvel e a pilha já aparecem lá). */
  private sendHeight(id: string, z: number, moves: readonly PlacedFurni[]): void {
    this.heightBusy = true;
    this.heightSentAt = performance.now();
    for (const m of moves) this.host.previewFurni(m.id, m);
    this.redraw();
    void this.actions.heightFurni({ furniId: id, z }).then((res) => {
      this.heightBusy = false;
      // Com um alvo esperando, os móveis seguem seguros: a tela não volta ao meio do caminho.
      for (const m of moves) this.host.settleFurni(m.id, resultFor(res, m.id));
      if (this.heightNext) this.scheduleHeight();
      this.redraw();
    });
  }

  /** O alvo que espera sai quando der (um pedido a cada `HEIGHT_GAP_MS`). */
  private scheduleHeight(): void {
    if (this.heightTimer) return;
    const wait = Math.max(0, this.heightSentAt + HEIGHT_GAP_MS - performance.now());
    this.heightTimer = window.setTimeout(() => {
      this.heightTimer = 0;
      const next = this.heightNext;
      const held = this.heightHeld;
      this.heightNext = null;
      this.heightHeld = [];
      // O pedido novo começa antes de soltar os móveis seguros: assim nada pisca.
      const again = next && canSetHeight(this.host.placementContext(), next.id, next.z);
      if (next && again?.ok) this.sendHeight(next.id, next.z, again.moves);
      for (const id of held) this.host.settleFurni(id, { ok: false });
      this.redraw();
    }, wait);
  }

  /** Fantasmas da pilha que acompanha o arrasto: no lugar de cada um em cima do fantasma. */
  private moveCarried(d: Drag): void {
    const g = d.ghost;
    const base = this.host.furniView(d.furniId);
    if (!d.carried.length || !g || !base) return;
    const moves =
      g.tile && g.view.visible
        ? groupMoves(this.host.placementContext(), base.placed, { ...g.tile, z: g.z, rot: g.rot })
        : null;
    for (const c of d.carried) {
      const m = moves?.find((mv) => mv.id === c.id);
      c.view.visible = Boolean(m);
      if (!m) continue;
      c.view.tint = g.ok ? 0xffffff : BAD_TINT;
      c.view.update({ ...m, id: c.view.placed.id });
    }
  }

  /** Fim do arrasto: tira os fantasmas da pilha e mostra os móveis de novo. */
  private dropCarried(d: Drag): void {
    for (const c of d.carried) {
      c.view.destroy({ children: true });
      const view = this.host.furniView(c.id);
      if (view) view.alpha = 1;
    }
    d.carried = [];
  }

  /** Alvo sob o ponteiro: ponto de parede para itens de parede, tile (com altura) para o resto. */
  private targetAt(defId: string, global: Point): Target {
    if (this.host.defs.get(defId)?.wall) {
      const spot = this.host.pickWall(global);
      return spot ? { tile: { x: spot.x, y: spot.y }, rot: spot.rot, h: spot.h } : null;
    }
    const w = this.host.toWorld(global);
    // Colocando, apontar para a frente de uma mesa mostra o objeto em cima dela (só o arrasto
    // fica onde estava, para não pular para o vizinho).
    const t = surfaceTileAt(this.host.placementContext(), w.x, w.y);
    return t ? { tile: { x: t.x, y: t.y }, z: t.z } : null;
  }

  /**
   * Alvo do arrasto: onde o tile por onde o móvel foi pego precisa estar para o ponto de pega
   * continuar sob o ponteiro, olhando a altura dos tampos (DE1–DE3). Antes valia o piso sob o
   * ponteiro: pela parte de cima, o objeto pulava para trás ou sumia (sobre a parede).
   */
  private dragTarget(d: Drag, global: Point): Target {
    const g = d.ghost;
    const def = g && this.host.defs.get(g.defId);
    if (!g || !def) return null;
    const w = this.host.toWorld(global);
    // A pilha que vai junto não é superfície: a coluna dela segurava o fantasma no lugar.
    const ctx = this.host.placementContext();
    const carried = new Set(d.carried.map((c) => c.id));
    const t = surfaceTileAt(
      carried.size ? { ...ctx, furni: ctx.furni.filter((f) => !carried.has(f.id)) } : ctx,
      w.x - d.offset.x,
      w.y - d.offset.y,
      d.furniId,
    );
    if (!t) return null;
    // Na frente ou na lateral de uma mesa (ou do vizinho alto): fica onde estava.
    if (t.face && g.tile) return this.retarget(g);
    // Girando no arrasto o footprint muda: o tile de pega continua dentro dele.
    const fp = footprint(def, 0, 0, g.rot);
    const ref = { x: Math.min(d.ref.x, fp.maxX), y: Math.min(d.ref.y, fp.maxY) };
    return { tile: { x: t.x - ref.x, y: t.y - ref.y }, z: t.z };
  }

  /** O alvo atual do fantasma (para recalcular sem mexer o ponteiro). */
  private retarget(g: Ghost): Target {
    return g.tile ? { tile: g.tile, h: g.h, z: g.z } : null;
  }

  private updateGhost(g: Ghost, target: Target, ignoreId: string | undefined): void {
    const tile = target?.tile ?? null;
    if (target?.rot !== undefined) g.rot = target.rot;
    const key = tile ? `${tile.x},${tile.y}:${g.rot}:${target?.h ?? ''}` : '';
    if (key && key === g.key) return;
    g.key = key;
    g.tile = tile;
    g.h = target?.h;
    if (!tile) {
      g.view.visible = false;
      g.ok = false;
      if (this.drag?.ghost === g) this.moveCarried(this.drag);
      this.redraw();
      return;
    }
    const res = canPlace(this.host.placementContext(), {
      defId: g.defId,
      x: tile.x,
      y: tile.y,
      rot: g.rot,
      z: g.h,
      ignoreId,
    });
    g.ok = res.ok;
    g.reason = res.ok ? undefined : res.reason;
    // Inválido continua na altura do alvo (antes descia para o chão, escondido atrás da mesa).
    const floor = tileHeight(this.host.map, tile.x, tile.y) ?? 0;
    g.z = res.ok ? res.z : (target?.z ?? floor + (g.h ?? 0));
    g.view.visible = true;
    g.view.tint = res.ok ? 0xffffff : BAD_TINT;
    g.view.update({
      id: g.view.placed.id,
      defId: g.defId,
      x: tile.x,
      y: tile.y,
      z: g.z,
      rot: g.rot,
    });
    if (this.drag?.ghost === g) this.moveCarried(this.drag);
    this.redraw();
  }

  private select(id: string | null): void {
    this.selectedId = id;
    const f = id ? this.host.furniView(id) : undefined;
    this.listener.onSelectionChange(
      f
        ? {
            id: f.placed.id,
            name: f.def.name,
            defId: f.placed.defId,
            interaction: f.def.interaction,
          }
        : null,
    );
    this.redraw();
  }

  private endPicking(): void {
    this.picking?.view.destroy({ children: true });
    this.picking = null;
    this.listener.onPlaceReady(false);
  }

  private cancelAll(): void {
    this.endPicking();
    this.cancelDrag();
    this.select(null);
    this.listener.onPickChange(null);
  }

  /** Grade no piso; fantasma (verde/vermelho) e seleção (azul) por cima dos móveis. */
  private redraw(): void {
    const floor = this.host.overlay.clear();
    const top = this.host.overlayTop.clear();
    if (!this.active) return;
    const ghost = this.picking ?? this.drag?.ghost ?? null;
    // Colocando ou arrastando: a grade de tiles do piso aparece (Fase 47).
    if (ghost) this.drawTileGrid(floor);
    if (ghost?.tile && ghost.view.visible) {
      const def = this.host.defs.get(ghost.defId);
      if (def) {
        this.drawFootprint(top, def, ghost.tile, ghost.rot, ghost.z, ghost.ok ? OK : BAD, true);
      }
    }
    const sel = this.selectedId ? this.host.furniView(this.selectedId) : undefined;
    if (sel?.visible && !this.drag?.ghost) {
      this.drawFootprint(top, sel.def, sel.placed, sel.placed.rot, sel.placed.z, SELECT, false);
    }
    this.showHeight(sel && !sel.def.wall ? sel.placed.z : null);
  }

  /** Avisa o painel quando a altura do selecionado muda. */
  private showHeight(z: number | null): void {
    const rounded = z === null ? null : Math.round(z * 10) / 10;
    if (rounded === this.shownHeight) return;
    this.shownHeight = rounded;
    this.listener.onHeightChange(rounded);
  }

  /** Contorno fraquinho de todos os tiles do piso. */
  private drawTileGrid(g: Graphics): void {
    const { width, height } = this.host.map;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const z = tileHeight(this.host.map, x, y);
        if (z === null || z === undefined) continue;
        const pts = tileCorners(x, y, z).flatMap((c) => [c.sx, c.sy]);
        g.poly(pts, true).stroke({ width: 1, color: 0xffffff, alpha: 0.18 });
      }
    }
  }

  /** Contorno do footprint na altura `z` (a do apoio: o tampo da mesa, não o piso). */
  private drawFootprint(
    g: Graphics,
    def: FurniManifestEntry,
    at: TilePoint,
    rot: number,
    z: number,
    color: number,
    fill: boolean,
  ): void {
    if (def.wall) {
      // Item de parede: destaca a face da parede daquele tile.
      const floor = tileHeight(this.host.map, at.x, at.y) ?? 0;
      const [top, right, , left] = tileCorners(at.x, at.y, floor);
      const [a, b] = rot === 4 ? [left, top] : [top, right];
      const pts = [a.sx, a.sy, b.sx, b.sy, b.sx, b.sy - WALL_PX, a.sx, a.sy - WALL_PX];
      if (fill) g.poly(pts).fill({ color, alpha: 0.25 });
      g.poly(pts, true).stroke({ width: 2, color, alpha: 0.9 });
      return;
    }
    const fp = footprint(def, at.x, at.y, rot);
    for (let y = fp.minY; y <= fp.maxY; y++) {
      for (let x = fp.minX; x <= fp.maxX; x++) {
        const pts = tileCorners(x, y, z).flatMap((c) => [c.sx, c.sy]);
        if (fill) g.poly(pts).fill({ color, alpha: 0.3 });
        g.poly(pts, true).stroke({ width: 2, color, alpha: 0.9 });
      }
    }
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if ((e.target as HTMLElement).closest('input, textarea, [role=dialog]')) return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      // Segurar R mandava dezenas de giros por segundo ("Calma!"): um giro por toque.
      if (!e.repeat) this.rotate();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!e.repeat) this.removeSelected();
    } else if (e.key === 'Escape') {
      if (this.drag) this.cancelDrag();
      else if (this.picking) this.pick(null);
      else this.select(null);
    }
  };
}

/** A parte da resposta de um pedido em grupo que fala de um móvel (a base ou um da pilha). */
function resultFor(res: FurniResult, id: string): FurniResult {
  if (!res.ok) return res;
  return {
    ok: true,
    furni: res.moved?.find((m) => m.id === id) ?? (res.furni?.id === id ? res.furni : undefined),
  };
}

/** Tile do footprint mais perto do ponto (na altura do móvel), a partir da origem. */
function refTile(f: FurniView, w: { x: number; y: number }): TilePoint {
  const fp = f.footprint;
  let best: TilePoint = { x: 0, y: 0 };
  let bestDist = Infinity;
  for (let y = fp.minY; y <= fp.maxY; y++) {
    for (let x = fp.minX; x <= fp.maxX; x++) {
      const c = tileToScreen(x, y, f.placed.z);
      const dist = Math.hypot(w.x - c.sx, (w.y - c.sy) * 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: x - f.placed.x, y: y - f.placed.y };
      }
    }
  }
  return best;
}
