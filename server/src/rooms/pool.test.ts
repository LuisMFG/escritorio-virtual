import {
  decodeJson,
  POOL,
  rackBalls,
  simulateShot,
  type PoolBalls,
  type PoolLogEntry,
  type PoolShotRecord,
} from '@office/shared';
import { describe, expect, it } from 'vitest';
import { join, newArcade, setMode, start, startSolo } from './arcade.js';
import { PoolMatch } from './pool.js';

const ana = { session: 's-ana', user: 'u-ana', name: 'Ana' };
const beto = { session: 's-beto', user: 'u-beto', name: 'Beto' };
const caio = { session: 's-caio', user: 'u-caio', name: 'Caio' };
const duda = { session: 's-duda', user: 'u-duda', name: 'Duda' };

const names = (side: 'a' | 'b') => (side === 'a' ? 'lado A' : 'lado B');

/** Mesa com Ana (A) e Beto (B) jogando sinuca; no 2×2, Caio com a Ana e Duda com o Beto. */
function setup(mode: 1 | 2 = 1) {
  const game = newArcade('pool');
  if (mode === 2) setMode(game, 2, ana.session);
  join(game, 'a1', ana);
  join(game, 'b1', beto);
  if (mode === 2) {
    join(game, 'a2', caio);
    join(game, 'b2', duda);
  }
  start(game, ana.session);
  // Triângulo sem sorteio (o perfeito), para comparar com `rackBalls()`.
  const match = new PoolMatch(game, names, 0, () => 0.5);
  return { game, match };
}

const shot = { furniId: 'mesa', dx: 1, dy: 0, power: 0, sx: 0, sy: 0 };
/** Tacada fraca para trás, longe do triângulo: não acerta nenhuma bola (falta). */
const miss = { ...shot, dx: -1 };

/** Só a branca e a 8 na mesa, com a 8 a caminho da caçapa do canto de cima à esquerda (0). */
function onTheEight(match: PoolMatch) {
  const balls: PoolBalls = new Array(16).fill(null);
  balls[0] = [0.45, 0.45];
  balls[8] = [0.15, 0.15];
  Object.assign(match, {
    balls,
    rules: { groupA: 'solids', turn: 'a', next: { a: 0, b: 0 }, inHand: false, breakShot: false },
  });
}
const toTheCorner = { ...shot, dx: -Math.SQRT1_2, dy: -Math.SQRT1_2, power: 0.55 };

/** Anda o relógio até as bolas pararem (e a pausa depois). */
function settle(game: { shot: string }, match: PoolMatch) {
  const rec = decodeJson<PoolShotRecord>(game.shot)!;
  const t = rec.t0 + rec.ms + 401;
  return { t, end: match.tick(t) };
}

