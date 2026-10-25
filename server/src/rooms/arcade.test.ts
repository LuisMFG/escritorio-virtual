import { describe, expect, it } from 'vitest';
import {
  answer,
  arcadeTiming,
  ask,
  askExpired,
  back,
  cpuSlot,
  dropped,
  expire,
  forfeit,
  gone,
  isEmpty,
  join,
  leave,
  newArcade,
  releaseSolo,
  setMode,
  slotOf,
  start,
  startSolo,
} from './arcade.js';

const ana = { session: 's-ana', user: 'u-ana', name: 'Ana' };
const beto = { session: 's-beto', user: 'u-beto', name: 'Beto' };
const carla = { session: 's-carla', user: 'u-carla', name: 'Carla' };
const duda = { session: 's-duda', user: 'u-duda', name: 'Duda' };

/** Mesa 1×1 com Ana (A) e Beto (B) já jogando. */
function playing() {
  const g = newArcade('pingpong');
  join(g, 'a1', ana);
  join(g, 'b1', beto);
  expect(start(g, ana.session)).toEqual({ ok: true });
  return g;
}

describe('mesas do Salão de Jogos (Fase 57)', () => {
  it('vagas: entra, troca de vaga, não pega a de outro nem a do 2×2 no 1×1', () => {
    const g = newArcade('pool');
    expect(g).toMatchObject({ kind: 'pool', mode: 1, status: 'waiting' });
    expect(join(g, 'a1', ana)).toEqual({ ok: true });
    expect(join(g, 'a1', beto)).toEqual({ ok: false, reason: 'Essa vaga já tem alguém.' });
    expect(join(g, 'a2', beto)).toEqual({ ok: false, reason: 'Essa vaga é do 2×2.' });
    // A mesma pessoa noutra aba não pega outra vaga; mudar de lado, sim.
    expect(join(g, 'b1', { ...ana, session: 's-ana-2' })).toMatchObject({ ok: false });
    expect(join(g, 'b1', ana)).toEqual({ ok: true });
    expect(slotOf(g, ana.session)).toBe('b1');
    expect(g.a1Session).toBe('');
  });

  it('começar precisa de quem está na mesa e das vagas do modo cheias', () => {
    const g = newArcade('pingpong');
    join(g, 'a1', ana);
    expect(start(g, beto.session)).toMatchObject({ ok: false });
    expect(start(g, ana.session)).toEqual({ ok: false, reason: 'Falta um adversário.' });
    join(g, 'b1', beto);
    expect(start(g, beto.session)).toEqual({ ok: true });
    expect(g).toMatchObject({ status: 'playing', scoreA: 0, scoreB: 0, winner: '', end: '' });
    expect(join(g, 'a2', carla)).toMatchObject({ ok: false });
    expect(start(g, ana.session)).toMatchObject({ ok: false });
  });

  it('2×2: o modo muda antes de começar, só por quem está na mesa; voltar ao 1×1 sem parceiros', () => {
    const g = newArcade('pingpong');
    // Mesa vazia: qualquer um escolhe.
    expect(setMode(g, 2, carla.session)).toEqual({ ok: true });
    join(g, 'a1', ana);
    join(g, 'a2', beto);
    expect(setMode(g, 1, duda.session)).toMatchObject({ ok: false });
    expect(setMode(g, 1, ana.session)).toEqual({
      ok: false,
      reason: 'Para voltar ao 1×1, os parceiros saem antes.',
    });
    join(g, 'b1', carla);
    expect(start(g, ana.session)).toEqual({
      ok: false,
      reason: 'Faltam jogadores: o 2×2 precisa de quatro.',
    });
    join(g, 'b2', duda);
    expect(start(g, duda.session)).toEqual({ ok: true });
    expect(setMode(g, 1, ana.session)).toMatchObject({ ok: false });
  });

  it('desistir: o outro lado vence e todos ficam na mesa para a revanche', () => {
    const g = playing();
    const res = forfeit(g, beto.session);
    expect(res).toMatchObject({
      ok: true,
      outcome: { winner: 'a', end: 'forfeit', winners: [ana], losers: [beto] },
    });
    expect(g).toMatchObject({ status: 'ended', winner: 'a', end: 'forfeit' });
    expect(slotOf(g, beto.session)).toBe('b1');
    // Revanche: começa de novo e o resultado anterior some.
    expect(start(g, beto.session)).toEqual({ ok: true });
    expect(g).toMatchObject({ status: 'playing', winner: '', end: '' });
  });

  it('sair da vaga: antes da partida só libera; no meio dela é desistir', () => {
    const g = newArcade('pool');
    join(g, 'a1', ana);
    expect(leave(g, ana.session)).toEqual({ outcome: undefined });
    expect(isEmpty(g)).toBe(true);
    const p = playing();
    expect(leave(p, ana.session)).toMatchObject({
      outcome: { winner: 'b', end: 'forfeit', winners: [beto], losers: [ana] },
    });
    expect(p.a1Session).toBe('');
    expect(leave(p, carla.session)).toBeNull();
  });

  it('quem sai da sala antes da partida perde a vaga na hora', () => {
    const g = newArcade('pingpong');
    join(g, 'a1', ana);
    // Conexão caindo antes da partida não conta (pode reconectar); sair da sala, sim.
    expect(dropped(g, ana.session, 1000)).toBe(false);
    expect(gone(g, ana.session, 1000)).toBe(true);
    expect(isEmpty(g)).toBe(true);
  });

  it('no meio da partida: tem o prazo para voltar; depois, W.O. para o outro lado', () => {
    arcadeTiming.woMs = 15_000;
    const g = playing();
    expect(gone(g, ana.session, 1000)).toBe(true);
    expect(g.a1Away).toBe(16_000);
    expect(expire(g, 15_999)).toBeNull();
    expect(g.status).toBe('playing');
    const outcome = expire(g, 16_000);
    expect(outcome).toMatchObject({ winner: 'b', end: 'wo', winners: [beto], losers: [ana] });
    expect(g).toMatchObject({ status: 'ended', winner: 'b', end: 'wo', a1Session: '' });
    expect(slotOf(g, beto.session)).toBe('b1');
  });

  it('voltou a tempo (reconectou ou entrou de novo): a partida continua', () => {
    const g = playing();
    dropped(g, ana.session, 1000);
    expect(back(g, ana.user, ana.session, () => false)).toBe(true);
    expect(g.a1Away).toBe(0);
    // Foi para outra sala e voltou pela porta: sessão nova, mesma vaga.
    gone(g, ana.session, 2000);
    expect(back(g, ana.user, 's-ana-nova', () => false)).toBe(true);
    expect(g).toMatchObject({ a1Session: 's-ana-nova', a1Away: 0, status: 'playing' });
    expect(expire(g, 999_999)).toBeNull();
  });

  it('recarregou a página antes da partida: a vaga passa para a conexão nova', () => {
    const g = newArcade('pool');
    join(g, 'a1', ana);
    // A conexão antiga ainda está saindo (fantasma): a nova assume a vaga.
    expect(back(g, ana.user, 's-ana-2', (old) => old === ana.session)).toBe(true);
    expect(g.a1Session).toBe('s-ana-2');
    // Quem não estava na mesa não ganha nada.
    expect(back(g, carla.user, 's-carla-2', () => true)).toBe(false);
  });
});

