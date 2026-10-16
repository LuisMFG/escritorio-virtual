import type { AssetLoader, AssetStats } from '../assets/AssetLoader.js';
import type { Camera } from '../scene/Camera.js';

/** Interface fixa da Fase 1: nome da sala, status dos assets e controles de zoom. */
export function mountHud(opts: { roomName: string; camera: Camera; loader: AssetLoader }): void {
  const card = document.createElement('header');
  card.className = 'hud-card';
  const title = document.createElement('h1');
  title.textContent = opts.roomName;
  const hint = document.createElement('p');
  hint.textContent =
    'Clique no piso para andar. Arraste para mover a câmera e use a roda do mouse para o zoom.';
  card.append(title, hint);

  const status = document.createElement('div');
  status.className = 'hud-status';
  status.setAttribute('role', 'status');
  opts.loader.onChange((stats) => renderStatus(status, stats));

  const zoom = document.createElement('div');
  zoom.className = 'hud-zoom';
  zoom.append(
    button('+', 'Aproximar', () => opts.camera.zoomIn()),
    button('−', 'Afastar', () => opts.camera.zoomOut()),
    button('⌖', 'Centralizar a sala', () => opts.camera.center()),
  );

  document.body.append(card, status, zoom);
}

function renderStatus(el: HTMLElement, stats: AssetStats): void {
  if (stats.offline) {
    el.dataset.state = 'fallback';
    el.textContent = 'Arte provisória (modo offline)';
  } else if (stats.failed > 0) {
    el.dataset.state = 'fallback';
    el.textContent = `HabboAssets indisponível em ${stats.failed} item(ns) — usando arte provisória`;
  } else {
    el.dataset.state = 'ok';
    el.textContent = 'Assets: HabboAssets (Habbo BR)';
  }
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}