describe('sinuca no servidor (Fase 59)', () => {
  it('começa na abertura: bola na mão da Ana, triângulo arrumado e 45 s no relógio', () => {
    const { game } = setup();
    expect(game).toMatchObject({
      phase: 'aim',
      turn: 'a1',
      inHand: true,
      breakShot: true,
      groupA: '',
      deadline: POOL.shotMs,
      scoreA: 0,
      scoreB: 0,
      shot: '',
    });
    expect(JSON.parse(game.balls)).toEqual(rackBalls());
    expect(game.detail).toMatch(/^Abertura/);
  });

  it('recusa a vez errada, a mira vazia e a branca na frente da linha na abertura', () => {
    const { match } = setup();
    expect(match.shoot('b1', shot, 10)).toEqual({ ok: false, reason: 'Não é a sua vez.' });
    expect(match.shoot('a1', { ...shot, dx: 0 }, 10)).toEqual({
      ok: false,
      reason: 'Mire antes de tacar.',
    });
    expect(match.shoot('a1', { ...shot, cx: 1.2, cy: 0.5 }, 10)).toEqual({
      ok: false,
      reason: 'A branca não cabe aí.',
    });
  });

  it('a tacada vai para o estado igual à simulação; o resultado, quando as bolas param', () => {
    const { game, match } = setup();
    const msg = { ...shot, dy: 0.01, power: 1, cx: 0.5, cy: 0.56 };
    expect(match.shoot('a1', msg, 1000)).toEqual({ ok: true });
    const rec = decodeJson<PoolShotRecord>(game.shot)!;
    const start = rackBalls();
    start[0] = [0.5, 0.56];
    expect(rec.start).toEqual(start);
    expect(rec.t0).toBeGreaterThan(1000);
    // O mesmo resultado que qualquer navegador calcula com a tacada gravada.
    const again = simulateShot(rec.start, rec);
    expect(rec.ms).toBe(again.ms);
    expect(JSON.parse(game.balls)).toEqual(again.final);
    // Enquanto as bolas andam, a vez, o placar e o aviso ficam como estavam.
    expect(game).toMatchObject({
      phase: 'shot',
      turn: 'a1',
      breakShot: true,
      deadline: POOL.shotMs,
    });
    expect(game.detail).toMatch(/^Abertura/);
    expect(match.shoot('b1', shot, 1100)).toEqual({
      ok: false,
      reason: 'Espere as bolas pararem.',
    });
    match.tick(rec.t0 + rec.ms - 10);
    expect(game.phase).toBe('shot');
    // Pararam: o resultado aparece e o tempo da próxima tacada começa a correr.
    const { t } = settle(game, match);
    expect(game).toMatchObject({ phase: 'aim', breakShot: false });
    expect(game.detail).not.toMatch(/^Abertura/);
    expect(game.deadline).toBe(rec.t0 + rec.ms + 400 + POOL.shotMs);
    expect(game.deadline).toBeGreaterThan(t);
  });

  it('falta (não acertou nada) dá bola na mão ao outro lado', () => {
    const { game, match } = setup();
    // Abertura para trás: só a branca anda.
    expect(match.shoot('a1', miss, 0)).toEqual({ ok: true });
    settle(game, match);
    expect(game).toMatchObject({ turn: 'b1', inHand: true, breakShot: false });
    expect(game.detail).toBe(
      'Falta de Ana: a branca não acertou nenhuma bola. Bola na mão para Beto.',
    );
    // O histórico guarda a falta com a explicação; a próxima tacada não apaga.
    const log = () => JSON.parse(game.log) as PoolLogEntry[];
    expect(log()[0]).toEqual({
      kind: 'foul',
      text: 'Falta de Ana: a branca não acertou nenhuma bola. Bola na mão para Beto.',
      help: 'A branca precisa acertar alguma bola.',
    });
    expect(match.shoot('b1', { ...miss, cx: 0.4, cy: 0.5 }, 20_000)).toEqual({ ok: true });
    settle(game, match);
    expect(log()).toHaveLength(2);
    expect(log()[1]!.text).toMatch(/^Falta de Ana/);
  });

  it('tempo esgotado: bola na mão para o adversário; com alguém fora, o relógio para', () => {
    const { game, match } = setup();
    match.aim('a1', { dx: 1, dy: 0, power: 0.4, cx: 0.5, cy: 0.5 });
    match.tick(POOL.shotMs - 100);
    expect(game.turn).toBe('a1');
    match.tick(POOL.shotMs + 1);
    expect(game).toMatchObject({ turn: 'b1', inHand: true, breakShot: false, aim: '' });
    expect(game.detail).toBe('Tempo esgotado para Ana. Bola na mão para Beto.');
    const deadline = game.deadline;
    // O Beto saiu da sala: o tempo dele não corre enquanto está fora.
    game.b1Away = 99_999_999;
    match.tick(POOL.shotMs + 10_001);
    match.tick(POOL.shotMs + 40_001);
    expect(game.turn).toBe('b1');
    expect(game.deadline).toBe(deadline + 40_000);
    expect(match.shoot('b1', miss, POOL.shotMs + 40_002)).toEqual({
      ok: false,
      reason: 'Esperando Beto voltar.',
    });
  });

  it('a 8: sem cantar, recusa; na caçapa cantada, vence depois de as bolas pararem', () => {
    const { game, match } = setup();
    onTheEight(match);
    expect(match.shoot('a1', toTheCorner, 0)).toEqual({
      ok: false,
      reason: 'Cante a caçapa da 8: clique numa caçapa.',
    });
    expect(match.shoot('a1', { ...toTheCorner, call: 0 }, 0)).toEqual({ ok: true });
    // Enquanto as bolas andam, a partida ainda não acabou na tela.
    expect(match.tick(200)).toBeNull();
    expect(settle(game, match).end).toEqual({ winner: 'a', reason: 'a 8 na caçapa cantada' });
    expect(match.shoot('a1', toTheCorner, 99_999)).toEqual({
      ok: false,
      reason: 'A partida acabou.',
    });
  });

  it('a 8 na caçapa errada perde', () => {
    const { game, match } = setup();
    onTheEight(match);
    match.shoot('a1', { ...toTheCorner, call: 5 }, 0);
    expect(settle(game, match).end).toEqual({ winner: 'b', reason: 'a 8 caiu na caçapa errada' });
  });

  it('2×2: as duplas alternam as tacadas (Ana, Beto, Caio, Duda) e a mira é só de quem taca', () => {
    const { game, match } = setup(2);
    const order: string[] = [];
    let now = 0;
    for (let k = 0; k < 5; k++) {
      order.push(game.turn);
      const slot = game.turn as 'a1' | 'a2' | 'b1' | 'b2';
      match.aim(slot === 'a1' ? 'b1' : 'a1', { dx: 1, dy: 0, power: 0.5, cx: 0.4, cy: 0.5 });
      expect(game.aim).toBe('');
      match.aim(slot, { dx: 1, dy: 0, power: 0.5, cx: 0.4, cy: 0.5 });
      expect(JSON.parse(game.aim)).toMatchObject({ power: 0.5 });
      expect(match.shoot(slot, miss, now)).toEqual({ ok: true });
      now = settle(game, match).t;
    }
    expect(order).toEqual(['a1', 'b1', 'a2', 'b2', 'a1']);
    expect(game.detail).toBe(
      'Falta de Ana: a branca não acertou nenhuma bola. Bola na mão para Beto.',
    );
  });
});

