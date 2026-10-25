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
import { join, newArcade, setMode, start } from './arcade.js';
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
