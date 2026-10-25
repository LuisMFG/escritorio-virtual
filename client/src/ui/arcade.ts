import {
  ARCADE_CHEERS,
  ARCADE_CHEER_IDS,
  ARCADE_INFO,
  ARCADE_SLOTS,
  GROUP_NAMES,
  otherGroup,
  sideNames,
  sideSlots,
  slotsOf,
  type ArcadeCheer,
  type ArcadeCheerMessage,
  type ArcadeKind,
  type ArcadeRanking,
  type ArcadeMode,
  type ArcadeReply,
  type ArcadeSide,
  type ArcadeSlot,
  type ArcadeView,
} from '@office/shared';
import { makeDraggable } from './draggable.js';
import { PongView, type PongViewOptions } from './pong.js';
import { poolBallColor, poolLeft, PoolView, type PoolViewOptions } from './pool.js';

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
  /** Torcer (quem não está jogando nesta mesa). */
  cheer(cheer: ArcadeCheer): void;
  /** Ranking deste jogo (os melhores e o meu placar). */
  ranking(): Promise<ArcadeRanking | null>;
  /** Ping-pong (Fase 58): raquete, saque e rebatida. */
  pong?: Pick<PongViewOptions, 'paddle' | 'serve' | 'hit'>;
  /** Sinuca (Fase 59): a tacada e a mira ao vivo. */
  pool?: Pick<PoolViewOptions, 'shoot' | 'aim'>;
  /** Atraso simulado (ms, ida e volta), para testar com ping alto. */
  lag?: number;
}

