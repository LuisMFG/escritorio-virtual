import {
  ballAt,
  DANCES,
  decodeBall,
  decodeJson,
  simulate,
  simulateShot,
  TILE_H,
  TILE_W,
  tileHeight,
  tileToScreen,
  type PoolAim,
  type PoolBalls,
  type PoolShotRecord,
} from '@office/shared';
import { pongViews } from './ui/pong.js';
import { poolTransform } from './ui/pool.js';
import { Point as PixiPoint } from 'pixi.js';
import type { OfficeRoomClient } from './net/OfficeConnection.js';
import type { RoomScene } from './scene/RoomScene.js';

/** Só com `?e2e=1` no endereço (testes de ponta a ponta). Fora disso não faz nada. */
const enabled = new URLSearchParams(location.search).has('e2e');

interface Point {
  x: number;
  y: number;
}

/** O que os testes de ponta a ponta leem da página (em `window.__e2e`). */
export interface E2EHook {
  roomId(): string;
  mySessionId(): string;
  /** Ponto da página (px) no meio de um tile, para clicar com o mouse de verdade. */
  tile(x: number, y: number): Point;
  /** Ponto da página numa parede: meio da aresta do tile (lado 2 ou 4), `h` acima do piso. */
  wall(x: number, y: number, rot: 2 | 4, h: number): Point;
  /** Que ponto de parede o modo decorar pegaria aqui (diagnóstico). */
  wallAt(x: number, y: number): { x: number; y: number; rot: number; h: number } | null;
  furniZ(id: string): number | null;
  /** Imagens das camadas que o móvel mostra agora (`null` = imagem estática do imager). */
  furniFrame(id: string): string | null;
  /** Pets na sala (espécie, paleta, cor e ação). */
  pets(): {
    owner: string;
    name: string;
    species: string;
    color: number;
    tint: string;
    action: string;
  }[];
  /** Ponto da página no meio do desenho de um móvel. */
  furni(id: string): Point | null;
  /** Ponto da página no meio do corpo de um avatar (sessão). */
  avatar(sessionId: string): Point | null;
  /** Direção em que o avatar está desenhado (a que se vê, não a do servidor). */
  avatarDir(sessionId: string): number | null;
  /** Quanto a cabeça está virada para quem falou (0 = olhando para a frente). */
  avatarLook(sessionId: string): number | null;
  /** Emote que o avatar está fazendo agora (Fase 54). */
  avatarEmote(sessionId: string): string | null;
  /** Dança e quadro que a tela mostra agora (Fase 55). */
  avatarDance(sessionId: string): { id: string; frame: number; frames: number } | null;
  furniList(): { id: string; defId: string; x: number; y: number; z: number }[];
  players(): {
    id: string;
    userId: string;
    name: string;
    x: number;
    y: number;
    dir: number;
    action: string;
    effect: string;
    handItem: number;
    figure: string;
  }[];
  /** Que móvel o clique pegaria neste ponto da página (diagnóstico). */
  furniAt(x: number, y: number): string | null;
  /** Onde a tela mostra o móvel agora (antes de o servidor confirmar um arrasto, Fase 53). */
  furniShown(id: string): { x: number; y: number; z: number; rot: number } | null;
  /** Fantasma do Decorar (colocando ou arrastando): tile, altura e se dá para soltar ali. */
  decorGhost(): { x: number; y: number; z: number; rot: number; ok: boolean } | null;
  /** Texto do placar que flutua sobre uma mesa do Salão de Jogos (Fase 57). */
  arcadeBoard(id: string): string | null;
  /** Ping-pong (Fase 58): o momento, a vez e a bola agora (na hora do servidor). */
  pong(id: string): {
    phase: string;
    turn: string;
    scoreA: number;
    scoreB: number;
    setsA: number;
    setsB: number;
    ball: { x: number; y: number; h: number; by: string; na: number; nb: number } | null;
    /** Onde está a raquete de cada vaga (a última posição que chegou ao servidor). */
    paddles: Record<string, { x: number; y: number }>;
  } | null;
  /** Ponto da mesa de ping-pong (metros, e a altura) na tela, como a pessoa vê no painel aberto. */
  pongPoint(x: number, y: number, h?: number): Point | null;
  /**
   * Sinuca (Fase 59): a vez, as regras, as bolas paradas e a última tacada; `final` é onde a
   * simulação desta página põe as bolas com a tacada gravada (tem que bater com `balls`).
   */
  pool(id: string): {
    status: string;
    phase: string;
    turn: string;
    inHand: boolean;
    breakShot: boolean;
    groupA: string;
    scoreA: number;
    scoreB: number;
    detail: string;
    balls: PoolBalls | null;
    shot: { t0: number; ms: number } | null;
    final: PoolBalls | null;
    /** Mira ao vivo de quem taca, como os outros a recebem (a branca e a direção). */
    aim: PoolAim | null;
  } | null;
  /** Ponto da mesa de sinuca (metros) na tela, no painel aberto. */
  poolPoint(x: number, y: number): Point | null;
  /** Ponto da barra de força (0 = em cima, 1 = embaixo) na tela, no painel aberto. */
  poolPower(f: number): Point | null;
  /** Aproxima a câmera (nível de zoom) e centraliza num tile. */
  look(x: number, y: number, zoom: number): void;
  /** Sai da sala de verdade (fechar a aba deixaria o avatar parado 30 s esperando reconexão). */
  leave(): Promise<void>;
}

