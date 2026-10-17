import type { GameScore, TttScores } from '@office/shared';

/** O que o painel precisa da partida (espelho do `TttGame` do estado). */
export interface TttView {
  xSession: string;
  xName: string;
  oSession: string;
  oName: string;
  board: string;
  turn: string;
  status: string;
  winner: string;
  line: string;
}

export interface TicTacToeOptions {
  furniId: string;
  mySessionId: () => string;
  join(): void;
  leave(): void;
  move(cell: number): void;
  rematch(): void;
  loadScores(): Promise<TttScores>;
}

export interface TicTacToeHandle {
  furniId: string;
  /** A partida mudou (ou acabou: `null` = mesa vazia). */
  update(game: TttView | null): void;
  close(): void;
}

const MARK_ICON: Record<string, string> = { X: '❌', O: '⭕' };

/**
 * Painel flutuante do jogo da velha (não bloqueia a sala: dá para ver os avatares
 * sentados). Jogadores marcam casas; quem não está na mesa assiste ao vivo.
 */
export function openTicTacToe(opts: TicTacToeOptions): TicTacToeHandle {
  const panel = document.createElement('section');
  panel.className = 'ttt-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'ttt-title');
  panel.innerHTML = `
    <header class="ttt-head">
      <h2 id="ttt-title">🎮 Jogo da velha</h2>
      <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
    </header>
    <div class="ttt-players"></div>
    <p class="ttt-status" aria-live="polite"></p>
    <div class="ttt-board" role="grid" aria-label="Tabuleiro"></div>
    <div class="ttt-actions"></div>
    <details class="ttt-scores" open>
      <summary>🏆 Placar</summary>
      <ol></ol>
    </details>`;
  document.body.append(panel);
  const $ = <T extends Element>(sel: string) => panel.querySelector<T>(sel)!;
  const players = $<HTMLElement>('.ttt-players');
  const status = $<HTMLElement>('.ttt-status');
  const boardEl = $<HTMLElement>('.ttt-board');
  const actions = $<HTMLElement>('.ttt-actions');
  const scoresEl = $<HTMLOListElement>('.ttt-scores ol');

  const cells = Array.from({ length: 9 }, (_, i) => {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'ttt-cell',
    });
    b.setAttribute('role', 'gridcell');
    b.addEventListener('click', () => opts.move(i));
    boardEl.append(b);
    return b;
  });

  let game: TttView | null = null;
  let lastStatus = '';

  const button = (label: string, cls: string, onClick: () => void) => {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: cls,
      textContent: label,
    });
    b.addEventListener('click', onClick);
    return b;
  };

  const render = () => {
    const me = opts.mySessionId();
    const g = game;
    const myMark = g?.xSession === me ? 'X' : g?.oSession === me ? 'O' : null;
    const nameOf = (m: string) => (m === 'X' ? g?.xName : g?.oName) || '';

    players.replaceChildren(
      ...(['X', 'O'] as const).map((m) => {
        const seat = m === 'X' ? g?.xSession : g?.oSession;
        const div = document.createElement('div');
        div.className = 'ttt-player';
        if (g?.status === 'playing' && g.turn === m) div.classList.add('turn');
        div.append(
          Object.assign(document.createElement('span'), { textContent: MARK_ICON[m] }),
          Object.assign(document.createElement('span'), {
            className: seat ? '' : 'muted',
            textContent: seat ? `${nameOf(m)}${seat === me ? ' (você)' : ''}` : 'lugar livre',
          }),
        );
        return div;
      }),
    );

    const full = Boolean(g?.xSession && g?.oSession);
    let text: string;
    if (!g || (g.status === 'waiting' && !g.xSession && !g.oSession)) {
      text = 'Mesa livre. Clique em Jogar para sentar.';
    } else if (g.status === 'waiting') {
      text = myMark ? 'Esperando um adversário sentar…' : 'Falta um jogador. Que tal jogar?';
    } else if (g.status === 'playing') {
      text = g.turn === myMark ? 'Sua vez!' : `Vez de ${nameOf(g.turn)} ${MARK_ICON[g.turn]}`;
    } else if (g.winner === 'draw') {
      text = 'Deu velha! Empate.';
    } else {
      text = g.winner === myMark ? 'Você venceu! 🏆' : `${nameOf(g.winner) || 'Alguém'} venceu! 🏆`;
      if (!full) text += ' Esperando adversário para outra partida.';
    }
    status.textContent = text;

    const board = g?.board ?? '.........';
    const line = new Set((g?.line ?? '').split(',').filter(Boolean).map(Number));
    const canPlay = g?.status === 'playing' && g.turn === myMark;
    cells.forEach((c, i) => {
      const mark = board[i]!;
      c.textContent = mark === '.' ? '' : mark;
      c.className = `ttt-cell${mark === 'X' ? ' x' : mark === 'O' ? ' o' : ''}${line.has(i) ? ' win' : ''}`;
      c.disabled = !canPlay || mark !== '.';
      c.setAttribute(
        'aria-label',
        `Casa ${i + 1}: ${mark === '.' ? 'livre' : mark === 'X' ? 'xis' : 'bola'}`,
      );
    });

    const btns: HTMLElement[] = [];
    if (!myMark && !full) btns.push(button('Jogar', 'btn-primary', opts.join));
    if (myMark && g?.status === 'ended' && full) {
      btns.push(button('Revanche', 'btn-primary', opts.rematch));
    }
    if (myMark) btns.push(button('Sair da mesa', 'btn-secondary', opts.leave));
    if (!myMark && full) {
      btns.push(
        Object.assign(document.createElement('span'), {
          className: 'muted',
          textContent: '👀 Você está assistindo.',
        }),
      );
    }
    actions.replaceChildren(...btns);

    // Placar novo quando uma partida termina.
    const st = `${g?.status ?? ''}:${g?.winner ?? ''}`;
    if (st !== lastStatus) {
      lastStatus = st;
      if (!g || g.status !== 'playing') void refreshScores();
    }
  };

  const scoreLine = (s: GameScore, i: number) => {
    const li = document.createElement('li');
    li.append(
      Object.assign(document.createElement('span'), { textContent: `${i + 1}. ${s.name}` }),
      Object.assign(document.createElement('span'), {
        className: 'muted',
        textContent: `${s.wins}V · ${s.losses}D · ${s.draws}E`,
      }),
    );
    return li;
  };

  const refreshScores = async () => {
    const { top } = await opts.loadScores();
    scoresEl.replaceChildren(
      ...(top.length
        ? top.map(scoreLine)
        : [
            Object.assign(document.createElement('li'), {
              className: 'muted',
              textContent: 'Ninguém jogou ainda.',
            }),
          ]),
    );
  };

  // Arrastar pelo título, para não cobrir a mesa nem quem está jogando.
  const head = $<HTMLElement>('.ttt-head');
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - r.width);
      const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 40);
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  const close = () => {
    panel.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  $('.sheet-close').addEventListener('click', close);
  render();

  return {
    furniId: opts.furniId,
    update(g) {
      game = g;
      if (panel.isConnected) render();
    },
    close,
  };
}
