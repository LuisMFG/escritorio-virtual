import { layoutMap, type MapRoom } from '@office/shared';
import type { OnlineInfo } from '../net/LobbyConnection.js';
import { mapApi } from '../net/api.js';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

const CARD_W = 200;
const CARD_H = 150;
const GAP_X = 56;
const GAP_Y = 48;
const STATUS_LABEL: Record<string, string> = { busy: 'ocupado', away: 'ausente' };

export interface MinimapOptions {
  token: string;
  myUserId: string;
  currentRoomId(): string;
  people(): OnlineInfo[];
  /** Título da reunião acontecendo em cada sala (vazio = livre). */
  meetingOf(roomId: string): string;
  goToRoom(roomId: string): void;
  goToPerson(person: OnlineInfo): void;
}

/**
 * Minimapa: as salas como cartões ligados pelas portas, com quem está em cada uma (ao vivo).
 * Clicar na sala vai até ela; clicar numa pessoa vai até a sala dela e chega perto.
 */
export function openMinimap(opts: MinimapOptions): { refresh(): void; close(): void } {
  const backdrop = el('div', { className: 'modal-backdrop' });
  backdrop.innerHTML = `
    <section class="sheet sheet-wide minimap" role="dialog" aria-modal="true" aria-labelledby="map-title">
      <header class="sheet-head">
        <h2 id="map-title">🗺️ Mapa do escritório</h2>
        <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
      </header>
      <div class="sheet-body"><div class="minimap-fit"><div class="minimap-board"><p class="muted">Carregando…</p></div></div></div>
    </section>`;
  document.body.append(backdrop);
  const board = backdrop.querySelector<HTMLElement>('.minimap-board')!;
  const fit = backdrop.querySelector<HTMLElement>('.minimap-fit')!;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('.sheet-close')!.addEventListener('click', close);

  let rooms: MapRoom[] = [];
  const render = () => {
    const pos = layoutMap(rooms);
    const cols = Math.max(1, ...[...pos.values()].map((c) => c.col + 1));
    const rows = Math.max(1, ...[...pos.values()].map((c) => c.row + 1));
    const width = cols * CARD_W + (cols - 1) * GAP_X;
    const height = rows * CARD_H + (rows - 1) * GAP_Y;
    board.style.width = `${width}px`;
    board.style.height = `${height}px`;
    const at = (id: string) => {
      const c = pos.get(id)!;
      return { x: c.col * (CARD_W + GAP_X), y: c.row * (CARD_H + GAP_Y) };
    };

    // Linhas das portas (uma por par de salas).
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'minimap-links');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    const drawn = new Set<string>();
    for (const r of rooms) {
      for (const l of r.links) {
        const pair = [r.id, l.to].sort().join('|');
        if (drawn.has(pair) || !pos.has(l.to)) continue;
        drawn.add(pair);
        const a = at(r.id);
        const b = at(l.to);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(a.x + CARD_W / 2));
        line.setAttribute('y1', String(a.y + CARD_H / 2));
        line.setAttribute('x2', String(b.x + CARD_W / 2));
        line.setAttribute('y2', String(b.y + CARD_H / 2));
        svg.append(line);
      }
    }

    const current = opts.currentRoomId();
    const everyone = opts.people();
    const cards = rooms.map((r) => {
      const p = at(r.id);
      const card = el('article', { className: `minimap-room${r.id === current ? ' here' : ''}` });
      card.style.left = `${p.x}px`;
      card.style.top = `${p.y}px`;
      card.style.width = `${CARD_W}px`;
      card.style.height = `${CARD_H}px`;
      const go = el('button', {
        type: 'button',
        className: 'minimap-room-name',
        textContent: r.name,
      });
      go.setAttribute(
        'aria-label',
        r.id === current ? `${r.name} (você está aqui)` : `Ir para ${r.name}`,
      );
      go.disabled = r.id === current;
      go.addEventListener('click', () => {
        close();
        opts.goToRoom(r.id);
      });
      const head = el('header');
      head.append(go);
      if (r.id === current)
        head.append(el('span', { className: 'tag', textContent: 'você está aqui' }));
      card.append(head);
      const meeting = opts.meetingOf(r.id);
      if (meeting)
        card.append(
          el('p', { className: 'minimap-meeting', textContent: `🔴 Em reunião: ${meeting}` }),
        );
      const here = everyone.filter((x) => x.roomId === r.id);
      const list = el('ul', { className: 'minimap-people' });
      for (const person of here) {
        const li = el('li');
        const b = el('button', {
          type: 'button',
          className: `minimap-person status-${person.status}`,
          textContent: person.userId === opts.myUserId ? `${person.name} (você)` : person.name,
          title: person.activity || STATUS_LABEL[person.status] || '',
        });
        b.disabled = person.userId === opts.myUserId;
        b.setAttribute(
          'aria-label',
          person.userId === opts.myUserId ? `${person.name} (você)` : `Ir até ${person.name}`,
        );
        b.addEventListener('click', () => {
          close();
          opts.goToPerson(person);
        });
        li.append(b);
        list.append(li);
      }
      if (here.length === 0)
        list.append(el('li', { className: 'muted', textContent: 'Ninguém aqui agora' }));
      card.append(list);
      return card;
    });
    board.replaceChildren(svg, ...cards);
    // Escritório grande: o mapa encolhe para caber na largura da janela.
    const scale = Math.min(1, fit.clientWidth / width);
    board.style.transform = `scale(${scale})`;
    fit.style.height = `${Math.ceil(height * scale)}px`;
  };

  mapApi
    .get(opts.token)
    .then((r) => {
      rooms = r;
      render();
    })
    .catch(() =>
      board.replaceChildren(
        el('p', { className: 'login-error', textContent: 'Não foi possível carregar o mapa.' }),
      ),
    );
  return { refresh: () => rooms.length && render(), close };
}
