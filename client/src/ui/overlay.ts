import type { ConnectionStatus } from '../net/OfficeConnection.js';

export interface PersonEntry {
  id: string;
  name: string;
  away: boolean;
  isLocal: boolean;
}

/** Lista de pessoas na sala (recolhível), faixa de conexão e avisos rápidos. */
export class Overlay {
  private readonly people = document.createElement('details');
  private readonly peopleSummary = document.createElement('summary');
  private readonly peopleList = document.createElement('ul');
  private readonly banner = document.createElement('div');
  private readonly toast = document.createElement('div');
  private toastTimer = 0;

  constructor() {
    this.people.className = 'people';
    this.people.open = window.innerWidth > 600;
    this.peopleList.className = 'people-list';
    this.people.append(this.peopleSummary, this.peopleList);

    this.banner.className = 'conn-banner';
    this.banner.setAttribute('role', 'status');
    this.banner.hidden = true;

    this.toast.className = 'toast';
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;

    document.body.append(this.people, this.banner, this.toast);
    this.setPeople([]);
  }

  setPeople(entries: PersonEntry[]): void {
    const sorted = [...entries].sort(
      (a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name, 'pt-BR'),
    );
    this.peopleSummary.textContent = `Pessoas na sala (${sorted.length})`;
    this.peopleList.replaceChildren(
      ...sorted.map((p) => {
        const li = document.createElement('li');
        li.textContent = p.name;
        if (p.isLocal)
          li.append(
            Object.assign(document.createElement('span'), {
              className: 'tag',
              textContent: 'você',
            }),
          );
        if (p.away) {
          li.classList.add('away');
          li.append(
            Object.assign(document.createElement('span'), {
              className: 'tag',
              textContent: 'reconectando',
            }),
          );
        }
        return li;
      }),
    );
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