/**
 * Gancho para os testes: a cena é um canvas (sem elementos para clicar), então os testes
 * perguntam aqui onde fica cada tile ou móvel na tela e clicam com o mouse ali.
 */
export function exposeForTests(
  scene: RoomScene,
  room: OfficeRoomClient,
  now: () => number = Date.now,
): void {
  if (!enabled) return;
  // Com a janela flutuante aberta, a sala está nela (e as coordenadas são as de lá).
  const canvas = () =>
    (window.documentPictureInPicture?.window?.document.querySelector('.pip-canvas-box canvas') ??
      document.querySelector('canvas'))!.getBoundingClientRect();
  const toPage = (p: Point): Point => {
    const g = scene.world.toGlobal(p);
    const r = canvas();
    return { x: Math.round(r.left + g.x), y: Math.round(r.top + g.y) };
  };
  const hook: E2EHook = {
    roomId: () => room.state.roomId,
    mySessionId: () => room.sessionId,
    tile: (x, y) => {
      const c = tileToScreen(x, y, tileHeight(scene.map, x, y) ?? 0);
      return toPage({ x: c.sx, y: c.sy });
    },
    wall: (x, y, rot, h) => {
      const c = tileToScreen(x, y, (tileHeight(scene.map, x, y) ?? 0) + h);
      return toPage({ x: c.sx + ((rot === 4 ? -1 : 1) * TILE_W) / 4, y: c.sy - TILE_H / 4 });
    },
    wallAt: (x, y) => {
      const r = canvas();
      return scene.pickWall(new PixiPoint(x - r.left, y - r.top));
    },
    furniZ: (id) => room.state.furni.get(id)?.z ?? null,
    furniFrame: (id) => scene.furniView(id)?.layeredFrame ?? null,
    pets: () =>
      [...room.state.pets.values()].map((p) => ({
        owner: p.ownerName,
        name: p.name,
        species: p.species,
        color: p.color,
        tint: p.tint,
        action: p.action,
      })),
    furni: (id) => {
      const view = scene.furniView(id);
      if (!view) return null;
      const b = view.getBounds();
      const r = canvas();
      return {
        x: Math.round(r.left + b.x + b.width / 2),
        y: Math.round(r.top + b.y + b.height / 2),
      };
    },
    avatar: (id) => {
      const view = scene.avatarView(id);
      if (!view) return null;
      const c = view.bodyCenter();
      const r = canvas();
      return { x: Math.round(r.left + c.x), y: Math.round(r.top + c.y) };
    },
    avatarDir: (id) => scene.avatarView(id)?.dir ?? null,
    avatarLook: (id) => scene.avatarView(id)?.lookingTurn ?? null,
    avatarEmote: (id) => scene.avatarView(id)?.currentEmote ?? null,
    avatarDance: (id) => {
      const d = scene.avatarView(id)?.currentDance;
      return d ? { ...d, frames: DANCES[d.id].anim.frames.length } : null;
    },
    furniShown: (id) => {
      const p = scene.furniView(id)?.placed;
      return p ? { x: p.x, y: p.y, z: p.z, rot: p.rot } : null;
    },
    arcadeBoard: (id) => scene.arcadeBoardText(id),
    pong: (id) => {
      const g = room.state.arcade.get(id);
      if (!g) return null;
      const seg = decodeBall(g.ball);
      const sim = seg && g.phase !== 'serve' ? simulate(seg, now(), true).ball : null;
      const at = sim ? ballAt(sim, now()) : null;
      return {
        phase: g.phase,
        turn: g.turn,
        scoreA: g.scoreA,
        scoreB: g.scoreB,
        setsA: g.setsA,
        setsB: g.setsB,
        ball: at && sim ? { x: at.x, y: at.y, h: at.h, by: sim.by, na: sim.na, nb: sim.nb } : null,
        paddles: Object.fromEntries(
          (['a1', 'a2', 'b1', 'b2'] as const).map((s) => [s, { x: g[`${s}Px`], y: g[`${s}Py`] }]),
        ),
      };
    },
    pongPoint: (x, y, h) => {
      const c = document.querySelector<HTMLCanvasElement>('.arcade-panel.live .arcade-court');
      const view = c && pongViews.get(c);
      return view ? view.screenPoint(x, y, h ?? 0) : null;
    },
    pool: (id) => {
      const g = room.state.arcade.get(id);
      if (!g) return null;
      const shot = decodeJson<PoolShotRecord>(g.shot);
      return {
        status: g.status,
        phase: g.phase,
        turn: g.turn,
        inHand: g.inHand,
        breakShot: g.breakShot,
        groupA: g.groupA,
        scoreA: g.scoreA,
        scoreB: g.scoreB,
        detail: g.detail,
        balls: decodeJson<PoolBalls>(g.balls),
        shot: shot ? { t0: shot.t0, ms: shot.ms } : null,
        final: shot ? simulateShot(shot.start, shot).final : null,
        aim: decodeJson<PoolAim>(g.aim),
      };
    },
    poolPoint: (x, y) => {
      const c = document.querySelector<HTMLCanvasElement>('.arcade-panel.live .arcade-court');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const p = poolTransform(r.width).toPx([x, y]);
      return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
    },
    poolPower: (f) => {
      const c = document.querySelector<HTMLCanvasElement>('.arcade-panel.live .arcade-court');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const b = poolTransform(r.width).bar;
      return { x: Math.round(r.left + b.x + b.w / 2), y: Math.round(r.top + b.y + b.h * f) };
    },
    decorGhost: () => {
      const g = scene.decor.ghostState();
      return g ? { ...g } : null;
    },
    look: (x, y, zoom) => {
      while (scene.camera.zoom < zoom - 0.001) scene.camera.zoomIn();
      const c = tileToScreen(x, y, tileHeight(scene.map, x, y) ?? 0);
      scene.camera.lookAt(c.sx, c.sy);
    },
    furniAt: (x, y) => {
      const r = canvas();
      return scene.pickFurni(new PixiPoint(x - r.left, y - r.top))?.placed.id ?? null;
    },
    furniList: () =>
      [...room.state.furni.values()].map((f) => ({
        id: f.id,
        defId: f.defId,
        x: f.x,
        y: f.y,
        z: f.z,
      })),
    leave: async () => {
      await room.leave(true);
    },
    players: () =>
      [...room.state.players.entries()].map(([id, p]) => ({
        id,
        userId: p.userId,
        name: p.name,
        x: p.x,
        y: p.y,
        dir: p.dir,
        action: p.action,
        effect: p.effect,
        handItem: p.handItem,
        figure: p.figure,
      })),
  };
  (window as unknown as { __e2e: E2EHook; __e2eScene: RoomScene }).__e2e = hook;
  // Diagnóstico no console (só com ?e2e=1).
  (window as unknown as { __e2eScene: RoomScene }).__e2eScene = scene;
}
