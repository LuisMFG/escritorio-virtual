import {
  ARCADE_INFO,
  ARCADE_SLOTS,
  sideNames,
  sideSlots,
  slotsOf,
  type ArcadeKind,
  type ArcadeMode,
  type ArcadeReply,
  type ArcadeSide,
  type ArcadeSlot,
  type ArcadeView,
} from '@office/shared';
import { makeDraggable } from './draggable.js';

export interface ArcadeOptions {
  furniId: string;
  kind: ArcadeKind;
  mySessionId: () => string;
  /** Hora do servidor (para a contagem do W.O.). */
  now: () => number;
  join(slot: ArcadeSlot): Promise<ArcadeReply>;
  leave(): Promise<ArcadeReply>;
  start(): Promise<ArcadeReply>;
  forfeit(): Promise<ArcadeReply>;
  mode(mode: ArcadeMode): Promise<ArcadeReply>;
}

export interface ArcadeHandle {
  furniId: string;
  /** A partida mudou (`null` = mesa vazia). */
  update(view: ArcadeView | null): void;
  close(): void;
}

const SIDE_LABEL: Record<ArcadeSide, string> = { a: 'Lado A', b: 'Lado B' };

/**
 * Painel de uma mesa do Salão de Jogos (Fase 57): placar, vista de cima da mesa, vagas dos dois
 * lados (1×1 ou 2×2) e começar, desistir ou sair. Não bloqueia a sala; quem não joga assiste ao
 * vivo. A recusa de um pedido chega como aviso (o servidor manda o motivo).
 */