describe('jogar sozinho e pedir a mesa', () => {
  it('contra o computador: ele fica com a outra vaga; a mesa conta como só minha', () => {
    const g = newArcade('pool');
    join(g, 'b1', ana);
    expect(startSolo(g, beto.session, 'cpu', 'medio')).toEqual({
      ok: false,
      reason: 'Entre numa vaga antes.',
    });
    expect(startSolo(g, ana.session, 'cpu', 'dificil')).toEqual({ ok: true });
    expect(g).toMatchObject({
      status: 'playing',
      solo: 'cpu',
      level: 'dificil',
      mode: 1,
      a1Session: 'cpu',
      a1Name: 'Computador (difícil)',
      a1User: '',
    });
    expect(cpuSlot(g)).toBe('a1');
    // Sair: só para (sem vencedor), e o computador sai junto; a mesa fica vazia.
    expect(leave(g, ana.session)).toEqual({});
    expect(g).toMatchObject({ status: 'waiting', solo: '', a1Session: '', b1Session: '' });
    expect(isEmpty(g)).toBe(true);
  });

  it('treino: sinuca sem adversário; ping-pong com a máquina de bolas; parar não tem vencedor', () => {
    const pool = newArcade('pool');
    join(pool, 'a1', ana);
    startSolo(pool, ana.session, 'practice', 'medio');
    expect(pool).toMatchObject({ status: 'playing', solo: 'practice', b1Session: '' });
    expect(forfeit(pool, ana.session)).toEqual({ ok: true });
    expect(pool).toMatchObject({ status: 'waiting', solo: '', a1Session: ana.session });

    const pong = newArcade('pingpong');
    join(pong, 'a1', ana);
    startSolo(pong, ana.session, 'practice', 'facil');
    expect(pong).toMatchObject({ b1Session: 'cpu', b1Name: 'Máquina de bolas (fácil)' });
    // Só com a mesa só minha: com outra pessoa sentada, não.
    const busy = newArcade('pingpong');
    join(busy, 'a1', ana);
    join(busy, 'b1', beto);
    expect(startSolo(busy, ana.session, 'cpu', 'medio')).toMatchObject({ ok: false });
  });

  it('depois de jogar contra o computador, começar exige um adversário de verdade', () => {
    const g = newArcade('pingpong');
    join(g, 'a1', ana);
    startSolo(g, ana.session, 'cpu', 'facil');
    expect(forfeit(g, ana.session)).toMatchObject({ ok: true });
    expect(g.status).toBe('ended');
    expect(start(g, ana.session)).toEqual({ ok: false, reason: 'Falta um adversário.' });
    // Alguém entra na vaga: o computador sai e o resultado antigo some.
    expect(join(g, 'b1', beto)).toEqual({ ok: true });
    expect(g).toMatchObject({ solo: '', b1Session: beto.session, status: 'waiting' });
  });

  it('pedir a mesa: quem treina aceita ou recusa; sem resposta, libera', () => {
    const g = newArcade('pool');
    join(g, 'a1', ana);
    startSolo(g, ana.session, 'practice', 'medio');
    expect(ask(g, ana, 0)).toEqual({ ok: false, reason: 'Você já está nesta mesa.' });
    expect(ask(g, beto, 1000)).toEqual({ ok: true });
    expect(g).toMatchObject({ askSession: beto.session, askName: 'Beto' });
    expect(ask(g, carla, 2000)).toEqual({
      ok: false,
      reason: 'Beto já pediu a mesa. Espere a resposta.',
    });
    // Só quem treina responde.
    expect(answer(g, carla.session, true)).toMatchObject({ ok: false });
    expect(answer(g, ana.session, false)).toEqual({ ok: true, asker: beto.session, name: 'Beto' });
    expect(g).toMatchObject({ askSession: '', status: 'playing', solo: 'practice' });
    // Aceitando: o treino acaba e a mesa espera (quem pediu entra na outra vaga pela sala).
    ask(g, carla, 3000);
    expect(answer(g, ana.session, true)).toMatchObject({ ok: true, asker: carla.session });
    expect(g).toMatchObject({ status: 'waiting', solo: '', a1Session: ana.session });
    // Sem resposta no prazo: vence o pedido.
    startSolo(g, ana.session, 'cpu', 'medio');
    ask(g, duda, 10_000);
    expect(askExpired(g, 10_000 + arcadeTiming.askMs - 1)).toBe(false);
    expect(askExpired(g, 10_000 + arcadeTiming.askMs)).toBe(true);
    releaseSolo(g);
    expect(g).toMatchObject({ status: 'waiting', b1Session: '', askSession: '' });
    // Sem ninguém jogando sozinho, não tem o que pedir.
    expect(ask(g, duda, 0)).toMatchObject({ ok: false });
  });

  it('jogando sozinho, sair da sala libera a mesa na hora (sem esperar W.O.)', () => {
    const g = newArcade('pingpong');
    join(g, 'a1', ana);
    startSolo(g, ana.session, 'cpu', 'medio');
    expect(gone(g, ana.session, 0)).toBe(true);
    expect(isEmpty(g)).toBe(true);
    expect(g.status).toBe('waiting');
  });
});
