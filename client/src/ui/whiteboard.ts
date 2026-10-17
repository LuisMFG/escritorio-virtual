import {
  splitPoints,
  WB_COLORS,
  WB_HEIGHT,
  WB_TEXT_MAX,
  WB_WIDTH,
  WB_WIDTHS,
  type WbDraft,
  type WbStroke,
  type WbStrokeInput,
  type WbStrokeMessage,
} from '@office/shared';
import { confirmDialog } from './confirm.js';
import { drawStrokes, paper, type WbLive } from './wbDraw.js';

export interface WhiteboardOptions {
  furniId: string;
  title: string;
  /** Traços atuais do quadro (já carregados). */
  strokes: () => readonly WbStroke[];
  mySessionId: () => string;
  stroke(stroke: WbStrokeInput, draftId?: string): void;
  draft(d: Omit<WbDraft, 'sessionId' | 'furniId'>): void;
  undo(): void;
  clear(): void;
}

export interface WhiteboardHandle {
  furniId: string;
  /** Algo mudou nos traços salvos (novo, desfeito, limpo). */
  redraw(): void;
  stroke(msg: WbStrokeMessage): void;
  draft(msg: WbDraft): void;
  close(): void;
}

type Tool = 'pen' | 'eraser' | 'text';
const TOOL_LABELS: Record<Tool, string> = {
  pen: '✏️ Pincel',
  eraser: '🧽 Borracha',
  text: '🔤 Texto',
};
const TEXT_SIZES: Record<number, number> = { 3: 28, 6: 40, 12: 64 };
/** Rascunho enviado a cada… */
const DRAFT_MS = 80;

