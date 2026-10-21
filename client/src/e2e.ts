import { TILE_H, TILE_W, tileHeight, tileToScreen } from '@office/shared';
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
  furniList(): { id: string; defId: string; x: number; y: number; z: number }[];
  players(): {
    id: string;
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
  /** Aproxima a câmera (nível de zoom) e centraliza num tile. */
  look(x: number, y: number, zoom: number): void;
  /** Sai da sala de verdade (fechar a aba deixaria o avatar parado 30 s esperando reconexão). */
  leave(): Promise<void>;
}

/**
 * Gancho para os testes: a cena é um canvas (sem elementos para clicar), então os testes
 * perguntam aqui onde fica cada tile ou móvel na tela e clicam com o mouse ali.
 */
export function exposeForTests(scene: RoomScene, room: OfficeRoomClient): void {
  if (!enabled) return;
  const canvas = () => document.querySelector('canvas')!.getBoundingClientRect();
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
    furniShown: (id) => {
      const p = scene.furniView(id)?.placed;
      return p ? { x: p.x, y: p.y, z: p.z, rot: p.rot } : null;
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
