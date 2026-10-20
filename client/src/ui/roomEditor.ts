import {
  AMBIENT_LABELS,
  AMBIENTS,
  RECEPTION,
  type Ambient,
  ROOM_MAX_DOORS,
  ROOM_MAX_SIZE,
  ROOM_MIN_SIZE,
  validateRoomEdit,
  type RoomEdit,
  type RoomEditorData,
  type RoomSummary,
} from '@office/shared';
import { roomApi } from '../net/api.js';
import { confirmDialog } from './confirm.js';
import { skeletonHtml } from './skeleton.js';

export interface RoomEditorOptions {
  token: string;
  /** Sala onde a pessoa está (abre nela). */
  currentRoomId: string;
  /** Lista atual de salas (do lobby). */
  rooms: () => RoomSummary[];
  /** Ir até a sala (sem porta). */
  goTo: (roomId: string) => void;
  notify: (message: string) => void;
}

type Tool = 'floor' | 'erase' | 'spawn' | 'door';
const TOOLS: [Tool, string, string][] = [
  ['floor', 'Piso', 'Clique ou arraste para pôr piso'],
  ['erase', 'Apagar', 'Clique ou arraste para tirar piso'],
  ['spawn', 'Entrada', 'Onde as pessoas nascem ao chegar sem porta'],
  ['door', 'Porta', 'Na primeira linha ou coluna, encostada no piso'],
];

/**
 * Editor de salas: nome, cores, formato do piso (pintando a grade), entrada e portas.
 * A linha 0 e a coluna 0 da grade são só para portas (a parede fica ali).
 */
