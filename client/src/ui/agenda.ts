import {
  meetingEnd,
  nameKey,
  RESPONSE_LABELS,
  type Meeting,
  type RoomSummary,
  type TeamMember,
} from '@office/shared';
import { meetingApi } from '../net/api.js';
import { confirmDialog } from './confirm.js';

export interface AgendaOptions {
  token: string;
  userId: string;
  isAdmin: boolean;
  rooms: () => RoomSummary[];
  loadTeam: () => Promise<TeamMember[]>;
  goTo: (roomId: string) => void;
  /** Sala atual (para abrir o formulário com ela escolhida). */
  currentRoomId: string;
}

export interface AgendaHandle {
  refresh(): void;
  close(): void;
}

const dayFormat = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === tomorrow.toDateString()) return 'Amanhã';
  const s = dayFormat.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** `YYYY-MM-DD` e `HH:MM` locais (para os campos do formulário). */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localTime(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

/** Painel "Agenda": reuniões de hoje e dos próximos dias, e o formulário de nova reunião. */
export function openAgenda(opts: AgendaOptions): AgendaHandle {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="sheet sheet-wide agenda" role="dialog" aria-modal="true" aria-labelledby="agenda-title">
      <header class="sheet-head">
        <h2 id="agenda-title">📅 Agenda</h2>
        <label class="agenda-mine"><input type="checkbox" /> Só as minhas</label>
        <button type="button" class="btn-primary btn-small agenda-new">+ Nova reunião</button>
        <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
      </header>
      <p class="admin-flash" role="status" hidden></p>
      <div class="sheet-body agenda-body"><p class="muted">Carregando…</p></div>
    </section>`;
  document.body.append(backdrop);
  const $ = <T extends Element>(sel: string) => backdrop.querySelector<T>(sel)!;
  const body = $<HTMLElement>('.agenda-body');
  const flashBox = $<HTMLElement>('.admin-flash');
  const mineBox = $<HTMLInputElement>('.agenda-mine input');
  let meetings: Meeting[] = [];
  let formOpen = false;
  let closed = false;
  let flashTimer = 0;

  const flash = (message: string, error = false) => {
    flashBox.hidden = false;
    flashBox.textContent = message;
    flashBox.classList.toggle('error', error);
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (flashBox.hidden = true), error ? 6000 : 3000);
  };

  async function load(): Promise<void> {
    try {
      meetings = await meetingApi.list(opts.token);
      if (!formOpen) render();
    } catch (err) {
      body.replaceChildren(el('p', 'login-error', (err as Error).message));
    }
  }

  function render(): void {
    const now = Date.now();
    const mine = (m: Meeting) => m.attendees.some((a) => a.userId === opts.userId);
    const visible = meetings
      .filter((m) => meetingEnd(m) > now) // terminadas saem
      .filter((m) => !mineBox.checked || mine(m));
    if (visible.length === 0) {
      body.replaceChildren(
        el(
          'p',
          'muted agenda-empty',
          'Nenhuma reunião marcada. Use “+ Nova reunião” para marcar uma.',
        ),
      );
      return;
    }
    const nodes: HTMLElement[] = [];
    let lastDay = '';
    for (const m of visible) {
      const day = dayLabel(m.startsAt);
      if (day !== lastDay) {
        nodes.push(el('h3', 'agenda-day', day));
        lastDay = day;
      }
      nodes.push(card(m, now));
    }
    body.replaceChildren(...nodes);
  }

  function card(m: Meeting, now: number): HTMLElement {
    const box = el('article', 'agenda-item');
    const live = m.startsAt <= now && now < meetingEnd(m);
    if (live) box.classList.add('live');
    const me = m.attendees.find((a) => a.userId === opts.userId);

    const time = el('div', 'agenda-time');
    time.append(
      el('strong', '', timeFormat.format(m.startsAt)),
      el('span', 'muted', durationLabel(m.durationMin)),
    );
    const info = el('div', 'agenda-info');
    const title = el('p', 'agenda-title', m.title);
    if (live) title.append(el('span', 'tag agenda-live', 'acontecendo agora'));
    info.append(title, el('p', 'muted', `${m.roomName} · marcada por ${m.createdByName}`));
    if (m.description) info.append(el('p', 'agenda-desc', m.description));
    const people = el('p', 'agenda-people');
    for (const a of m.attendees) {
      const chip = el('span', `agenda-person r-${a.response}`, a.name);
      chip.title = RESPONSE_LABELS[a.response];
      people.append(chip);
    }
    info.append(people);

    const actions = el('div', 'agenda-actions');
    if (me && me.userId !== m.createdBy) {
      for (const [resp, label] of [
        ['yes', 'Vou'],
        ['no', 'Não vou'],
      ] as const) {
        const b = button(label, () =>
          act(
            () => meetingApi.respond(opts.token, m.id, resp),
            resp === 'yes' ? 'Resposta: vou.' : 'Resposta: não vou.',
          ),
        );
        b.setAttribute('aria-pressed', String(me.response === resp));
        actions.append(b);
      }
    }
    // "Ir para a sala" a partir de 15 minutos antes.
    if (now >= m.startsAt - 15 * 60_000) {
      actions.append(
        button(
          'Ir para a sala',
          () => {
            opts.goTo(m.roomId);
            close();
          },
          'btn-primary btn-small',
        ),
      );
    }
    if (m.createdBy === opts.userId || opts.isAdmin) {
      actions.append(
        button(
          'Cancelar',
          async () => {
            const yes = await confirmDialog(
              `Cancelar a reunião “${m.title}”? Os convidados deixam de vê-la.`,
              {
                confirmLabel: 'Cancelar reunião',
                danger: true,
              },
            );
            if (yes) await act(() => meetingApi.cancel(opts.token, m.id), 'Reunião cancelada.');
          },
          'btn-link',
        ),
      );
    }
    box.append(time, info, actions);
    return box;
  }

  async function act(action: () => Promise<unknown>, success: string): Promise<void> {
    try {
      await action();
      flash(success);
    } catch (err) {
      flash((err as Error).message, true);
    }
    await load();
  }

  // ---------- Nova reunião ----------

  async function showForm(): Promise<void> {
    formOpen = true;
    const start = new Date(Math.ceil((Date.now() + 5 * 60_000) / (30 * 60_000)) * 30 * 60_000);
    const form = document.createElement('form');
    form.className = 'agenda-form';
    form.innerHTML = `
      <h3>Nova reunião</h3>
      <label class="field"><span>Título</span><input name="title" maxlength="80" required placeholder="Ex.: Planejamento da sprint" /></label>
      <div class="agenda-row">
        <label class="field"><span>Sala</span><select name="room"></select></label>
        <label class="field"><span>Dia</span><input name="date" type="date" required /></label>
        <label class="field"><span>Hora</span><input name="time" type="time" step="300" required /></label>
        <label class="field"><span>Duração</span><select name="duration"></select></label>
      </div>
      <label class="field"><span>Descrição (opcional)</span><textarea name="description" rows="2" maxlength="500"></textarea></label>
      <div class="field"><span>Convidados</span>
        <input class="agenda-search" type="search" placeholder="Buscar pessoa" aria-label="Buscar convidado" />
        <ul class="agenda-invitees"><li class="muted">Carregando a equipe…</li></ul>
      </div>
      <p class="login-error" role="alert" hidden></p>
      <div class="agenda-form-actions">
        <button type="button" class="btn-secondary agenda-cancel">Voltar</button>
        <button type="submit" class="btn-primary">Marcar reunião</button>
      </div>`;
    const q = <T extends Element>(sel: string) => form.querySelector<T>(sel)!;
    const roomSel = q<HTMLSelectElement>('select[name=room]');
    for (const r of opts.rooms()) roomSel.append(new Option(r.name, r.id));
    roomSel.value = opts.rooms().some((r) => r.id === opts.currentRoomId)
      ? opts.currentRoomId
      : 'meeting';
    q<HTMLInputElement>('input[name=date]').value = localDate(start);
    q<HTMLInputElement>('input[name=time]').value = localTime(start);
    const durSel = q<HTMLSelectElement>('select[name=duration]');
    for (const d of DURATIONS) durSel.append(new Option(durationLabel(d), String(d)));
    durSel.value = '60';
    q('.agenda-cancel').addEventListener('click', () => {
      formOpen = false;
      render();
    });
    // Teclas no formulário não vão para a cena/chat.
    form.addEventListener('keydown', (e) => e.stopPropagation());
    body.replaceChildren(form);
    q<HTMLInputElement>('input[name=title]').focus();

    const chosen = new Set<string>();
    const list = q<HTMLUListElement>('.agenda-invitees');
    const search = q<HTMLInputElement>('.agenda-search');
    let team: TeamMember[] = [];
    try {
      team = (await opts.loadTeam()).filter((m) => m.userId !== opts.userId && m.username);
    } catch {
      list.replaceChildren(el('li', 'login-error', 'Não deu para carregar a equipe.'));
    }
    const drawPeople = () => {
      const k = nameKey(search.value);
      list.replaceChildren(
        ...team
          .filter(
            (m) =>
              !k || nameKey(`${m.name} ${m.username ?? ''} ${m.cargo?.name ?? ''}`).includes(k),
          )
          .map((m) => {
            const li = document.createElement('li');
            const label = document.createElement('label');
            const box = Object.assign(document.createElement('input'), {
              type: 'checkbox',
              checked: chosen.has(m.userId),
            });
            box.addEventListener('change', () => {
              if (box.checked) chosen.add(m.userId);
              else chosen.delete(m.userId);
            });
            label.append(
              box,
              ` ${m.name}`,
              el('span', 'muted', m.cargo ? ` · ${m.cargo.name}` : ''),
            );
            li.append(label);
            return li;
          }),
      );
    };
    search.addEventListener('input', drawPeople);
    drawPeople();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = q<HTMLElement>('.login-error');
      err.hidden = true;
      const f = new FormData(form);
      const startsAt = new Date(`${f.get('date')}T${f.get('time')}`).getTime();
      try {
        await meetingApi.create(opts.token, {
          title: String(f.get('title') ?? ''),
          description: String(f.get('description') ?? ''),
          roomId: String(f.get('room')),
          startsAt,
          durationMin: Number(f.get('duration')),
          attendeeIds: [...chosen],
        });
        formOpen = false;
        flash(
          chosen.size
            ? `Reunião marcada. ${chosen.size} convite(s) enviado(s).`
            : 'Reunião marcada.',
        );
        await load();
      } catch (error) {
        err.hidden = false;
        err.textContent = (error as Error).message;
      }
    });
  }

  $('.agenda-new').addEventListener('click', () => void showForm());
  mineBox.addEventListener('change', render);

  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !document.querySelector('.confirm-backdrop')) close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  $('.sheet-close').addEventListener('click', close);
  void load();

  return {
    refresh: () => {
      if (!closed) void load();
    },
    close,
  };
}

/** 30 → "30 min", 60 → "1 h", 90 → "1h30". */
function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h}h${String(rest).padStart(2, '0')}` : `${h} h`;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  text: string,
  onClick: () => unknown,
  className = 'btn-secondary btn-small',
): HTMLButtonElement {
  const b = Object.assign(document.createElement('button'), {
    type: 'button',
    className,
    textContent: text,
  });
  b.addEventListener('click', () => void onClick());
  return b;
}
