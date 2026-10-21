/**
 * Janela flutuante que dá para arrastar pela barra de cima (chamada, TV). A posição fica salva
 * no navegador, separada para cada modo (pequena e ampliada); duplo clique na barra volta ao
 * lugar de sempre. Sem posição salva, vale o CSS da janela.
 */
export interface Draggable {
  /** O modo mudou (ou a tela mudou de tamanho): aplica a posição salva daquele modo. */
  refresh(): void;
  destroy(): void;
}

export interface DraggableOptions {
  /** Seletor da barra de arrastar, dentro da janela (pode ser redesenhada à vontade). */
  handle: string;
  /** Nome para guardar a posição (`ev-pos-…`). */
  key: string;
  /** Modo atual (cada um tem a sua posição). */
  mode: () => string;
}

type Saved = Record<string, { x: number; y: number }>;

/** Quanto da janela precisa continuar na tela (px) para dar para pegar de volta. */
const KEEP_VISIBLE = 48;

function load(key: string): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Saved) : {};
  } catch {
    return {};
  }
}

function save(key: string, saved: Saved): void {
  try {
    localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // sem armazenamento: vale até recarregar
  }
}

export function makeDraggable(panel: HTMLElement, opts: DraggableOptions): Draggable {
  const storeKey = `ev-pos-${opts.key}`;
  let saved = load(storeKey);
  let drag: { dx: number; dy: number; id: number } | null = null;

  /** Coloca a janela em (x, y), sem deixar a barra sair da tela. */
  const place = (x: number, y: number): { x: number; y: number } => {
    const r = panel.getBoundingClientRect();
    const cx = Math.min(Math.max(x, KEEP_VISIBLE - r.width), innerWidth - KEEP_VISIBLE);
    const cy = Math.min(Math.max(y, 0), innerHeight - KEEP_VISIBLE);
    panel.classList.add('dragged');
    panel.style.left = `${Math.round(cx)}px`;
    panel.style.top = `${Math.round(cy)}px`;
    return { x: cx, y: cy };
  };

  const reset = () => {
    panel.classList.remove('dragged');
    panel.style.left = '';
    panel.style.top = '';
  };

  const refresh = () => {
    const pos = saved[opts.mode()];
    if (pos) place(pos.x, pos.y);
    else reset();
  };

  /** Pega pela barra, mas não pelos botões e campos dela. */
  const grabbable = (t: EventTarget | null) =>
    t instanceof Element &&
    Boolean(t.closest(opts.handle)) &&
    !t.closest('button, input, select, textarea, a, video');

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !grabbable(e.target)) return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    // Começa de onde está (centralizada pelo CSS ou não).
    place(r.left, r.top);
    // Na janela toda (sem "capturar" o ponteiro, que mudaria o alvo do duplo clique).
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    panel.classList.add('dragging');
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    place(e.clientX - drag.dx, e.clientY - drag.dy);
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    panel.classList.remove('dragging');
    const r = panel.getBoundingClientRect();
    saved = { ...saved, [opts.mode()]: { x: r.left, y: r.top } };
    save(storeKey, saved);
  };
  const dblclick = (e: MouseEvent) => {
    if (!grabbable(e.target)) return;
    saved = { ...saved };
    delete saved[opts.mode()];
    save(storeKey, saved);
    reset();
  };
  const onResize = () => {
    if (panel.classList.contains('dragged')) refresh();
  };

  panel.addEventListener('pointerdown', down);
  panel.addEventListener('dblclick', dblclick);
  window.addEventListener('resize', onResize);
  refresh();

  return {
    refresh,
    destroy() {
      panel.removeEventListener('pointerdown', down);
      panel.removeEventListener('dblclick', dblclick);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('resize', onResize);
    },
  };
}