export function openRoomEditor(opts: RoomEditorOptions): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="sheet sheet-wide room-editor" role="dialog" aria-modal="true" aria-labelledby="re-title">
      <header class="sheet-head">
        <h2 id="re-title">Editar salas</h2>
        <select class="re-room" aria-label="Sala"></select>
        <button type="button" class="btn-secondary btn-small re-new">+ Nova sala</button>
        <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
      </header>
      <div class="sheet-body re-body">${skeletonHtml()}</div>
    </section>`;
  document.body.append(backdrop);
  const $ = <T extends Element>(sel: string) => backdrop.querySelector<T>(sel)!;
  const body = $<HTMLElement>('.re-body');
  const roomSelect = $<HTMLSelectElement>('.re-room');

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerup', stopPaint);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !document.querySelector('.confirm-backdrop')) close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  $('.sheet-close').addEventListener('click', close);

  // Estado da sala em edição.
  let roomId = opts.currentRoomId;
  let data: RoomEditorData | null = null;
  let grid: boolean[][] = [];
  let doors: RoomEdit['doors'] = [];
  let spawn = { x: 1, y: 1 };
  let tool: Tool = 'floor';
  let painting: boolean | null = null;
  const stopPaint = () => (painting = null);
  document.addEventListener('pointerup', stopPaint);

  const fillRooms = () => {
    roomSelect.replaceChildren(...opts.rooms().map((r) => new Option(r.name, r.id)));
    roomSelect.value = roomId;
  };
  roomSelect.addEventListener('change', () => void load(roomSelect.value));

  $('.re-new').addEventListener('click', async () => {
    const name = await askName();
    if (!name) return;
    try {
      const { id } = await roomApi.create(opts.token, name);
      opts.notify(`Sala "${name}" criada, com porta para a Recepção.`);
      // A lista do lobby chega logo; garante a nova no seletor já.
      roomId = id;
      await load(id, { id, name });
    } catch (err) {
      opts.notify((err as Error).message);
    }
  });

  async function load(id: string, extra?: RoomSummary): Promise<void> {
    roomId = id;
    try {
      data = await roomApi.get(opts.token, id);
    } catch (err) {
      body.replaceChildren(p('login-error', (err as Error).message));
      return;
    }
    fillRooms();
    if (extra && ![...roomSelect.options].some((o) => o.value === extra.id)) {
      roomSelect.append(new Option(extra.name, extra.id));
      roomSelect.value = extra.id;
    }
    grid = data.heightmap.map((row) => [...row].map((c) => c !== 'x'));
    doors = data.doors.map((d) => ({ ...d }));
    spawn = { ...data.spawn };
    render();
  }

  // ---------- Grade ----------

  const width = () => grid[0]?.length ?? 0;
  const height = () => grid.length;
  const isDoor = (x: number, y: number) => doors.some((d) => d.x === x && d.y === y);

  function heightmap(): string[] {
    return grid.map((row, y) =>
      row.map((on, x) => (on && (x > 0 && y > 0 ? true : isDoor(x, y)) ? '0' : 'x')).join(''),
    );
  }

  function currentEdit(form: HTMLFormElement): RoomEdit {
    const f = new FormData(form);
    return {
      name: String(f.get('name') ?? ''),
      heightmap: heightmap(),
      spawn,
      floorColor: String(f.get('floor') ?? '#b8b09a'),
      wallColor: String(f.get('wall') ?? '#a7b4c2'),
      ambient: (f.get('ambient') as Ambient | null) ?? 'none',
      doors,
    };
  }

  function resize(w: number, h: number): void {
    w = clamp(w, ROOM_MIN_SIZE, ROOM_MAX_SIZE);
    h = clamp(h, ROOM_MIN_SIZE, ROOM_MAX_SIZE);
    grid = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => grid[y]?.[x] ?? (x > 0 && y > 0)),
    );
    doors = doors.filter((d) => d.x < w && d.y < h);
    if (spawn.x >= w || spawn.y >= h) spawn = { x: 1, y: 1 };
  }

  function paint(x: number, y: number): void {
    const border = x === 0 || y === 0;
    if (tool === 'door') {
      if (!border) return;
      const i = doors.findIndex((d) => d.x === x && d.y === y);
      if (i >= 0) doors.splice(i, 1);
      else if (doors.length < ROOM_MAX_DOORS) {
        const target =
          opts.rooms().find((r) => r.id !== roomId && r.id === RECEPTION.id) ??
          opts.rooms().find((r) => r.id !== roomId);
        if (!target) return;
        doors.push({ x, y, targetRoomId: target.id });
        grid[y]![x] = true;
      }
    } else if (tool === 'spawn') {
      if (!border && grid[y]![x]) spawn = { x, y };
    } else if (!border) {
      const on = painting ?? tool === 'floor';
      grid[y]![x] = on;
      if (!on && spawn.x === x && spawn.y === y) spawn = firstFloor() ?? spawn;
    }
  }

  function firstFloor(): { x: number; y: number } | null {
    for (let y = 1; y < height(); y++)
      for (let x = 1; x < width(); x++) if (grid[y]![x]) return { x, y };
    return null;
  }

  // ---------- Tela ----------

  function render(): void {
    if (!data) return;
    const form = document.createElement('form');
    form.className = 're-form';
    form.innerHTML = `
      <div class="re-fields">
        <label class="field"><span>Nome</span><input name="name" maxlength="30" /></label>
        <label class="field re-color"><span>Piso</span><input name="floor" type="color" /></label>
        <label class="field re-color"><span>Parede</span><input name="wall" type="color" /></label>
        <label class="field re-ambient"><span>Som ambiente</span><select name="ambient"></select></label>
        <label class="field re-size"><span>Largura</span><input name="w" type="number" min="${ROOM_MIN_SIZE}" max="${ROOM_MAX_SIZE}" /></label>
        <label class="field re-size"><span>Altura</span><input name="h" type="number" min="${ROOM_MIN_SIZE}" max="${ROOM_MAX_SIZE}" /></label>
      </div>
      <div class="re-tools" role="radiogroup" aria-label="Ferramenta"></div>
      <div class="re-main">
        <div class="re-grid" role="grid" aria-label="Formato da sala"></div>
        <div class="re-side">
          <h3>Portas</h3>
          <ul class="re-doors"></ul>
          <p class="muted re-hint">A linha e a coluna de cima/esquerda (listradas) são a parede: portas só ali, encostadas no piso. A porta de volta é criada sozinha na outra sala.</p>
        </div>
      </div>
      <p class="login-error re-error" role="alert" hidden></p>
      <footer class="re-foot">
        <button type="button" class="btn-link re-delete">Excluir esta sala</button>
        <span class="re-spacer"></span>
        <button type="button" class="btn-secondary re-go">Ir para a sala</button>
        <button type="submit" class="btn-primary">Salvar sala</button>
      </footer>`;
    const input = (n: string) => form.querySelector<HTMLInputElement>(`input[name=${n}]`)!;
    input('name').value = data.name;
    input('floor').value = data.floorColor;
    input('wall').value = data.wallColor;
    const ambientSelect = form.querySelector<HTMLSelectElement>('select[name=ambient]')!;
    for (const a of AMBIENTS) ambientSelect.append(new Option(AMBIENT_LABELS[a], a));
    ambientSelect.value = data.ambient;
    input('w').value = String(width());
    input('h').value = String(height());
    const onSize = () => {
      resize(Number(input('w').value), Number(input('h').value));
      draw();
    };
    input('w').addEventListener('change', onSize);
    input('h').addEventListener('change', onSize);
    input('floor').addEventListener('input', () => draw());

    const tools = form.querySelector('.re-tools')!;
    for (const [id, label, title] of TOOLS) {
      const b = Object.assign(document.createElement('button'), {
        type: 'button',
        textContent: label,
        title,
      });
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        tool = id;
        drawTools();
      });
      b.dataset.tool = id;
      tools.append(b);
    }
    const drawTools = () => {
      for (const b of tools.querySelectorAll<HTMLButtonElement>('button')) {
        b.setAttribute('aria-checked', String(b.dataset.tool === tool));
      }
    };
    drawTools();

    const gridEl = form.querySelector<HTMLElement>('.re-grid')!;
    const doorsEl = form.querySelector<HTMLElement>('.re-doors')!;
    const errorEl = form.querySelector<HTMLElement>('.re-error')!;
    const saveBtn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;

    function draw(): void {
      gridEl.style.gridTemplateColumns = `repeat(${width()}, var(--cell))`;
      gridEl.style.setProperty('--floor', input('floor').value);
      const cells: HTMLElement[] = [];
      for (let y = 0; y < height(); y++) {
        for (let x = 0; x < width(); x++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 're-cell';
          const border = x === 0 || y === 0;
          if (border) cell.classList.add('border');
          if (grid[y]![x] && !border) cell.classList.add('floor');
          if (isDoor(x, y)) {
            cell.classList.add('door');
            cell.textContent = '🚪';
          }
          if (spawn.x === x && spawn.y === y) {
            cell.classList.add('spawn');
            cell.textContent = '★';
          }
          cell.setAttribute('aria-label', `${x},${y}`);
          cell.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            painting = tool === 'floor' ? true : tool === 'erase' ? false : null;
            paint(x, y);
            draw();
          });
          cell.addEventListener('pointerenter', () => {
            if (painting === null || tool === 'door' || tool === 'spawn') return;
            paint(x, y);
            draw();
          });
          cells.push(cell);
        }
      }
      gridEl.replaceChildren(...cells);

      doorsEl.replaceChildren(
        ...(doors.length === 0
          ? [li('muted', 'Nenhuma porta. Use a ferramenta Porta na borda listrada.')]
          : doors.map((d) => {
              const item = document.createElement('li');
              const select = document.createElement('select');
              select.setAttribute('aria-label', `Destino da porta ${d.x},${d.y}`);
              for (const r of opts.rooms()) {
                if (r.id !== roomId) select.append(new Option(r.name, r.id));
              }
              select.value = d.targetRoomId;
              select.addEventListener('change', () => {
                d.targetRoomId = select.value;
                validate();
              });
              const remove = Object.assign(document.createElement('button'), {
                type: 'button',
                className: 'btn-link',
                textContent: 'Remover',
              });
              remove.addEventListener('click', () => {
                doors = doors.filter((x) => x !== d);
                draw();
              });
              item.append(`🚪 (${d.x},${d.y}) → `, select, ' ', remove);
              return item;
            })),
      );
      validate();
    }

    /** Validação ao vivo (formato e portas; móveis o servidor confere ao salvar). */
    function validate(): void {
      const res = validateRoomEdit(currentEdit(form), {
        selfId: roomId,
        roomIds: new Set(opts.rooms().map((r) => r.id)),
        furni: [],
        defs: new Map(),
      });
      errorEl.hidden = res.ok;
      errorEl.textContent = res.ok ? '' : res.error;
      saveBtn.disabled = !res.ok;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      try {
        const res = await roomApi.update(opts.token, roomId, currentEdit(form));
        opts.notify(
          res.removedFurni > 0
            ? `Sala salva. ${res.removedFurni} móvel(is) que não cabiam mais foram retirados.`
            : 'Sala salva.',
        );
        await load(roomId);
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = (err as Error).message;
        saveBtn.disabled = false;
      }
    });

    const del = form.querySelector<HTMLButtonElement>('.re-delete')!;
    del.hidden = roomId === RECEPTION.id;
    del.addEventListener('click', async () => {
      const yes = await confirmDialog(
        `Excluir a sala "${data!.name}"? Os móveis e a conversa dela somem, e as portas que levavam até ela também.`,
        { confirmLabel: 'Excluir', danger: true },
      );
      if (!yes) return;
      try {
        await roomApi.remove(opts.token, roomId);
        opts.notify('Sala excluída.');
        await load(RECEPTION.id);
      } catch (err) {
        opts.notify((err as Error).message);
      }
    });
    const go = form.querySelector<HTMLButtonElement>('.re-go')!;
    go.hidden = roomId === opts.currentRoomId;
    go.addEventListener('click', () => {
      opts.goTo(roomId);
      close();
    });

    body.replaceChildren(form);
    draw();
  }

  /** Pergunta o nome da sala nova (no próprio editor). */
  function askName(): Promise<string | null> {
    return new Promise((resolve) => {
      const box = document.createElement('form');
      box.className = 're-new-form';
      const input = Object.assign(document.createElement('input'), {
        placeholder: 'Nome da sala nova (ex.: Sala do TI)',
        maxLength: 30,
      });
      input.setAttribute('aria-label', 'Nome da sala nova');
      const ok = Object.assign(document.createElement('button'), {
        type: 'submit',
        className: 'btn-primary btn-small',
        textContent: 'Criar',
      });
      const cancel = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'btn-secondary btn-small',
        textContent: 'Cancelar',
      });
      box.append(input, ok, cancel);
      body.prepend(box);
      input.focus();
      box.addEventListener('submit', (e) => {
        e.preventDefault();
        box.remove();
        resolve(input.value.trim() || null);
      });
      cancel.addEventListener('click', () => {
        box.remove();
        resolve(null);
      });
    });
  }

  fillRooms();
  void load(roomId);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v) || min));
}

function p(className: string, text: string): HTMLParagraphElement {
  return Object.assign(document.createElement('p'), { className, textContent: text });
}

function li(className: string, text: string): HTMLLIElement {
  return Object.assign(document.createElement('li'), { className, textContent: text });
}