export function openArcade(opts: ArcadeOptions): ArcadeHandle {
  const info = ARCADE_INFO[opts.kind];
  const panel = document.createElement('section');
  panel.className = 'arcade-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'arcade-title');
  panel.innerHTML = `
    <header class="arcade-head">
      <h2 id="arcade-title"></h2>
      <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
    </header>
    <div class="arcade-score" aria-live="polite">
      <span class="arcade-names a"></span>
      <strong class="arcade-points"></strong>
      <span class="arcade-names b"></span>
    </div>
    <p class="arcade-status"></p>
    <canvas class="arcade-court" aria-hidden="true"></canvas>
    <p class="arcade-note muted" hidden>Vagas e placar já funcionam; as jogadas chegam na próxima atualização.</p>
    <div class="arcade-mode" role="group" aria-label="Modo de jogo"></div>
    <div class="arcade-slots"></div>
    <div class="arcade-actions"></div>`;
  document.body.append(panel);
  const $ = <T extends Element>(sel: string) => panel.querySelector<T>(sel)!;
  $<HTMLElement>('#arcade-title').textContent = `${info.icon} ${info.name}`;
  const namesA = $<HTMLElement>('.arcade-names.a');
  const namesB = $<HTMLElement>('.arcade-names.b');
  const points = $<HTMLElement>('.arcade-points');
  const status = $<HTMLElement>('.arcade-status');
  const court = $<HTMLCanvasElement>('.arcade-court');
  const note = $<HTMLElement>('.arcade-note');
  const modeEl = $<HTMLElement>('.arcade-mode');
  const slotsEl = $<HTMLElement>('.arcade-slots');
  const actions = $<HTMLElement>('.arcade-actions');

  let view: ArcadeView | null = null;
  /** Pedido em andamento: os botões esperam a resposta (evita clique duplo). */
  let busy = false;
  const act = (run: () => Promise<ArcadeReply>) => () => {
    if (busy) return;
    busy = true;
    render();
    void run().finally(() => {
      busy = false;
      render();
    });
  };
  const button = (label: string, cls: string, onClick: () => void, aria?: string) => {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: cls,
      textContent: label,
      disabled: busy,
    });
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
  };

  const render = () => {
    const me = opts.mySessionId();
    const v = view;
    const mode: ArcadeMode = v?.mode ?? 1;
    const mine = v ? ARCADE_SLOTS.find((s) => v.seats[s].session === me) : undefined;
    const seated = v ? slotsOf(mode).filter((s) => v.seats[s].session) : [];
    const full = seated.length === slotsOf(mode).length;
    const now = opts.now();

    namesA.textContent = (v && sideNames(v, 'a')) || '—';
    namesB.textContent = (v && sideNames(v, 'b')) || '—';
    points.textContent = v && v.status !== 'waiting' ? `${v.scoreA} × ${v.scoreB}` : '×';

    // Situação da mesa.
    const away =
      v && v.status === 'playing' ? seated.find((s) => v.seats[s].awayUntil > now) : undefined;
    let text: string;
    if (!v || !seated.length) text = 'Mesa livre. Escolha uma vaga para jogar.';
    else if (v.status === 'waiting') {
      text = !full
        ? mine
          ? 'Esperando os outros jogadores…'
          : 'Falta gente. Entre numa vaga ou assista.'
        : mine
          ? 'Tudo pronto: é só começar.'
          : 'Os jogadores vão começar.';
    } else if (v.status === 'playing') {
      text = away
        ? `⏳ ${v.seats[away].name} saiu: W.O. em ${Math.ceil((v.seats[away].awayUntil - now) / 1000)} s`
        : mine
          ? 'Partida em andamento.'
          : '👀 Você está assistindo.';
    } else {
      const how = v.end === 'wo' ? ' (W.O.)' : v.end === 'forfeit' ? ' (desistência)' : '';
      const winners = v.winner ? sideNames(v, v.winner) : '';
      text = winners
        ? `🏆 ${winners} ${winners.includes(' e ') ? 'venceram' : 'venceu'}${how}`
        : 'Partida encerrada.';
      if (mine && full) text += ' Começar de novo?';
    }
    status.textContent = text;
    note.hidden = v?.status !== 'playing';
    drawCourt(court, opts.kind, v ? sideNames(v, 'a') : '', v ? sideNames(v, 'b') : '');

    // Modo: antes de começar.
    const canMode = !v || v.status !== 'playing';
    modeEl.replaceChildren(
      ...([1, 2] as const).map((m) => {
        const b = button(
          m === 1 ? '1×1' : '2×2',
          `arcade-mode-btn${m === mode ? ' active' : ''}`,
          act(() => opts.mode(m)),
          m === 1 ? 'Um contra um' : 'Dois contra dois',
        );
        b.setAttribute('aria-pressed', String(m === mode));
        b.disabled = busy || !canMode || m === mode;
        return b;
      }),
    );

    // Vagas dos dois lados.
    slotsEl.replaceChildren(
      ...(['a', 'b'] as const).map((side) => {
        const col = document.createElement('div');
        col.className = `arcade-side ${side}`;
        col.append(Object.assign(document.createElement('h3'), { textContent: SIDE_LABEL[side] }));
        sideSlots(side, mode).forEach((slot, i) => {
          const seat = v?.seats[slot];
          const row = document.createElement('div');
          row.className = `arcade-slot${seat?.session === me ? ' mine' : ''}`;
          if (seat?.session) {
            const left =
              seat.awayUntil > now ? ` ⏳ ${Math.ceil((seat.awayUntil - now) / 1000)} s` : '';
            row.append(
              Object.assign(document.createElement('span'), {
                className: 'arcade-player',
                textContent: `${seat.name}${seat.session === me ? ' (você)' : ''}${left}`,
              }),
            );
          } else {
            const joinable = !v || v.status !== 'playing';
            const b = button(
              'Entrar',
              'btn-secondary arcade-join',
              act(() => opts.join(slot)),
              `Entrar na vaga ${i + 1} do ${SIDE_LABEL[side].toLowerCase()}`,
            );
            b.disabled = busy || !joinable;
            row.append(b);
          }
          col.append(row);
        });
        return col;
      }),
    );

    // Ações de quem joga.
    const btns: HTMLElement[] = [];
    if (mine && v?.status !== 'playing' && full) {
      btns.push(button('Começar', 'btn-primary', act(opts.start)));
    }
    if (mine && v?.status === 'playing') {
      btns.push(button('Desistir', 'btn-secondary', act(opts.forfeit)));
    }
    if (mine && v?.status !== 'playing') {
      btns.push(button('Sair da vaga', 'btn-secondary', act(opts.leave)));
    }
    actions.replaceChildren(...btns);
  };

  // Contagem do W.O. ao vivo.
  const timer = window.setInterval(() => {
    if (view?.status === 'playing' && ARCADE_SLOTS.some((s) => view!.seats[s].awayUntil)) render();
  }, 1000);

  const drag = makeDraggable(panel, {
    handle: '.arcade-head',
    key: 'ev-pos-arcade',
    mode: () => 'painel',
  });
  const close = () => {
    window.clearInterval(timer);
    drag.destroy();
    panel.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea')) close();
  };
  document.addEventListener('keydown', onKey);
  $('.sheet-close').addEventListener('click', close);
  render();

  return {
    furniId: opts.furniId,
    update(v) {
      view = v;
      if (panel.isConnected) render();
    },
    close,
  };
}

