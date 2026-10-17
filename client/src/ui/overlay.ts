import { STATUS_LABELS, STATUSES, type Status } from '@office/shared';
import type { ConnectionStatus } from '../net/OfficeConnection.js';
import { cargoPill } from './profile.js';

export interface PersonEntry {
  id: string;
  name: string;
  away: boolean;
  isLocal: boolean;
  status: string;
  cargo: string;
  cargoColor: string;
  birthday: boolean;
}

export interface OtherRoom {
  roomId: string;
  name: string;
  people: { name: string }[];
}

function tag(text: string): HTMLSpanElement {
  return Object.assign(document.createElement('span'), { className: 'tag', textContent: text });
}

/**
 * Lista de pessoas (recolhível): quem está nesta sala, ao vivo pelo estado, e quem está
 * nas outras salas (via `/api/presence`). Também a faixa de conexão, o fade de troca de
 * sala e avisos rápidos.
 */
export class Overlay {
  private readonly people = document.createElement('details');
  private readonly peopleSummary = document.createElement('summary');
  private readonly peopleBody = document.createElement('div');
  private readonly statusSelect = document.createElement('select');
  private readonly banner = document.createElement('div');
  private readonly toast = document.createElement('div');
  private readonly fade = document.createElement('div');
  private toastTimer = 0;
  private here: PersonEntry[] = [];
  private others: OtherRoom[] = [];
  private roomName = '';

  constructor(onStatusChange: (status: Status) => void) {
    this.people.className = 'people';
    this.people.open = window.innerWidth > 600;
    this.peopleBody.className = 'people-body';

    // Seletor do próprio status (fica fora da lista para não perder o foco ao re-renderizar).
    const statusRow = Object.assign(document.createElement('label'), { className: 'status-row' });
    statusRow.append(Object.assign(document.createElement('span'), { textContent: 'Seu status' }));
    for (const st of STATUSES) {
      this.statusSelect.append(new Option(STATUS_LABELS[st], st));
    }
    this.statusSelect.addEventListener('change', () =>
      onStatusChange(this.statusSelect.value as Status),
    );
    statusRow.append(this.statusSelect);
    this.people.append(this.peopleSummary, statusRow, this.peopleBody);

    this.banner.className = 'conn-banner';
    this.banner.setAttribute('role', 'status');
    this.banner.hidden = true;

    this.toast.className = 'toast';
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;

    this.fade.className = 'room-fade';

    document.body.append(this.people, this.banner, this.toast, this.fade);
    this.render();
  }

  setPeople(entries: PersonEntry[], roomName = this.roomName): void {
    this.here = [...entries].sort(
      (a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name, 'pt-BR'),
    );
    this.roomName = roomName;
    this.render();
  }

  /** Mostra no seletor o status atual (inclusive o ausente automático). */
  setOwnStatus(status: Status): void {
    this.statusSelect.value = status;
    this.statusSelect.dataset.status = status;
  }

  /** Outras salas (a atual é ignorada: ela vem do estado ao vivo). */
  setOtherRooms(rooms: OtherRoom[], currentRoomId: string): void {
    this.others = rooms.filter((r) => r.roomId !== currentRoomId);
    this.render();
  }

  /** Escurece a tela durante a troca de sala. */
  setFading(on: boolean): void {
    this.fade.classList.toggle('on', on);
  }

  private render(): void {
    const total = this.here.length + this.others.reduce((n, r) => n + r.people.length, 0);
    this.peopleSummary.textContent = `Pessoas online (${total})`;

    const section = (title: string, items: HTMLLIElement[]) => {
      const h = Object.assign(document.createElement('h3'), { textContent: title });
      const ul = Object.assign(document.createElement('ul'), { className: 'people-list' });
      ul.append(...items);
      return [h, ul];
    };

    const hereItems = this.here.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.birthday ? `${p.name} 🎂` : p.name;
      li.dataset.status = p.status;
      if (p.cargo) li.append(cargoPill(p.cargo, p.cargoColor));
      li.title = STATUS_LABELS[p.status as Status] ?? '';
      if (p.isLocal) li.append(tag('você'));
      if (!p.isLocal && (p.status === 'busy' || p.status === 'away')) {
        li.append(tag(STATUS_LABELS[p.status].toLowerCase()));
      }
      if (p.away) {
        li.classList.add('away');
        li.append(tag('reconectando'));
      }
      return li;
    });
    const nodes: HTMLElement[] = [...section(`${this.roomName || 'Nesta sala'} · aqui`, hereItems)];
    for (const room of this.others) {
      if (room.people.length === 0) continue;
      const items = room.people.map((p) => {
        const li = document.createElement('li');
        li.classList.add('elsewhere');
        li.textContent = p.name;
        return li;
      });
      nodes.push(...section(room.name, items));
    }
    this.peopleBody.replaceChildren(...nodes);
  }

  setStatus(status: ConnectionStatus, detail?: string): void {
    const show = status === 'reconnecting' || status === 'connecting';
    this.banner.hidden = !show;
    this.banner.dataset.status = status;
    this.banner.textContent = detail ?? (status === 'connecting' ? 'Conectando…' : 'Reconectando…');
  }

  notify(message: string): void {
    this.toast.textContent = message;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 3000);
  }
}
