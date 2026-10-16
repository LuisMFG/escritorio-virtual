import './style.css';
import { Callbacks } from '@colyseus/sdk';
import {
  parseAvatarManifest,
  parseFurniManifest,
  RECEPTION,
  type FurniManifestEntry,
  type Player,
  type RoomLayoutMessage,
  type SessionResponse,
} from '@office/shared';
import { Application, TextureSource } from 'pixi.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { AvatarTextureCache, ImagerAvatarRenderer } from './assets/AvatarTextureCache.js';
import { PlaceholderFactory } from './assets/PlaceholderFactory.js';
import { OFFLINE_ASSETS } from './config.js';
import type { AvatarSnapshot } from './entities/AvatarView.js';
import { isSessionError, OfficeConnection, type OfficeRoomClient } from './net/OfficeConnection.js';
import { forgetToken } from './net/storage.js';
import { RoomScene, type SceneDeps } from './scene/RoomScene.js';
import { mountHud } from './ui/hud.js';
import { showLogin } from './ui/login.js';
import { Overlay } from './ui/overlay.js';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não foi possível carregar ${url} (HTTP ${res.status})`);
  return res.json();
}

function snapshot(p: Player): AvatarSnapshot {
  return {
    name: p.name,
    figure: p.figure,
    x: p.x,
    y: p.y,
    nextX: p.nextX,
    nextY: p.nextY,
    dir: p.dir,
    away: p.away,
  };
}

async function start(): Promise<void> {
  TextureSource.defaultOptions.scaleMode = 'nearest';

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x1b1d24,
    antialias: false,
    roundPixels: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById('app')!.appendChild(app.canvas);

  const [furniManifest, avatarManifest] = await Promise.all([
    fetchJson('/assets/furni/manifest.json').then(parseFurniManifest),
    fetchJson('/assets/avatar/manifest.json').then(parseAvatarManifest),
  ]);

  const loader = new AssetLoader(OFFLINE_ASSETS);
  const placeholders = new PlaceholderFactory(app.renderer, avatarManifest);
  const deps: SceneDeps = {
    loader,
    placeholders,
    avatars: new AvatarTextureCache(
      new ImagerAvatarRenderer(loader, placeholders, avatarManifest.imager),
    ),
    furniDefs: new Map<string, FurniManifestEntry>(furniManifest.items.map((i) => [i.id, i])),
  };

  let scene: RoomScene | undefined;
  const overlay = new Overlay();
  const hud = mountHud({ getCamera: () => scene?.camera, loader });
  hud.setRoomName(RECEPTION.name);
  app.ticker.add((ticker) => scene?.update(ticker.deltaMS));

  async function mountRoom(
    connection: OfficeConnection,
    room: OfficeRoomClient,
    layout: RoomLayoutMessage,
  ): Promise<void> {
    scene?.destroy();
    const s = new RoomScene(app, layout, deps, (tile) => connection.move(tile));
    scene = s;
    hud.setRoomName(layout.name);
    await s.load();
    if (scene !== s) return;

    const refreshPeople = () =>
      overlay.setPeople(
        [...room.state.players.entries()].map(([id, p]) => ({
          id,
          name: p.name,
          away: p.away,
          isLocal: id === room.sessionId,
        })),
      );
    const cb = Callbacks.get(room);
    cb.onAdd('players', (player, id) => {
      s.addAvatar(id, snapshot(player), id === room.sessionId);
      cb.onChange(player, () => {
        s.updateAvatar(id, snapshot(player));
        refreshPeople();
      });
      refreshPeople();
    });
    cb.onRemove('players', (_player, id) => {
      s.removeAvatar(id);
      refreshPeople();
    });
  }

  async function enter(session: SessionResponse): Promise<void> {
    const connection: OfficeConnection = new OfficeConnection({
      status: (status, detail) => overlay.setStatus(status, detail),
      serverError: (err) => overlay.notify(err.message),
      sessionInvalid: () => {
        forgetToken();
        location.reload();
      },
      joined: (room, layout) => void mountRoom(connection, room, layout),
    });
    await connection.join(RECEPTION.id, session.token);
    // Saída "educada" ao fechar/recarregar: o servidor remove o avatar na hora.
    window.addEventListener('pagehide', () => void connection.leave());
    if (import.meta.env.DEV)
      Object.assign(window, { __office: { app, connection, getScene: () => scene } });
  }

  let notice: string | undefined;
  for (;;) {
    const session = await showLogin({ defaultFigure: avatarManifest.defaults.M, notice });
    try {
      await enter(session);
      return;
    } catch (err) {
      overlay.setStatus('offline');
      if (isSessionError(err)) {
        forgetToken();
        notice = 'Sua sessão expirou. Entre novamente com o código de convite.';
      } else {
        notice = `Não foi possível entrar na sala: ${(err as Error).message}`;
      }
    }
  }
}

start().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `Não foi possível iniciar o escritório: ${(err as Error).message}`;
  document.body.append(box);
});
