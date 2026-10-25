import {
  ARCADE_ASK_MS,
  ARCADE_CPU_SESSION,
  ARCADE_SLOTS,
  ARCADE_WO_MS,
  soloOpponentName,
  ArcadeGame,
  otherSide,
  seatOf,
  sideOf,
  sideSlots,
  slotsOf,
  type ArcadeKind,
  type ArcadeLevel,
  type ArcadeMode,
  type ArcadeSeat,
  type ArcadeSide,
  type ArcadeSlot,
  type ArcadeSolo,
} from '@office/shared';

/** Quem ocupa uma vaga: sessão (avatar), conta e nome. */
export interface ArcadePlayer {
  session: string;
  user: string;
  name: string;
}

/** Fim de partida: o lado vencedor, como acabou e quem estava de cada lado. */
export interface ArcadeOutcome {
  winner: ArcadeSide;
  end: 'points' | 'forfeit' | 'wo';
  winners: ArcadePlayer[];
  losers: ArcadePlayer[];
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/** Prazo para voltar antes do W.O. e para responder ao pedido da mesa (os testes encurtam). */
export const arcadeTiming = { woMs: ARCADE_WO_MS, askMs: ARCADE_ASK_MS };

const EMPTY: ArcadeSeat = { session: '', user: '', name: '', awayUntil: 0 };

/**
 * Regras das mesas do Salão de Jogos (Fase 57) sobre o estado sincronizado (`ArcadeGame`): vagas,
 * modo, começar, desistir e quem sai da sala. Só mexe no estado; placar, chat e avatar ficam
 * com a sala.
 */
export function newArcade(kind: ArcadeKind): ArcadeGame {
  const g = new ArcadeGame();
  Object.assign(g, { kind, mode: 1 });
  resetMatch(g);
  for (const s of ARCADE_SLOTS) setSeat(g, s, EMPTY);
  return g;
}

function setSeat(g: ArcadeGame, slot: ArcadeSlot, seat: ArcadeSeat): void {
  g[`${slot}Session`] = seat.session;
  g[`${slot}User`] = seat.user;
  g[`${slot}Name`] = seat.name;
  g[`${slot}Away`] = seat.awayUntil;
}

/** É o computador (ou a máquina de bolas), não alguém da sala. */
export const isCpu = (session: string) => session === ARCADE_CPU_SESSION;

function resetMatch(g: ArcadeGame): void {
  // Quem joga sozinho volta a ser só a pessoa: o computador sai da vaga dele.
  for (const s of ARCADE_SLOTS) if (isCpu(g[`${s}Session`])) setSeat(g, s, EMPTY);
  Object.assign(g, {
    solo: '',
    level: '',
    askSession: '',
    askName: '',
    askUntil: 0,
    status: 'waiting',
    scoreA: 0,
    scoreB: 0,
    setsA: 0,
    setsB: 0,
    turn: '',
    phase: '',
    ball: '',
    balls: '',
    shot: '',
    groupA: '',
    inHand: false,
    breakShot: false,
    deadline: 0,
    aim: '',
    detail: '',
    log: '',
    winner: '',
    end: '',
  });
}

/** A vaga desta sessão (em qualquer modo). */
export function slotOf(g: ArcadeGame, session: string): ArcadeSlot | null {
  return ARCADE_SLOTS.find((s) => session && g[`${s}Session`] === session) ?? null;
}

/** Ninguém da sala na mesa (o computador não conta): a sala pode descartar a partida. */
export function isEmpty(g: ArcadeGame): boolean {
  return ARCADE_SLOTS.every((s) => !g[`${s}Session`] || isCpu(g[`${s}Session`]));
}

/** A vaga do computador (ou da máquina), se houver. */
export function cpuSlot(g: ArcadeGame): ArcadeSlot | null {
  return ARCADE_SLOTS.find((s) => isCpu(g[`${s}Session`])) ?? null;
}

/**
 * Joga sozinho: só eu na mesa, no 1×1. No treino de sinuca a outra vaga fica vazia; no do
 * ping-pong entra a máquina de bolas; contra o computador, ele.
 */
export function startSolo(
  g: ArcadeGame,
  session: string,
  solo: ArcadeSolo,
  level: ArcadeLevel,
): Result {
  const mine = slotOf(g, session);
  if (!mine) return { ok: false, reason: 'Entre numa vaga antes.' };
  if (g.status === 'playing') return { ok: false, reason: 'A partida já começou.' };
  if (ARCADE_SLOTS.some((s) => s !== mine && g[`${s}Session`] && !isCpu(g[`${s}Session`]))) {
    return { ok: false, reason: 'Para jogar sozinho, a mesa precisa estar só com você.' };
  }
  resetMatch(g);
  g.mode = 1;
  // Só eu, na primeira vaga do meu lado (no 2×2 eu podia estar na segunda).
  const side = sideOf(mine);
  const me = seatOf(g, mine);
  const slot = `${side}1` as ArcadeSlot;
  if (mine !== slot) {
    setSeat(g, mine, EMPTY);
    setSeat(g, slot, me);
  }
  const name = soloOpponentName(g.kind as ArcadeKind, solo, level);
  if (name) {
    setSeat(g, `${otherSide(side)}1` as ArcadeSlot, {
      session: ARCADE_CPU_SESSION,
      user: '',
      name,
      awayUntil: 0,
    });
  }
  Object.assign(g, { status: 'playing', solo, level });
  return { ok: true };
}

/** Pedir a mesa a quem joga sozinho: a pessoa responde, e sem resposta a mesa é liberada. */
export function ask(g: ArcadeGame, p: ArcadePlayer, now: number): Result {
  if (!g.solo || g.status !== 'playing') {
    return { ok: false, reason: 'Ninguém está jogando sozinho aqui.' };
  }
  if (slotOf(g, p.session)) return { ok: false, reason: 'Você já está nesta mesa.' };
  if (g.askSession && g.askSession !== p.session && g.askUntil > now) {
    return { ok: false, reason: `${g.askName} já pediu a mesa. Espere a resposta.` };
  }
  Object.assign(g, { askSession: p.session, askName: p.name, askUntil: now + arcadeTiming.askMs });
  return { ok: true };
}

/** A partida sozinha acaba sem resultado: a mesa volta a esperar, com a pessoa na vaga dela. */
export function releaseSolo(g: ArcadeGame): void {
  resetMatch(g);
  g.status = 'waiting';
}

/**
 * Resposta ao pedido (só quem joga sozinho responde). Aceitando, o jogo sozinho acaba e quem
 * pediu fica com a vaga do outro lado (a sala põe a pessoa lá). Devolve quem tinha pedido.
 */
export function answer(
  g: ArcadeGame,
  session: string,
  accept: boolean,
): Result<{ asker: string; name: string }> {
  if (!g.askSession) return { ok: false, reason: 'Ninguém pediu a mesa.' };
  if (!slotOf(g, session) || isCpu(session)) {
    return { ok: false, reason: 'Só quem está jogando responde.' };
  }
  const asker = g.askSession;
  const name = g.askName;
  if (accept) releaseSolo(g);
  else Object.assign(g, { askSession: '', askName: '', askUntil: 0 });
  return { ok: true, asker, name };
}

/** O pedido venceu sem resposta: a mesa é liberada como se tivesse aceitado. */
export function askExpired(g: ArcadeGame, now: number): boolean {
  return Boolean(g.askSession && g.askUntil <= now);
}

/** Quem joga de um lado (no modo atual). */
export function playersOf(g: ArcadeGame, side: ArcadeSide): ArcadePlayer[] {
  return sideSlots(side, g.mode)
    .map((s) => seatOf(g, s))
    .filter((p) => p.session)
    .map(({ session, user, name }) => ({ session, user, name }));
}

/** Entra numa vaga (ou troca de vaga na mesma mesa), antes de a partida começar. */
export function join(g: ArcadeGame, slot: ArcadeSlot, p: ArcadePlayer): Result {
  if (g.status === 'playing')
    return { ok: false, reason: 'A partida já começou. Dá para assistir.' };
  if (!slotsOf(g.mode).includes(slot)) return { ok: false, reason: 'Essa vaga é do 2×2.' };
  const mine = slotOf(g, p.session);
  if (mine === slot) return { ok: true };
  // (A vaga do computador, depois da partida contra ele, está livre.)
  const taken = g[`${slot}Session`];
  if (taken && !isCpu(taken)) return { ok: false, reason: 'Essa vaga já tem alguém.' };
  if (!mine && p.user && ARCADE_SLOTS.some((s) => g[`${s}User`] === p.user)) {
    return { ok: false, reason: 'Você já está nesta mesa (em outra aba).' };
  }
  if (mine) setSeat(g, mine, EMPTY);
  // O resultado da partida anterior sai quando a mesa muda.
  if (g.status === 'ended') resetMatch(g);
  setSeat(g, slot, { ...p, awayUntil: 0 });
  return { ok: true };
}

/** 1×1 ou 2×2, antes de começar. Com gente na mesa, só quem está nela muda. */
export function setMode(g: ArcadeGame, mode: ArcadeMode, session: string): Result {
  if (g.status === 'playing') return { ok: false, reason: 'Não dá para mudar no meio da partida.' };
  if (!isEmpty(g) && !slotOf(g, session)) {
    return { ok: false, reason: 'Só quem está na mesa muda o modo.' };
  }
  if (mode === 1 && (g.a2Session || g.b2Session)) {
    return { ok: false, reason: 'Para voltar ao 1×1, os parceiros saem antes.' };
  }
  if (g.mode !== mode && g.status === 'ended') resetMatch(g);
  g.mode = mode;
  return { ok: true };
}

/** Começa a partida: as vagas do modo cheias, e quem começa está na mesa. */
export function start(g: ArcadeGame, session: string): Result {
  if (!slotOf(g, session)) return { ok: false, reason: 'Só quem está na mesa começa a partida.' };
  if (g.status === 'playing') return { ok: false, reason: 'A partida já começou.' };
  // (Depois de jogar contra o computador, a vaga dele não conta: ele sai ao recomeçar.)
  if (slotsOf(g.mode).some((s) => !g[`${s}Session`] || isCpu(g[`${s}Session`]))) {
    return {
      ok: false,
      reason: g.mode === 2 ? 'Faltam jogadores: o 2×2 precisa de quatro.' : 'Falta um adversário.',
    };
  }
  resetMatch(g);
  g.status = 'playing';
  return { ok: true };
}

function finish(g: ArcadeGame, winner: ArcadeSide, end: ArcadeOutcome['end']): ArcadeOutcome {
  const outcome = {
    winner,
    end,
    winners: playersOf(g, winner),
    losers: playersOf(g, otherSide(winner)),
  };
  // A bola sai da mesa e a mira some; o placar final (e as bolas da sinuca) fica à mostra.
  Object.assign(g, { status: 'ended', winner, end, phase: '', ball: '', aim: '', deadline: 0 });
  return outcome;
}

/** A partida acabou no jogo (Fase 58): o lado que fechou os pontos vence. */
export function finishPoints(g: ArcadeGame, winner: ArcadeSide): ArcadeOutcome {
  return finish(g, winner, 'points');
}

/** Desiste: o outro lado vence. Todos continuam na mesa (dá para começar de novo). */
export function forfeit(g: ArcadeGame, session: string): Result<{ outcome?: ArcadeOutcome }> {
  const slot = slotOf(g, session);
  if (!slot) return { ok: false, reason: 'Você não está jogando nesta mesa.' };
  if (g.status !== 'playing') return { ok: false, reason: 'A partida não está em andamento.' };
  // Treino: só para (não tem quem vença).
  if (g.solo === 'practice') {
    releaseSolo(g);
    return { ok: true };
  }
  return { ok: true, outcome: finish(g, otherSide(sideOf(slot)), 'forfeit') };
}

/** Sai da vaga (botão). No meio da partida, é desistir. */
export function leave(g: ArcadeGame, session: string): { outcome?: ArcadeOutcome } | null {
  const slot = slotOf(g, session);
  if (!slot) return null;
  // Sozinho: só para (sem resultado), e o computador sai junto.
  if (g.solo) {
    releaseSolo(g);
    setSeat(g, slot, EMPTY);
    return {};
  }
  const outcome =
    g.status === 'playing' ? finish(g, otherSide(sideOf(slot)), 'forfeit') : undefined;
  setSeat(g, slot, EMPTY);
  return { outcome };
}

/** A conexão caiu no meio da partida: começa a contar o prazo para voltar. */
export function dropped(g: ArcadeGame, session: string, now: number): boolean {
  const slot = slotOf(g, session);
  if (!slot || g.status !== 'playing' || g[`${slot}Away`]) return false;
  g[`${slot}Away`] = now + arcadeTiming.woMs;
  return true;
}

/**
 * Saiu da sala (fechou a aba ou foi para outra sala). Antes ou depois da partida, a vaga fica
 * livre na hora; no meio dela, conta o prazo para voltar.
 */
export function gone(g: ArcadeGame, session: string, now: number): boolean {
  const slot = slotOf(g, session);
  if (!slot) return false;
  // Jogando sozinho: não tem por que segurar a mesa.
  if (g.solo) {
    releaseSolo(g);
    setSeat(g, slot, EMPTY);
    return true;
  }
  if (g.status === 'playing') return dropped(g, session, now);
  setSeat(g, slot, EMPTY);
  return true;
}

/**
 * Voltou: a mesma conexão (reconectou) ou outra da mesma pessoa (recarregou a página, voltou
 * pela porta). `stale`: a sessão antiga não está mais de verdade na sala.
 */
export function back(
  g: ArcadeGame,
  user: string,
  session: string,
  stale: (oldSession: string) => boolean,
): boolean {
  for (const s of ARCADE_SLOTS) {
    const seat = seatOf(g, s);
    if (!user || seat.user !== user) continue;
    if (seat.session === session) {
      if (!seat.awayUntil) return false;
      g[`${s}Away`] = 0;
      return true;
    }
    if (seat.awayUntil || stale(seat.session)) {
      setSeat(g, s, { ...seat, session, awayUntil: 0 });
      return true;
    }
  }
  return false;
}

/**
 * Venceu o prazo de quem saiu: W.O. para o outro lado (perde quem saiu primeiro), e as vagas
 * de quem não voltou ficam livres.
 */
export function expire(g: ArcadeGame, now: number): ArcadeOutcome | null {
  if (g.status !== 'playing') return null;
  const late = slotsOf(g.mode)
    .filter((s) => g[`${s}Away`] > 0 && g[`${s}Away`] <= now)
    .sort((a, b) => g[`${a}Away`] - g[`${b}Away`]);
  if (!late.length) return null;
  const outcome = finish(g, otherSide(sideOf(late[0]!)), 'wo');
  for (const s of ARCADE_SLOTS) if (g[`${s}Away`]) setSeat(g, s, EMPTY);
  return outcome;
}
