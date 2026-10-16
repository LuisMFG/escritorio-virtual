import './style.css';
import {
  parseAvatarManifest,
  parseFurniManifest,
  RECEPTION,
  type FurniManifestEntry,
} from '@office/shared';
import { Application, TextureSource } from 'pixi.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { AvatarTextureCache, ImagerAvatarRenderer } from './assets/AvatarTextureCache.js';
import { PlaceholderFactory } from './assets/PlaceholderFactory.js';
import { OFFLINE_ASSETS } from './config.js';
import { RoomScene } from './scene/RoomScene.js';
import { mountHud } from './ui/hud.js';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não foi possível carregar ${url} (HTTP ${res.status})`);
  return res.json();
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
  const avatars = new AvatarTextureCache(
    new ImagerAvatarRenderer(loader, placeholders, avatarManifest.imager),
  );
  const furniDefs = new Map<string, FurniManifestEntry>(furniManifest.items.map((i) => [i.id, i]));

  const scene = new RoomScene(app, RECEPTION, { loader, placeholders, avatars, furniDefs });
  mountHud({ roomName: RECEPTION.name, camera: scene.camera, loader });
  await scene.load(avatarManifest.defaults.M);
  app.ticker.add((ticker) => scene.update(ticker.deltaMS));

  if (import.meta.env.DEV) Object.assign(window, { __office: { app, scene } });
}

start().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `Não foi possível iniciar o escritório: ${(err as Error).message}`;
  document.body.append(box);
});
