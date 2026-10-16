import type { AssetLoader, AssetStats } from '../assets/AssetLoader.js';
import type { Camera } from '../scene/Camera.js';

export interface Hud {
  setRoomName(name: string): void;
  setDecorating(on: boolean): void;
}

/** Nome da sala, status dos assets e controles de zoom (que agem sobre a cena atual). */
export function mountHud(opts: {
  getCamera: () => Camera | undefined;
  loader: AssetLoader;
  onEditAvatar: () => void;
  onToggleDecor: () => void;
}): Hud {
  const card = document.createElement('header');
  card.className = 'hud-card';
  const title = document.createElement('h1');
  const hint = document.createElement('p');
  hint.textContent =
    'Clique no piso para andar · Enter para conversar · arraste para mover a câmera.';
  card.append(title, hint);

  const status = document.createElement('div');
  status.className = 'hud-status';
  status.setAttribute('role', 'status');
  opts.loader.onChange((stats) => renderStatus(status, stats));

  const zoom = document.createElement('div');
  zoom.className = 'hud-zoom';
  zoom.append(
    button('+', 'Aproximar', () => opts.getCamera()?.zoomIn()),
    button('−', 'Afastar', () => opts.getCamera()?.zoomOut()),
    button('⌖', 'Centralizar a sala', () => opts.getCamera()?.center()),
  );

  const avatarBtn = document.createElement('button');
  avatarBtn.type = 'button';
  avatarBtn.className = 'hud-avatar btn-secondary';
  avatarBtn.textContent = 'Meu visual';
  avatarBtn.addEventListener('click', opts.onEditAvatar);

  const decorBtn = document.createElement('button');
  decorBtn.type = 'button';
  decorBtn.className = 'hud-decor btn-secondary';
  decorBtn.textContent = 'Decorar';
  decorBtn.setAttribute('aria-pressed', 'false');
  decorBtn.addEventListener('click', opts.onToggleDecor);

  document.body.append(card, status, zoom, avatarBtn, decorBtn);
  return {
    setDecorating(on) {
      decorBtn.textContent = on ? 'Concluir decoração' : 'Decorar';
      decorBtn.setAttribute('aria-pressed', String(on));
    },
    setRoomName(name) {
      title.textContent = name;
      document.title = `${name} · Escritório Virtual`;
    },
  };
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
