import {
  ARCADE_CPU_SESSION,
  ARCADE_LEVELS,
  LEVEL_NAMES,
  ARCADE_CHEERS,
  ARCADE_CHEER_IDS,
  ARCADE_INFO,
  ARCADE_SLOTS,
  GROUP_NAMES,
  otherGroup,
  sideNames,
  sideOf,
  sideSlots,
  slotsOf,
  type ArcadeCheer,
  type ArcadeCheerMessage,
  type ArcadeKind,
  type ArcadeLevel,
  type ArcadeSolo,
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
  /** Jogar sozinho (treino ou contra o computador). */
  solo(solo: ArcadeSolo, level: ArcadeLevel): Promise<ArcadeReply>;
  /** Pedir a mesa a quem joga sozinho; responder ao pedido. */
  ask(): Promise<ArcadeReply>;
  answer(accept: boolean): Promise<ArcadeReply>;
  mode(mode: ArcadeMode): Promise<ArcadeReply>;
  /** Torcer (quem não está jogando nesta mesa). */
  cheer(cheer: ArcadeCheer): void;
  /** Ranking deste jogo (os melhores e o meu placar). */
  ranking(): Promise<ArcadeRanking | null>;
  /** Ping-pong (Fase 58): raquete, saque e rebatida. */
  pong?: Pick<PongViewOptions, 'paddle' | 'serve' | 'hit'>;
  /** Sinuca (Fase 59): a tacada e a mira ao vivo. */
  pool?: Pick<PoolViewOptions, 'shoot' | 'aim' | 'place' | 'undo' | 'reset'>;
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

/** O nível escolhido fica guardado para as próximas vezes. */
const LEVEL_KEY = 'ev-salao-nivel';
function savedLevel(): ArcadeLevel {
  try {
    return ARCADE_LEVELS.find((l) => l === localStorage.getItem(LEVEL_KEY)) ?? 'medio';
  } catch {
    return 'medio';
  }
}
function saveLevel(level: ArcadeLevel): void {
  try {
    localStorage.setItem(LEVEL_KEY, level);
  } catch {
    // sem armazenamento: vale só agora
  }
}

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
      <button type="button" class="btn-secondary arcade-rules-btn" aria-expanded="false" hidden>Regras</button>
      <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
    </header>
    <section class="pool-rules" aria-label="Regras da sinuca" hidden>${POOL_RULES_HTML}</section>
    <div class="arcade-score" aria-live="polite">
      <span class="arcade-names a"></span>
      <strong class="arcade-points"></strong>
      <span class="arcade-names b"></span>
    </div>
    <p class="arcade-sets muted" hidden></p>
    <p class="arcade-status"></p>
    <div class="pool-turn" role="status" hidden>
      <strong class="pool-turn-title"></strong>
      <span class="pool-turn-goal"></span>
    </div>
    <div class="pool-info" hidden>
      <div class="pool-left a"></div>
      <span class="pool-clock"></span>
      <div class="pool-left b"></div>
    </div>
    <canvas class="arcade-court" aria-hidden="true"></canvas>
    <div class="pool-controls" hidden>
      <div class="pool-spin-box">
        <div class="pool-spin" role="img" aria-label="Efeito na branca"
          title="Efeito: clique onde o taco bate na branca (em cima segue, embaixo volta, no meio sem efeito)"></div>
        <span class="pool-spin-label">Efeito</span>
      </div>
      <p class="pool-hint"></p>
    </div>
    <ol class="pool-log" aria-label="Últimas tacadas" hidden></ol>
    <div class="arcade-cheers" role="group" aria-label="Torcida" hidden></div>
    <div class="arcade-mode" role="group" aria-label="Modo de jogo"></div>
    <div class="arcade-slots"></div>
    <div class="arcade-ask" role="alertdialog" aria-label="Pedido da mesa" hidden></div>
    <div class="arcade-solo" role="group" aria-label="Jogar sozinho" hidden></div>
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
  const soloEl = $<HTMLElement>('.arcade-solo');
  const askEl = $<HTMLElement>('.arcade-ask');
  const scoreEl = $<HTMLElement>('.arcade-score');
  const poolTurn = $<HTMLElement>('.pool-turn');
  const poolLog = $<HTMLElement>('.pool-log');
  const rulesBtn = $<HTMLButtonElement>('.arcade-rules-btn');
  const rulesEl = $<HTMLElement>('.pool-rules');
  rulesBtn.hidden = opts.kind !== 'pool';
  rulesBtn.addEventListener('click', () => {
    rulesEl.hidden = !rulesEl.hidden;
    rulesBtn.setAttribute('aria-expanded', String(!rulesEl.hidden));
  });
  /** Tutorial da sinuca: na primeira vez que a pessoa senta numa mesa. */
  let tutorialShown = false;
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
    // Gente de verdade nas vagas (o computador não conta para começar uma partida entre pessoas).
    const people = v
      ? slotsOf(mode).filter((s) => v.seats[s].session && v.seats[s].session !== ARCADE_CPU_SESSION)
      : [];
    const full = people.length === slotsOf(mode).length;
    const now = opts.now();

    // Os textos só mudam quando mudam de verdade (o placar é lido por leitores de tela).
    setText(namesA, (v && sideNames(v, 'a')) || '—');
    setText(namesB, (v && sideNames(v, 'b')) || '—');
    setText(points, v && v.status !== 'waiting' ? `${v.scoreA} × ${v.scoreB}` : '×');
    // Ping-pong: os sets; sinuca: o que a última tacada deu (falta, grupos, a vez).
    if (opts.kind === 'pingpong') {
      setsEl.hidden = !(v && v.status !== 'waiting');
      // Treino com a máquina: o placar é devolvidas × perdidas, sem sets.
      if (v) {
        setText(
          setsEl,
          v.solo === 'practice' ? 'Devolvidas × perdidas' : `Sets ${v.setsA} × ${v.setsB}`,
        );
      }
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
        turnTitle: $<HTMLElement>('.pool-turn-title'),
        turnGoal: $<HTMLElement>('.pool-turn-goal'),
        log: poolLog,
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
    // Sinuca ao vivo: a faixa da vez e os cartões de cada lado no lugar do placar e do status.
    poolTurn.hidden = !pool || v?.status !== 'playing';
    poolLog.hidden = !pool || !v?.pool.log.length;
    scoreEl.hidden = Boolean(pool);
    // Partida em andamento na mesa ao vivo: as vagas e o modo já estão nos cartões; a mesa cresce.
    const busy = live && v?.status === 'playing';
    modeEl.hidden = busy;
    slotsEl.hidden = busy;
    // O detalhe da última tacada já está no histórico.
    if (pool) setsEl.hidden = true;
    status.hidden = Boolean(pool) && v?.status === 'playing';
    if (opts.kind === 'pool' && mine && !tutorialShown) {
      tutorialShown = true;
      showPoolTutorial(panel);
    }
    if (pool && v) {
      pool.update(v);
      renderLeft(poolInfo, v, opts.mySessionId());
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
      v?.solo ?? '',
      v?.ask ? [v.ask.session, Math.ceil((v.ask.until - now) / 1000)] : null,
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

    renderSolo(v, mine, people.length, now);

    // Ações de quem joga.
    const btns: HTMLElement[] = [];
    if (mine && v?.status !== 'playing' && full) {
      btns.push(button('Começar', 'btn-primary', act(opts.start)));
    }
    if (mine && v?.status === 'playing') {
      const practice = v.solo === 'practice';
      if (practice && opts.kind === 'pool') {
        btns.push(
          button('Repetir a última tacada', 'btn-secondary', () => {
            pool?.repeatLast();
          }),
          button(
            'Arrumar de novo',
            'btn-secondary',
            act(() => opts.pool!.reset()),
          ),
        );
      }
      btns.push(button(practice ? 'Parar treino' : 'Desistir', 'btn-secondary', act(opts.forfeit)));
    }
    if (mine && v?.status !== 'playing') {
      btns.push(button('Sair da vaga', 'btn-secondary', act(opts.leave)));
    }
    actions.replaceChildren(...btns);
  };

  /**
   * Jogar sozinho: as opções (só eu na mesa, antes de começar); para quem assiste, pedir a mesa; e
   * para quem joga sozinho, o pedido de alguém (com a contagem até liberar sozinho).
   */
  const renderSolo = (
    v: ArcadeView | null,
    mine: ArcadeSlot | undefined,
    people: number,
    now: number,
  ) => {
    soloEl.replaceChildren();
    askEl.replaceChildren();
    soloEl.hidden = true;
    askEl.hidden = true;
    const me = opts.mySessionId();
    const left = v?.ask ? Math.max(0, Math.ceil((v.ask.until - now) / 1000)) : 0;
    // Só eu na mesa, antes de começar: treino ou contra o computador.
    if (mine && v?.status !== 'playing' && people === 1) {
      soloEl.hidden = false;
      const level = Object.assign(document.createElement('select'), { className: 'arcade-level' });
      level.setAttribute('aria-label', 'Dificuldade');
      for (const l of ARCADE_LEVELS) {
        level.append(new Option(`Nível ${LEVEL_NAMES[l]}`, l, false, l === savedLevel()));
      }
      level.addEventListener('change', () => saveLevel(level.value as ArcadeLevel));
      const pick = () => (level.value as ArcadeLevel) || 'medio';
      soloEl.append(
        Object.assign(document.createElement('strong'), { textContent: 'Jogar sozinho' }),
        button(
          opts.kind === 'pool' ? 'Treino livre' : 'Máquina de bolas',
          'btn-secondary',
          act(() => opts.solo('practice', pick())),
        ),
        button(
          'Contra o computador',
          'btn-secondary',
          act(() => opts.solo('cpu', pick())),
        ),
        level,
        Object.assign(document.createElement('small'), {
          className: 'muted',
          textContent:
            opts.kind === 'pool'
              ? 'Não conta no ranking. O nível vale para o computador.'
              : 'Não conta no ranking. O nível vale para a máquina e para o computador.',
        }),
      );
      return;
    }
    if (!v?.solo || v.status !== 'playing') return;
    // Quem joga sozinho: alguém pediu a mesa.
    if (mine && v.ask) {
      askEl.hidden = false;
      askEl.append(
        Object.assign(document.createElement('p'), {
          textContent: `${v.ask.name} quer jogar nesta mesa. Sem resposta, ela é liberada em ${left} s.`,
        }),
        button(
          `Jogar contra ${v.ask.name}`,
          'btn-primary',
          act(() => opts.answer(true)),
        ),
        button(
          'Continuar sozinho',
          'btn-secondary',
          act(() => opts.answer(false)),
        ),
      );
      return;
    }
    if (mine) return;
    // Quem assiste: pedir a mesa (ou esperar a resposta).
    soloEl.hidden = false;
    const trainee = Object.values(v.seats).find(
      (s) => s.session && s.session !== ARCADE_CPU_SESSION,
    );
    const who = trainee?.name ?? 'Quem joga';
    if (v.ask?.session === me) {
      soloEl.append(
        Object.assign(document.createElement('p'), {
          textContent: `Pedido enviado. Esperando ${who} responder (libera em ${left} s).`,
        }),
      );
    } else if (v.ask) {
      soloEl.append(
        Object.assign(document.createElement('p'), {
          textContent: `${v.ask.name} já pediu a mesa.`,
        }),
      );
    } else {
      soloEl.append(
        Object.assign(document.createElement('p'), {
          textContent: `${who} está ${v.solo === 'practice' ? 'treinando' : 'jogando contra o computador'}.`,
        }),
        button('Pedir a mesa', 'btn-primary', act(opts.ask)),
      );
    }
  };

  // Contagem do W.O. e do pedido da mesa, ao vivo.
  const timer = window.setInterval(() => {
    if (
      view?.status === 'playing' &&
      (view.ask || ARCADE_SLOTS.some((s) => view!.seats[s].awayUntil))
    ) {
      render();
    }
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
  const deuce = v.scoreA >= 10 && v.scoreB >= 10 && v.solo !== 'practice' ? ' Deuce!' : '';
  if (v.phase === 'point') return v.detail;
  if (v.solo === 'practice') {
    return v.phase === 'serve'
      ? 'A máquina vai lançar…'
      : v.detail || (mine ? 'Devolva a bola!' : '👀 Você está assistindo.');
  }
  if (v.phase === 'serve' && v.turn) {
    return v.turn === mine
      ? `Seu saque: clique, aperte espaço ou espere.${deuce}`
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

/**
 * Cartão de cada lado, em cima da mesa: quem joga, o grupo (ou mesa aberta), quantas faltam e as
 * bolinhas. O lado da vez fica destacado.
 */
function renderLeft(info: HTMLElement, v: ArcadeView, me: string): void {
  const g = v.pool.groupA;
  const turnSide = v.turn ? sideOf(v.turn) : null;
  for (const side of ['a', 'b'] as const) {
    const el = info.querySelector<HTMLElement>(`.pool-left.${side}`)!;
    // Treino: só o cartão de quem treina, com as bolas que já caíram.
    const practice = v.solo === 'practice';
    const seatedHere = sideSlots(side, v.mode).some((s) => v.seats[s].session);
    el.style.visibility = practice && !seatedHere ? 'hidden' : '';
    const left = poolLeft(v, side);
    const group = g ? GROUP_NAMES[side === 'a' ? g : otherGroup(g)] : '';
    const eight = left[0] === 8;
    const score = side === 'a' ? v.scoreA : v.scoreB;
    const label = practice ? 'treino' : !g ? 'mesa aberta' : group;
    const count = practice
      ? `caíram ${score}`
      : !g
        ? 'grupo a definir'
        : eight
          ? 'só falta a 8'
          : `faltam ${left.length}`;
    const names = sideNames(v, side) || SIDE_LABEL[side];
    const you = sideSlots(side, v.mode).some((s) => v.seats[s].session === me);
    const isTurn = v.status === 'playing' && turnSide === side;
    el.classList.toggle('turn', isTurn);
    const key = `${names}|${you}|${label}|${count}|${left.join(',')}`;
    if (el.dataset.key === key) continue;
    el.dataset.key = key;
    const chips = left.map((ball) => {
      const chip = document.createElement('span');
      chip.className = `pool-chip${ball > 8 ? ' stripe' : ''}`;
      chip.style.setProperty('--c', poolBallColor(ball));
      chip.title = String(ball);
      return chip;
    });
    const who = Object.assign(document.createElement('strong'), {
      className: 'pool-who',
      textContent: you ? `${names} (você)` : names,
    });
    const text = Object.assign(document.createElement('span'), {
      className: 'pool-group',
      textContent: `${label} · ${count}`,
    });
    const balls = Object.assign(document.createElement('span'), { className: 'pool-chips' });
    balls.append(...chips);
    el.replaceChildren(who, text, balls);
    el.setAttribute('aria-label', `${names}${you ? ' (você)' : ''}: ${label}, ${count}`);
  }
}

/** Regras da sinuca em poucas linhas (botão Regras). */
const POOL_RULES_HTML = `
  <h3>Como se joga</h3>
  <ol>
    <li><strong>Objetivo:</strong> encaçapar as 7 bolas do seu grupo (lisas, de 1 a 7, ou listradas, de 9 a 15) e depois a 8.</li>
    <li><strong>Mesa aberta:</strong> no começo ninguém tem grupo. A primeira bola que você encaçapar (fora da abertura) define o seu.</li>
    <li><strong>Sua vez continua</strong> enquanto você encaçapar bolas do seu grupo.</li>
    <li><strong>Faltas:</strong> a branca cair, não acertar nenhuma bola, acertar primeiro uma bola que não é sua (ou a 8 antes da hora), ou nenhuma bola cair nem encostar na tabela depois do choque.</li>
    <li><strong>Bola na mão:</strong> depois de uma falta, o adversário põe a branca onde quiser.</li>
    <li><strong>A 8:</strong> com o seu grupo todo encaçapado, escolha a caçapa e encaçape a 8 nela. Ganha quem acertar. Perde quem derrubar a 8 antes da hora, em outra caçapa ou com falta.</li>
  </ol>
  <h3>Controles</h3>
  <p>Arraste na mesa para mirar (as setas afinam). Puxe a barra de <strong>Força</strong> para baixo e solte para tacar. No círculo de <strong>Efeito</strong>, em cima a branca segue, embaixo ela volta.</p>`;

const TUTORIAL_KEY = 'ev-sinuca-tutorial';
const TUTORIAL_STEPS: { title: string; text: string }[] = [
  {
    title: 'O objetivo',
    text: 'Encaçape as 7 bolas do seu grupo (lisas ou listradas) e depois a 8. A primeira bola que cair define o seu grupo.',
  },
  {
    title: 'Mirar',
    text: 'Arraste na mesa para mirar. A linha mostra onde a branca bate e para onde a bola vai. Vermelha quer dizer que essa bola não é sua: daria falta.',
  },
  {
    title: 'Força e efeito',
    text: 'Puxe a barra de Força para baixo e solte para tacar. No meio da barra, a branca anda mais ou menos uma mesa. No círculo de Efeito, em cima ela segue e embaixo ela volta.',
  },
  {
    title: 'Faltas e a 8',
    text: 'Falta dá bola na mão ao adversário. No fim, escolha a caçapa da 8 antes de tacar. O histórico embaixo da mesa explica cada falta, e o botão Regras fica sempre à mão.',
  },
];

/** Tutorial rápido da sinuca, na primeira mesa em que a pessoa senta (dá para pular). */
function showPoolTutorial(panel: HTMLElement): void {
  try {
    if (localStorage.getItem(TUTORIAL_KEY)) return;
  } catch {
    return;
  }
  const box = document.createElement('div');
  box.className = 'pool-tutorial';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Como jogar sinuca');
  let step = 0;
  const done = () => {
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch {
      // sem armazenamento: aparece de novo na próxima vez
    }
    box.remove();
  };
  const render = () => {
    const s = TUTORIAL_STEPS[step]!;
    const title = Object.assign(document.createElement('h3'), {
      textContent: `${step + 1}/${TUTORIAL_STEPS.length} · ${s.title}`,
    });
    const text = Object.assign(document.createElement('p'), { textContent: s.text });
    const actions = Object.assign(document.createElement('div'), { className: 'confirm-actions' });
    const skip = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-secondary',
      textContent: 'Pular',
    });
    skip.addEventListener('click', done);
    const last = step === TUTORIAL_STEPS.length - 1;
    const next = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-primary',
      textContent: last ? 'Entendi' : 'Próximo',
    });
    next.addEventListener('click', () => {
      if (last) return done();
      step++;
      render();
    });
    actions.append(...(last ? [next] : [skip, next]));
    box.replaceChildren(title, text, actions);
    next.focus();
  };
  // Entra no fluxo do painel (antes das vagas), sem cobrir a mesa nem os botões.
  (panel.querySelector('.arcade-mode') ?? panel).before(box);
  render();
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