/** Quadro branco em tela cheia. Todo mundo na sala desenha junto. */
export function openWhiteboard(opts: WhiteboardOptions): WhiteboardHandle {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop wb-backdrop';
  backdrop.innerHTML = `
    <section class="wb" role="dialog" aria-modal="true" aria-labelledby="wb-title">
      <header class="wb-bar">
        <h2 id="wb-title"></h2>
        <div class="wb-tools" role="radiogroup" aria-label="Ferramenta"></div>
        <div class="wb-colors" role="radiogroup" aria-label="Cor"></div>
        <div class="wb-widths" role="radiogroup" aria-label="Espessura"></div>
        <span class="wb-spacer"></span>
        <button type="button" class="btn-secondary btn-small wb-undo" title="Desfazer seu último traço (Ctrl+Z)">↶ Desfazer</button>
        <button type="button" class="btn-secondary btn-small wb-clear">Limpar</button>
        <button type="button" class="sheet-close wb-close" aria-label="Fechar quadro">✕</button>
      </header>
      <div class="wb-stage">
        <canvas class="wb-canvas" aria-label="Área de desenho"></canvas>
        <canvas class="wb-live" aria-hidden="true"></canvas>
      </div>
    </section>`;
  document.body.append(backdrop);
  const $ = <T extends Element>(sel: string) => backdrop.querySelector<T>(sel)!;
  $('#wb-title').textContent = `🖊️ ${opts.title}`;
  const stage = $<HTMLElement>('.wb-stage');
  const base = $<HTMLCanvasElement>('.wb-canvas');
  const live = $<HTMLCanvasElement>('.wb-live');
  const baseCtx = base.getContext('2d')!;
  const liveCtx = live.getContext('2d')!;

  let tool: Tool = 'pen';
  let color: string = WB_COLORS[0];
  let width: number = WB_WIDTHS[0];
  let scale = 1;
  let closed = false;

  // ---------- Barra de ferramentas ----------
  const radio = (
    parent: HTMLElement,
    items: { value: string; label: string; title: string; className?: string; style?: string }[],
    current: () => string,
    pick: (v: string) => void,
  ) => {
    const render = () =>
      parent.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', String(b.dataset.value === current()));
      });
    for (const it of items) {
      const b = Object.assign(document.createElement('button'), {
        type: 'button',
        className: it.className ?? 'wb-btn',
        textContent: it.label,
        title: it.title,
      });
      b.dataset.value = it.value;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', it.title);
      if (it.style) b.style.setProperty('--c', it.style);
      b.addEventListener('click', () => {
        pick(it.value);
        render();
      });
      parent.append(b);
    }
    render();
  };
  radio(
    $('.wb-tools'),
    (Object.keys(TOOL_LABELS) as Tool[]).map((t) => ({
      value: t,
      label: TOOL_LABELS[t],
      title: TOOL_LABELS[t].slice(3),
    })),
    () => tool,
    (v) => {
      tool = v as Tool;
      stage.dataset.tool = tool;
    },
  );
  radio(
    $('.wb-colors'),
    WB_COLORS.map((c) => ({
      value: c,
      label: '',
      title: `Cor ${c}`,
      className: 'wb-color',
      style: c,
    })),
    () => color,
    (v) => (color = v),
  );
  radio(
    $('.wb-widths'),
    WB_WIDTHS.map((w, i) => ({
      value: String(w),
      label: ['fino', 'médio', 'grosso'][i]!,
      title: `Espessura ${['fina', 'média', 'grossa'][i]}`,
    })),
    () => String(width),
    (v) => (width = Number(v)),
  );
  stage.dataset.tool = tool;

  // ---------- Tamanho do canvas (4:3, cabe na tela) ----------
  function fit(): void {
    // Área útil do palco (sem o padding de 12 px de cada lado).
    const box = stage.getBoundingClientRect();
    const availW = box.width - 24;
    const availH = box.height - 24;
    const w = Math.max(200, Math.min(availW, (availH * WB_WIDTH) / WB_HEIGHT));
    const h = (w * WB_HEIGHT) / WB_WIDTH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [base, live]) {
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    scale = (w * dpr) / WB_WIDTH;
    redraw();
  }

  // ---------- Desenho ----------
  /** Meu traço em andamento. */
  let mine: (WbLive & { draftId: string; sent: number }) | null = null;
  /** Meus traços enviados que ainda não voltaram do servidor (sem piscar). */
  const pending = new Map<string, WbLive>();
  /** Rascunhos dos outros (chave = sessão + draftId). */
  const drafts = new Map<string, WbLive & { at: number }>();

  function redraw(): void {
    paper(baseCtx, base.width, base.height);
    drawStrokes(baseCtx, opts.strokes(), scale);
    redrawLive();
  }

  function redrawLive(): void {
    liveCtx.clearRect(0, 0, live.width, live.height);
    const now = Date.now();
    for (const [k, d] of drafts) if (now - d.at > 5000) drafts.delete(k); // rascunho órfão
    drawStrokes(liveCtx, [...drafts.values(), ...pending.values(), ...(mine ? [mine] : [])], scale);
  }

  const toBoard = (e: PointerEvent): [number, number] => {
    const r = base.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * WB_WIDTH);
    const y = Math.round(((e.clientY - r.top) / r.height) * WB_HEIGHT);
    return [Math.min(WB_WIDTH, Math.max(0, x)), Math.min(WB_HEIGHT, Math.max(0, y))];
  };

  let draftTimer = 0;
  const flushDraft = () => {
    if (!mine) return;
    const fresh = mine.points.slice(mine.sent);
    if (fresh.length === 0) return;
    // Manda sempre o último ponto anterior junto, para o traço dos outros não ter buracos.
    const from = Math.max(0, mine.sent - 2);
    opts.draft({
      draftId: mine.draftId,
      tool: mine.tool,
      color: mine.color,
      width: mine.width,
      points: mine.points.slice(from, from + 200),
    });
    mine.sent = Math.min(mine.points.length, from + 200);
  };

  live.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = toBoard(e);
    if (tool === 'text') return askText(e, x, y);
    live.setPointerCapture(e.pointerId);
    mine = {
      tool,
      color,
      width: tool === 'eraser' ? width * 3 : width,
      points: [x, y],
      draftId: Math.random().toString(36).slice(2, 10),
      sent: 0,
    };
    draftTimer = window.setInterval(flushDraft, DRAFT_MS);
    redrawLive();
  });
  live.addEventListener('pointermove', (e) => {
    if (!mine) return;
    const [x, y] = toBoard(e);
    const px = mine.points.at(-2)!;
    const py = mine.points.at(-1)!;
    if (Math.hypot(x - px, y - py) < 3) return; // pontos colados não acrescentam nada
    mine.points.push(x, y);
    redrawLive();
  });
  const finish = () => {
    if (!mine) return;
    clearInterval(draftTimer);
    const done = mine;
    mine = null;
    const parts = splitPoints(done.points);
    parts.forEach((points, i) => {
      const stroke: WbStrokeInput = {
        tool: done.tool,
        color: done.color,
        width: done.width,
        points,
      };
      // O primeiro pedaço leva o draftId (os outros apagam a prévia ao recebê-lo).
      const draftId = i === 0 ? done.draftId : `${done.draftId}-${i}`;
      pending.set(draftId, { ...stroke, points });
      opts.stroke(stroke, draftId);
    });
    redrawLive();
  };
  live.addEventListener('pointerup', finish);
  live.addEventListener('pointercancel', finish);

  /** Caixinha de texto onde a pessoa clicou. */
  function askText(e: PointerEvent, x: number, y: number): void {
    const input = Object.assign(document.createElement('input'), {
      className: 'wb-text-input',
      maxLength: WB_TEXT_MAX,
      placeholder: 'Digite e Enter',
    });
    const r = stage.getBoundingClientRect();
    input.style.left = `${e.clientX - r.left}px`;
    input.style.top = `${e.clientY - r.top}px`;
    input.style.color = color;
    stage.append(input);
    setTimeout(() => input.focus());
    const done = (save: boolean) => {
      const text = input.value.trim();
      input.remove();
      if (save && text) {
        opts.stroke({ tool: 'text', color, width: TEXT_SIZES[width] ?? 40, x, y, text });
      }
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') done(true);
      if (ev.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
  }

  // ---------- Botões ----------
  $('.wb-undo').addEventListener('click', () => opts.undo());
  $('.wb-clear').addEventListener('click', async () => {
    const yes = await confirmDialog('Apagar o quadro inteiro para todo mundo?', {
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (yes) opts.clear();
  });

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(draftTimer);
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', fit);
  };
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.confirm-backdrop')) return;
    if (e.key === 'Escape') close();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      opts.undo();
    }
  };
  document.addEventListener('keydown', onKey);
  $('.wb-close').addEventListener('click', close);
  window.addEventListener('resize', fit);
  requestAnimationFrame(fit);

  return {
    furniId: opts.furniId,
    redraw: () => {
      if (!closed) redraw();
    },
    stroke(msg) {
      if (closed) return;
      if (msg.draftId) {
        if (msg.sessionId === opts.mySessionId()) pending.delete(msg.draftId);
        else drafts.delete(`${msg.sessionId}:${msg.draftId.split('-')[0]}`);
      }
      redraw();
    },
    draft(msg) {
      if (closed) return;
      const key = `${msg.sessionId}:${msg.draftId}`;
      const d = drafts.get(key) ?? { ...msg, points: [], at: 0 };
      // Os pontos chegam em pedaços que começam no último ponto do anterior.
      d.points.push(...(d.points.length ? msg.points.slice(2) : msg.points));
      d.at = Date.now();
      drafts.set(key, d);
      redrawLive();
    },
    close,
  };
}