export interface ArcadeHandle {
  furniId: string;
  /** A partida mudou (`null` = mesa vazia). */
  update(view: ArcadeView | null): void;
  /** Alguém da torcida reagiu nesta mesa. */
  cheered(msg: ArcadeCheerMessage): void;
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
    <p class="arcade-sets muted" hidden></p>
    <p class="arcade-status"></p>
    <div class="pool-info" hidden>
      <div class="pool-left a"></div>
      <span class="pool-clock"></span>
      <div class="pool-left b"></div>
    </div>
    <canvas class="arcade-court" aria-hidden="true"></canvas>
    <div class="pool-controls" hidden>
      <div class="pool-spin" role="img" aria-label="Efeito na branca"
        title="Efeito: clique onde o taco bate na branca (em cima segue, embaixo volta, no meio sem efeito)"></div>
      <p class="pool-hint"></p>
    </div>
    <div class="arcade-cheers" role="group" aria-label="Torcida" hidden></div>
    <div class="arcade-mode" role="group" aria-label="Modo de jogo"></div>
    <div class="arcade-slots"></div>
    <div class="arcade-actions"></div>
    <details class="arcade-ranking">
      <summary></summary>
      <ol class="arcade-ranking-list"></ol>
      <p class="arcade-ranking-me muted"></p>
    </details>`;
  document.body.append(panel);
  const $ = <T extends Element>(sel: string) => panel.querySelector<T>(sel)!;
  $<HTMLElement>('#arcade-title').textContent = `${info.icon} ${info.name}`;
  const namesA = $<HTMLElement>('.arcade-names.a');
  const namesB = $<HTMLElement>('.arcade-names.b');
  const points = $<HTMLElement>('.arcade-points');
  const setsEl = $<HTMLElement>('.arcade-sets');
  const status = $<HTMLElement>('.arcade-status');
  const court = $<HTMLCanvasElement>('.arcade-court');
  const poolInfo = $<HTMLElement>('.pool-info');
  const poolControls = $<HTMLElement>('.pool-controls');
  const modeEl = $<HTMLElement>('.arcade-mode');
  const slotsEl = $<HTMLElement>('.arcade-slots');
  const actions = $<HTMLElement>('.arcade-actions');
  const cheersEl = $<HTMLElement>('.arcade-cheers');
  const rankingEl = $<HTMLDetailsElement>('.arcade-ranking');
  $<HTMLElement>('.arcade-ranking summary').textContent =
    `🏅 Ranking ${info.game.replace(/^n/, 'd')}`;
  for (const id of ARCADE_CHEER_IDS) {
    const c = ARCADE_CHEERS[id];
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'arcade-cheer',
      textContent: c.emoji,
      title: c.label,
    });
    b.setAttribute('aria-label', `Torcer: ${c.label}`);
    b.addEventListener('click', () => opts.cheer(id));
    cheersEl.append(b);
  }
  /** Ranking: carrega ao abrir e de novo quando uma partida acaba (com ele aberto). */
  const loadRanking = async () => {
    const r = await opts.ranking().catch(() => null);
    if (!r || !panel.isConnected) return;
    const list = $<HTMLOListElement>('.arcade-ranking-list');
    list.replaceChildren(
      ...(r.top.length
        ? r.top.map((s) => {
            const li = document.createElement('li');
            const name = Object.assign(document.createElement('span'), { textContent: s.name });
            const score = Object.assign(document.createElement('span'), {
              className: 'arcade-ranking-score',
              textContent: `${s.wins} V · ${s.losses} D${s.streak >= 2 ? ` · 🔥 ${s.streak}` : ''}`,
            });
            score.title = `Melhor sequência: ${s.bestStreak} vitória(s) seguida(s)`;
            li.append(name, score);
            return li;
          })
        : [Object.assign(document.createElement('li'), { textContent: 'Ninguém jogou ainda.' })]),
    );
    const me = r.me;
    $<HTMLElement>('.arcade-ranking-me').textContent =
      me.wins + me.losses === 0
        ? 'Você ainda não jogou aqui.'
        : `Você: ${me.wins} vitória(s), ${me.losses} derrota(s), melhor sequência ${me.bestStreak}` +
          (me.streak >= 2 ? `, ${me.streak} seguidas agora 🔥` : '');
  };
  rankingEl.addEventListener('toggle', () => {
    if (rankingEl.open) void loadRanking();
  });
  let lastStatus = '';

  let view: ArcadeView | null = null;
  /** A mesa ao vivo (ping-pong ou sinuca em andamento). */
  let pong: PongView | null = null;
  let pool: PoolView | null = null;
  const mySlot = () =>
    (view && ARCADE_SLOTS.find((s) => view!.seats[s].session === opts.mySessionId())) || null;
  /** Pedido em andamento: os botões esperam a resposta (evita clique duplo). */
  let busy = false;
  /** O que os botões e as vagas mostram agora (só são refeitos quando isso muda). */
  let controlsKey = '';
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

    // Os textos só mudam quando mudam de verdade (o placar é lido por leitores de tela).
    setText(namesA, (v && sideNames(v, 'a')) || '—');
    setText(namesB, (v && sideNames(v, 'b')) || '—');
    setText(points, v && v.status !== 'waiting' ? `${v.scoreA} × ${v.scoreB}` : '×');
    // Ping-pong: os sets; sinuca: o que a última tacada deu (falta, grupos, a vez).
    if (opts.kind === 'pingpong') {
      setsEl.hidden = !(v && v.status !== 'waiting');
      if (v) setText(setsEl, `Sets ${v.setsA} × ${v.setsB}`);
    } else {
      setsEl.hidden = !(v?.status === 'playing' && v.detail);
      setText(setsEl, v?.detail ?? '');
    }

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
        : opts.kind === 'pingpong'
          ? pongStatus(v, mine)
          : poolStatus(v, mine);
    } else {
      const how =
        v.end === 'wo'
          ? ' (W.O.)'
          : v.end === 'forfeit'
            ? ' (desistência)'
            : opts.kind === 'pool' && v.detail
              ? ` (${v.detail})`
              : '';
      const winners = v.winner ? sideNames(v, v.winner) : '';
      text = winners
        ? `🏆 ${winners} ${winners.includes(' e ') ? 'venceram' : 'venceu'}${how}`
        : 'Partida encerrada.';
      if (mine && full) text += ' Começar de novo?';
    }
    setText(status, text);
    // Torcida: para quem não está jogando, com alguém na mesa.
    cheersEl.hidden = Boolean(mine) || !seated.length;
    if (v && v.status !== lastStatus) {
      if (v.status === 'ended' && rankingEl.open) void loadRanking();
      lastStatus = v.status;
    }
    // Partida em andamento: a mesa vira o jogo (painel maior). Na sinuca, as bolas continuam à
    // mostra depois do fim.
    const live =
      opts.kind === 'pingpong'
        ? v?.status === 'playing' && Boolean(opts.pong)
        : Boolean(opts.pool && v?.pool.balls && v.status !== 'waiting');
    panel.classList.toggle('live', live);
    panel.classList.toggle('pool', opts.kind === 'pool');
    if (live && opts.kind === 'pingpong' && !pong) {
      pong = new PongView({ canvas: court, now: opts.now, mySlot, lag: opts.lag, ...opts.pong! });
    } else if (!live && pong) {
      pong.destroy();
      pong = null;
    }
    if (live && opts.kind === 'pool' && !pool) {
      pool = new PoolView({
        canvas: court,
        spin: $<HTMLElement>('.pool-spin'),
        hint: $<HTMLElement>('.pool-hint'),
        clock: $<HTMLElement>('.pool-clock'),
        now: opts.now,
        mySlot,
        ...opts.pool!,
      });
    } else if (!live && pool) {
      pool.destroy();
      pool = null;
    }
    poolInfo.hidden = !pool;
    poolControls.hidden = !(pool && mine && v?.status === 'playing');
    if (pool && v) {
      pool.update(v);
      renderLeft(poolInfo, v);
    }
    if (pong && v) pong.update(v);
    else if (!pool) {
      drawCourt(court, opts.kind, v ? sideNames(v, 'a') : '', v ? sideNames(v, 'b') : '');
    }

    // Botões e vagas só são refeitos quando mudam: a mira e as raquetes chegam várias vezes por
    // segundo, e refazer um botão no meio do clique perderia o clique.
    const controls = JSON.stringify([
      busy,
      mode,
      v?.status ?? '',
      me,
      ARCADE_SLOTS.map((s) => {
        const seat = v?.seats[s];
        const left = seat && seat.awayUntil > now ? Math.ceil((seat.awayUntil - now) / 1000) : 0;
        return [seat?.session ?? '', seat?.name ?? '', left];
      }),
    ]);
    if (controls === controlsKey) return;
    controlsKey = controls;

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
    pong?.destroy();
    pool?.destroy();
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
    cheered(msg) {
      // O emoji pula sobre a vista da mesa, com o nome de quem torceu.
      const pop = Object.assign(document.createElement('span'), {
        className: 'arcade-cheer-pop',
        textContent: ARCADE_CHEERS[msg.cheer].emoji,
        title: msg.name,
      });
      pop.style.left = `${15 + Math.random() * 70}%`;
      pop.style.top = `${court.offsetTop + court.offsetHeight / 2}px`;
      court.insertAdjacentElement('afterend', pop);
      window.setTimeout(() => pop.remove(), 1600);
    },
    close,
  };
}

/** O que acontece no ping-pong agora: de quem é o saque, o ponto, o deuce. */
function pongStatus(v: ArcadeView, mine: ArcadeSlot | undefined): string {
  const deuce = v.scoreA >= 10 && v.scoreB >= 10 ? ' Deuce!' : '';
  if (v.phase === 'point') return v.detail;
  if (v.phase === 'serve' && v.turn) {
    return v.turn === mine
      ? `Seu saque: clique na mesa.${deuce}`
      : `Saque de ${v.seats[v.turn].name}.${deuce}`;
  }
  return mine ? `Valendo!${deuce}` : `👀 Você está assistindo.${deuce}`;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** O que acontece na sinuca agora: de quem é a vez, bola na mão, a tacada rolando. */
function poolStatus(v: ArcadeView, mine: ArcadeSlot | undefined): string {
  const name = v.turn ? v.seats[v.turn].name : '';
  if (v.phase === 'shot') return `🎱 Tacada de ${name}…`;
  if (v.turn && v.turn === mine) return v.pool.inHand ? 'Sua vez! Bola na mão.' : 'Sua vez!';
  return `${mine ? '' : '👀 '}Vez de ${name}${v.pool.inHand ? ' (bola na mão)' : ''}.`;
}

/** Bolas que faltam de cada lado (o grupo e as bolinhas), em cima da mesa. */
function renderLeft(info: HTMLElement, v: ArcadeView): void {
  const g = v.pool.groupA;
  for (const side of ['a', 'b'] as const) {
    const el = info.querySelector<HTMLElement>(`.pool-left.${side}`)!;
    const left = poolLeft(v, side);
    const group = g ? GROUP_NAMES[side === 'a' ? g : otherGroup(g)] : '';
    const label = !g ? 'mesa aberta' : left[0] === 8 ? 'falta a 8' : group;
    const key = `${label}|${left.join(',')}`;
    if (el.dataset.key === key) continue;
    el.dataset.key = key;
    const chips = left.map((ball) => {
      const chip = document.createElement('span');
      chip.className = `pool-chip${ball > 8 ? ' stripe' : ''}`;
      chip.style.setProperty('--c', poolBallColor(ball));
      chip.title = String(ball);
      return chip;
    });
    const text = Object.assign(document.createElement('span'), {
      className: 'pool-group',
      textContent: label,
    });
    el.replaceChildren(...(side === 'a' ? [text, ...chips] : [...chips, text]));
    el.setAttribute(
      'aria-label',
      `${SIDE_LABEL[side]}: ${label}${g && left[0] !== 8 ? `, faltam ${left.length}` : ''}`,
    );
  }
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