/** Largura e altura da vista de cima (px de CSS). */
const COURT_W = 272;
const COURT_H = 136;

/**
 * Vista de cima da mesa, em arte própria: ping-pong (tampo azul, linhas e rede) ou sinuca
 * (feltro vermelho como a mesa da sala, tabelas claras e seis caçapas). Os nomes de cada lado
 * ficam nas pontas.
 */
function drawCourt(canvas: HTMLCanvasElement, kind: ArcadeKind, a: string, b: string): void {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  if (canvas.width !== COURT_W * dpr) {
    canvas.width = COURT_W * dpr;
    canvas.height = COURT_H * dpr;
    canvas.style.width = `${COURT_W}px`;
    canvas.style.height = `${COURT_H}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, COURT_W, COURT_H);
  ctx.fillStyle = '#2b3138';
  ctx.fillRect(0, 0, COURT_W, COURT_H);
  const x0 = 40;
  const y0 = 18;
  const w = COURT_W - 80;
  const h = COURT_H - 36;
  if (kind === 'pingpong') {
    ctx.fillStyle = '#1a1d22';
    ctx.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
    ctx.fillStyle = '#2a64b0';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = '#eef3f8';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 2, y0 + 2, w - 4, h - 4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y0 + h / 2);
    ctx.lineTo(x0 + w - 2, y0 + h / 2);
    ctx.stroke();
    // Rede no meio, um pouco para fora da mesa, com os postes.
    ctx.fillStyle = '#f7f9fb';
    ctx.fillRect(x0 + w / 2 - 1.5, y0 - 6, 3, h + 12);
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(x0 + w / 2 - 2.5, y0 - 8, 5, 4);
    ctx.fillRect(x0 + w / 2 - 2.5, y0 + h + 4, 5, 4);
  } else {
    const rail = 12;
    ctx.fillStyle = '#1a1d22';
    roundRect(ctx, x0 - rail - 2, y0 - rail + 4, w + 2 * rail + 4, h + 2 * rail - 8 + 4, 9);
    ctx.fillStyle = '#efe6d2';
    roundRect(ctx, x0 - rail, y0 - rail + 6, w + 2 * rail, h + 2 * rail - 12, 8);
    ctx.fillStyle = '#b51f2e';
    ctx.fillRect(x0, y0 + 6, w, h - 12);
    // Marcas na tabela e a linha de saída.
    ctx.fillStyle = '#c8a24a';
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      const px = x0 + (w * i) / 8;
      ctx.fillRect(px - 1, y0 - 3, 2, 2);
      ctx.fillRect(px - 1, y0 + h - 5, 2, 2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(x0 + w / 4, y0 + 6);
    ctx.lineTo(x0 + w / 4, y0 + h - 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(x0 + (w * 3) / 4, y0 + h / 2, 2, 0, Math.PI * 2);
    ctx.fill();
    // Caçapas: quatro cantos e duas no meio das tabelas compridas.
    ctx.fillStyle = '#111317';
    for (const [px, py] of [
      [x0, y0 + 6],
      [x0 + w / 2, y0 + 3],
      [x0 + w, y0 + 6],
      [x0, y0 + h - 6],
      [x0 + w / 2, y0 + h - 3],
      [x0 + w, y0 + h - 6],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Nomes nas pontas (lado A à esquerda, B à direita).
  ctx.fillStyle = '#e7ebf0';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const label = (text: string, x: number) => {
    ctx.save();
    ctx.translate(x, COURT_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(text.length > 18 ? `${text.slice(0, 17)}…` : text || 'vaga livre', 0, 0);
    ctx.restore();
  };
  label(a, 16);
  label(b, COURT_W - 16);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
