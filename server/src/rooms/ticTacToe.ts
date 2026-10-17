import { otherMark, TTT_EMPTY, tttFull, tttWinner, TttGame, type TttMark } from '@office/shared';

export interface TttSeat {
  session: string;
  user: string;
  name: string;
}

/** Fim de partida: quem venceu (marca) ou empate. */
export type TttOutcome = { winner: TttMark } | { draw: true };

type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/**
 * Regras do jogo da velha sobre o estado sincronizado (`TttGame`). Só mexe no estado; placar,
 * chat e avatar ficam com a sala.
 */
export function newGame(): TttGame {
  return Object.assign(new TttGame(), {
    xSession: '',
    xUser: '',
    xName: '',
    oSession: '',
    oUser: '',
    oName: '',
    board: TTT_EMPTY,
    turn: 'X',
    starter: 'X',
    status: 'waiting',
    winner: '',
    line: '',
  });
}

export function markOf(game: TttGame, session: string): TttMark | null {
  if (game.xSession === session) return 'X';
  if (game.oSession === session) return 'O';
  return null;
}

export function seatOf(game: TttGame, mark: TttMark): TttSeat {
  return mark === 'X'
    ? { session: game.xSession, user: game.xUser, name: game.xName }
    : { session: game.oSession, user: game.oUser, name: game.oName };
}

function setSeat(game: TttGame, mark: TttMark, seat: TttSeat): void {
  if (mark === 'X')
    Object.assign(game, { xSession: seat.session, xUser: seat.user, xName: seat.name });
  else Object.assign(game, { oSession: seat.session, oUser: seat.user, oName: seat.name });
}

const EMPTY_SEAT: TttSeat = { session: '', user: '', name: '' };

/** Pega o lugar livre (X primeiro). Com os dois lugares ocupados, a partida começa. */
export function join(game: TttGame, seat: TttSeat): Result<{ mark: TttMark }> {
  if (markOf(game, seat.session)) return { ok: false, reason: 'Você já está nesta mesa.' };
  if (seat.user && (game.xUser === seat.user || game.oUser === seat.user)) {
    return { ok: false, reason: 'Você já está jogando nesta mesa (em outra aba).' };
  }
  const mark: TttMark | null = !game.xSession ? 'X' : !game.oSession ? 'O' : null;
  if (!mark) return { ok: false, reason: 'A mesa já tem dois jogadores.' };
  // Partida anterior (que alguém abandonou) sai do tabuleiro quando chega gente nova.
  if (game.status === 'ended') {
    Object.assign(game, { status: 'waiting', board: TTT_EMPTY, winner: '', line: '', turn: 'X' });
  }
  setSeat(game, mark, seat);
  if (game.xSession && game.oSession) start(game, game.starter as TttMark);
  return { ok: true, mark };
}

function start(game: TttGame, starter: TttMark): void {
  Object.assign(game, {
    board: TTT_EMPTY,
    starter,
    turn: starter,
    status: 'playing',
    winner: '',
    line: '',
  });
}

/** Marca uma casa. Devolve o resultado se a partida acabou. */
export function play(
  game: TttGame,
  session: string,
  cell: number,
): Result<{ outcome?: TttOutcome }> {
  const mark = markOf(game, session);
  if (!mark) return { ok: false, reason: 'Você não está jogando nesta mesa.' };
  if (game.status !== 'playing') return { ok: false, reason: 'A partida não está em andamento.' };
  if (game.turn !== mark) return { ok: false, reason: 'Espere a sua vez.' };
  if (game.board[cell] !== '.') return { ok: false, reason: 'Essa casa já foi marcada.' };
  game.board = game.board.slice(0, cell) + mark + game.board.slice(cell + 1);
  const win = tttWinner(game.board);
  if (win) {
    Object.assign(game, { status: 'ended', winner: win.mark, line: win.line.join(',') });
    return { ok: true, outcome: { winner: win.mark } };
  }
  if (tttFull(game.board)) {
    Object.assign(game, { status: 'ended', winner: 'draw' });
    return { ok: true, outcome: { draw: true } };
  }
  game.turn = otherMark(mark);
  return { ok: true };
}

/** Revanche: mesmo par, quem não começou da última vez começa agora. */
export function rematch(game: TttGame, session: string): Result {
  if (!markOf(game, session)) return { ok: false, reason: 'Você não está jogando nesta mesa.' };
  if (game.status !== 'ended') return { ok: false, reason: 'A partida ainda não terminou.' };
  if (!game.xSession || !game.oSession) return { ok: false, reason: 'Falta um jogador.' };
  start(game, otherMark(game.starter as TttMark));
  return { ok: true };
}

/**
 * Sai da mesa. No meio da partida, o outro vence por W.O. Devolve quem saiu, o lugar e,
 * se houver, o vencedor por desistência.
 */
export function leave(
  game: TttGame,
  session: string,
): { left: TttSeat; mark: TttMark; forfeitTo?: TttSeat } | null {
  const mark = markOf(game, session);
  if (!mark) return null;
  const left = seatOf(game, mark);
  const other = seatOf(game, otherMark(mark));
  const forfeit = game.status === 'playing' && other.session !== '';
  setSeat(game, mark, EMPTY_SEAT);
  // O tabuleiro fica à mostra até alguém sentar de novo.
  if (game.status === 'playing') {
    Object.assign(game, { status: 'ended', winner: otherMark(mark), line: '' });
  }
  // Quem entrar depois espera um adversário; a mesa recomeça do zero com X.
  if (game.status === 'ended') game.starter = 'X';
  return forfeit ? { left, mark, forfeitTo: other } : { left, mark };
}

/** Ninguém sentado: a sala pode descartar a partida. */
export function isEmpty(game: TttGame): boolean {
  return !game.xSession && !game.oSession;
}
