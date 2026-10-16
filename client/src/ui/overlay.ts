import type { ConnectionStatus } from '../net/OfficeConnection.js';

export interface PersonEntry {
  id: string;
  name: string;
  away: boolean;
  isLocal: boolean;
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
  private readonly banner = document.createElement('div');
  private readonly toast = document.createElement('div');
  private readonly fade = document.createElement('div');
  private toastTimer = 0;
  private here: PersonEntry[] = [];
  private others: OtherRoom[] = [];
  private roomName = '';

  constructor() {
    this.people.className = 'people';
    this.people.open = window.innerWidth > 600;
    this.peopleBody.className = 'people-body';
    this.people.append(this.peopleSummary, this.peopleBody);

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
      li.textContent = p.name;
      if (p.isLocal) li.append(tag('você'));
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
