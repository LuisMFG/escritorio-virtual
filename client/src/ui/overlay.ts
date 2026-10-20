import { STATUS_LABELS, STATUSES, type Status } from '@office/shared';
import type { ConnectionStatus } from '../net/OfficeConnection.js';
import { cargoPill } from './profile.js';
import { mountToasts, toast, type ToastOptions } from './toasts.js';

export interface PersonEntry {
  id: string;
  name: string;
  away: boolean;
  isLocal: boolean;
  status: string;
  cargo: string;
  cargoColor: string;
  birthday: boolean;
  activity: string;
  /** 'focus' | 'break' | '' */
  focusKind: string;
}

/** Quem foi clicado na lista: alguém desta sala (sessão) ou de outra (conta + sala). */
export interface PersonPick {
  sessionId?: string;
  userId?: string;
  roomId?: string;
}

export interface OtherRoom {
  roomId: string;
  name: string;
  people: { name: string; userId?: string; activity?: string }[];
}

/** Linha pequena com a atividade fora do escritório ("💻 Codando em C#…"). */
function activityLine(text: string): HTMLElement {
  return Object.assign(document.createElement('small'), {
    className: 'person-activity',
    textContent: text,
  });
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
  private readonly fade = document.createElement('div');
  private here: PersonEntry[] = [];
  private others: OtherRoom[] = [];
  private roomName = '';
  private lastStatus: ConnectionStatus = 'connecting';
  private pick: ((target: PersonPick) => void) | null = null;

  constructor(onStatusChange: (status: Status) => void) {
    this.people.className = 'people';
    this.people.open = window.innerWidth > 600 && window.innerHeight > 500;
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

    this.fade.className = 'room-fade';

    document.body.append(this.people, this.banner, this.fade);
    mountToasts();
    this.render();
  }

  /** Clique numa pessoa da lista (Fase 42): achar na sala ou ir até a sala dela. */
  onPick(fn: (target: PersonPick) => void): void {
    this.pick = fn;
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
      if (p.focusKind) li.append(tag(p.focusKind === 'focus' ? '🍅 foco' : '☕ pausa'));
      if (!p.isLocal && (p.status === 'busy' || p.status === 'away')) {
        li.append(tag(STATUS_LABELS[p.status].toLowerCase()));
      }
      if (p.away) {
        li.classList.add('away');
        li.append(tag('reconectando'));
      }
      if (p.activity) li.append(activityLine(p.activity));
      this.makePickable(li, p.isLocal ? 'Achar você na sala' : `Achar ${p.name} na sala`, {
        sessionId: p.id,
      });
      return li;
    });
    const nodes: HTMLElement[] = [...section(`${this.roomName || 'Nesta sala'} · aqui`, hereItems)];
    for (const room of this.others) {
      if (room.people.length === 0) continue;
      const items = room.people.map((p) => {
        const li = document.createElement('li');
        li.classList.add('elsewhere');
        li.textContent = p.name;
        if (p.activity) li.append(activityLine(p.activity));
        if (p.userId) {
          this.makePickable(li, `Ir até ${p.name} (${room.name})`, {
            userId: p.userId,
            roomId: room.roomId,
          });
        }
        return li;
      });
      nodes.push(...section(room.name, items));
    }
    this.peopleBody.replaceChildren(...nodes);
  }

  private makePickable(li: HTMLLIElement, label: string, target: PersonPick): void {
    li.classList.add('pickable');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.title = li.title ? `${li.title} · ${label}` : label;
    li.setAttribute('aria-label', label);
    const go = () => this.pick?.(target);
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  }

  /**
   * Faixa de conexão (Fase 45): no alto, com um girador, enquanto conecta ou reconecta; ao
   * voltar depois de cair, um aviso de sucesso.
   */
  setStatus(status: ConnectionStatus, detail?: string): void {
    const show = status === 'reconnecting' || status === 'connecting';
    if (status === 'online' && this.lastStatus === 'reconnecting') {
      toast('Conectado de novo.', { kind: 'success' });
    }
    this.lastStatus = status;
    this.banner.hidden = !show;
    this.banner.dataset.status = status;
    const spinner = Object.assign(document.createElement('span'), { className: 'spinner' });
    spinner.setAttribute('aria-hidden', 'true');
    this.banner.replaceChildren(
      spinner,
      detail ?? (status === 'connecting' ? 'Conectando…' : 'Reconectando…'),
    );
  }

  /** Aviso rápido (empilha com os outros). Número = quanto tempo fica (ms). */
  notify(message: string, opts: number | ToastOptions = {}): () => void {
    return toast(message, typeof opts === 'number' ? { durationMs: opts } : opts);
  }
}