describe('sinuca sozinho', () => {
  /** Ana treinando (ou contra o computador) no lado B, com o triângulo perfeito. */
  function solo(kind: 'practice' | 'cpu', level: 'facil' | 'medio' | 'dificil' = 'medio') {
    const game = newArcade('pool');
    join(game, 'b1', ana);
    startSolo(game, ana.session, kind, level);
    let seed = 5;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const match = new PoolMatch(game, names, 0, kind === 'practice' ? () => 0.5 : random);
    return { game, match };
  }

  it('treino: a vez é sempre de quem treina, sem relógio e sem falta mudando nada', () => {
    const { game, match } = solo('practice');
    expect(game).toMatchObject({ turn: 'b1', inHand: true, deadline: 0, breakShot: false });
    // Errar tudo (falta numa partida de verdade): continua a vez, sem falta no histórico.
    expect(match.shoot('b1', { ...miss, cx: 0.4, cy: 0.5 }, 0)).toEqual({ ok: true });
    settle(game, match);
    expect(game).toMatchObject({ turn: 'b1', inHand: true, phase: 'aim' });
    const log = JSON.parse(game.log) as PoolLogEntry[];
    expect(log[0]).toEqual({ kind: 'info', text: 'Nenhuma bola caiu.' });
    // O tempo passa e nada acontece (sem relógio).
    expect(match.tick(10 * 60_000)).toBeNull();
    expect(game.turn).toBe('b1');
  });

  it('treino: muda bolas de lugar, repete a última tacada e arruma o triângulo', () => {
    const { game, match } = solo('practice');
    const balls = () => JSON.parse(game.balls) as PoolBalls;
    // A 5 vai para perto da caçapa; não dá para pôr em cima de outra bola.
    expect(match.place('b1', 5, [2.0, 0.9])).toEqual({ ok: true });
    expect(balls()[5]).toEqual([2.0, 0.9]);
    expect(match.place('b1', 5, balls()[1]!)).toEqual({ ok: false, reason: 'A bola não cabe aí.' });
    expect(match.place('a1', 5, [1.0, 0.5])).toMatchObject({ ok: false });
    // Tacada forte no triângulo; repetir volta tudo como estava antes dela.
    const before = balls();
    match.shoot('b1', { ...shot, dx: 1, dy: 0.01, power: 1, cx: 0.5, cy: 0.56 }, 0);
    settle(game, match);
    expect(balls()).not.toEqual(before);
    expect(match.undo('b1')).toEqual({ ok: true });
    const back = before.slice();
    back[0] = [0.5, 0.56];
    expect(balls()).toEqual(back);
    expect(match.undo('b1')).toEqual({ ok: false, reason: 'Ainda não teve tacada para repetir.' });
    // Arrumar de novo: o triângulo da abertura.
    expect(match.reset('b1')).toEqual({ ok: true });
    expect(balls()).toEqual(rackBalls());
  });

  it('fora do treino, nada de mexer nas bolas', () => {
    const { match } = setup();
    expect(match.place('a1', 5, [2.0, 0.9])).toEqual({ ok: false, reason: 'Só no treino.' });
    expect(match.undo('a1')).toEqual({ ok: false, reason: 'Só no treino.' });
    expect(match.reset('a1')).toEqual({ ok: false, reason: 'Só no treino.' });
  });

  it('contra o computador: ele pensa, mostra o taco mirando e taca sozinho', () => {
    const { game, match } = solo('cpu', 'dificil');
    // A Ana (B) abre? Não: o lado A abre, e o A é o computador.
    expect(game.turn).toBe('a1');
    expect(match.tick(100)).toBeNull();
    expect(game.phase).toBe('aim');
    // Uns instantes antes de tacar, o taco dele aparece na mesa para todo mundo.
    let t = 100;
    while (!game.aim && t < 4000) match.tick((t += 100));
    expect(game.aim).not.toBe('');
    while (game.phase === 'aim' && t < 6000) match.tick((t += 100));
    expect(game.phase).toBe('shot');
    const rec = decodeJson<PoolShotRecord>(game.shot)!;
    expect(rec.power).toBeGreaterThan(0.8); // abertura forte
    // Na vez da Ana, ele espera (e o relógio dela corre normalmente).
    settle(game, match);
    if (game.turn === 'b1') expect(game.deadline).toBeGreaterThan(0);
  });
});
