import { tileHeight, tileToScreen } from '@office/shared';
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
  /** Ponto da página no meio do desenho de um móvel. */
  furni(id: string): Point | null;
  furniList(): { id: string; defId: string; x: number; y: number }[];
  players(): { id: string; name: string; x: number; y: number; action: string }[];
  /** Que móvel o clique pegaria neste ponto da página (diagnóstico). */
  furniAt(x: number, y: number): string | null;
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
    furniAt: (x, y) => {
      const r = canvas();
      return scene.pickFurni(new PixiPoint(x - r.left, y - r.top))?.placed.id ?? null;
    },
    furniList: () =>
      [...room.state.furni.values()].map((f) => ({ id: f.id, defId: f.defId, x: f.x, y: f.y })),
    leave: async () => {
      await room.leave(true);
    },
    players: () =>
      [...room.state.players.entries()].map(([id, p]) => ({
        id,
        name: p.name,
        x: p.x,
        y: p.y,
        action: p.action,
      })),
  };
  (window as unknown as { __e2e: E2EHook }).__e2e = hook;
}
