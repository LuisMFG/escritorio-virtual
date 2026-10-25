import {
  ballAt,
  canHit,
  decodeBall,
  nextEvent,
  PONG,
  simulate,
  type PongBall,
} from '@office/shared';
import { describe, expect, it } from 'vitest';
import { join, newArcade, start, startSolo } from './arcade.js';
import { PongMatch } from './pong.js';

const ana = { session: 's-ana', user: 'u-ana', name: 'Ana' };
const beto = { session: 's-beto', user: 'u-beto', name: 'Beto' };

/** Mesa com Ana (A) e Beto (B) jogando ping-pong. */
function setup() {
  const game = newArcade('pingpong');
  join(game, 'a1', ana);
  join(game, 'b1', beto);
  start(game, ana.session);
  const match = new PongMatch(game, (side) => (side === 'a' ? 'Ana' : 'Beto'));
  return { game, match };
}

describe('ping-pong no servidor (Fase 58)', () => {
  it('começa com o saque da Ana, raquetes atrás de cada ponta e placar zerado', () => {
    const { game } = setup();
    expect(game).toMatchObject({ phase: 'serve', turn: 'a1', scoreA: 0, scoreB: 0, ball: '' });
    expect(game.a1Px).toBeLessThan(0);
    expect(game.b1Px).toBeGreaterThan(PONG.tableL);
  });

  it('o ponto só fecha depois da folga para uma rebatida atrasada', () => {
    const { game, match } = setup();
    expect(match.serve('a1', { t: 1000, x: -0.2, y: 0.7 }, 1000)).toEqual({ ok: true });
    const ball = decodeBall(game.ball)!;
    const decided = simulate(ball, ball.t0 + 30_000).point!;
    expect(decided.side).toBe('a');
    match.tick(decided.t + 10);
    expect(game.scoreA).toBe(0);
    match.tick(decided.t + PONG.graceMs + 1);
    expect(game).toMatchObject({ scoreA: 1, phase: 'point', detail: 'Ponto de Ana' });
    // Depois da pausa, o próximo saque (ainda da Ana: troca a cada 2 pontos).
    match.tick(decided.t + PONG.graceMs + PONG.pointPauseMs + 2);
    expect(game).toMatchObject({ phase: 'serve', turn: 'a1', ball: '' });
  });

  it('rebatida: confere o instante do toque e recusa raquete longe ou toque antigo demais', () => {
    const { game, match } = setup();
    match.serve('a1', { t: 0, x: -0.2, y: 0.7 }, 0);
    const serve = decodeBall(game.ball)!;
    const t = nextEvent(serve).t + 150;
    const at = ballAt(simulate(serve, t).ball!, t);
    match.paddle('b1', { x: at.x, y: at.y });
    const claim = { t, x: at.x, y: at.y, vx: -1, vy: 0 };
    expect(match.hit('b1', { ...claim, x: at.x + 0.5 }, t + 100)).toMatchObject({ ok: false });
    expect(match.hit('b1', claim, t + PONG.maxRewindMs + 50)).toEqual({
      ok: false,
      reason: 'Rebatida fora de hora.',
    });
    expect(match.hit('a1', claim, t + 100)).toMatchObject({ ok: false });
    expect(match.hit('b1', claim, t + 100)).toEqual({ ok: true });
    expect(decodeBall(game.ball)).toMatchObject({ by: 'b', t0: t, hits: 1 });
  });

  it('alguém saiu: o ponto em andamento vale de novo e o saque espera a volta', () => {
    const { game, match } = setup();
    match.serve('a1', { t: 0, x: -0.2, y: 0.7 }, 0);
    game.b1Away = 10_000;
    match.suspend();
    expect(game).toMatchObject({ phase: 'serve', ball: '', scoreA: 0 });
    expect(match.serve('a1', { t: 100, x: -0.2, y: 0.7 }, 100)).toEqual({
      ok: false,
      reason: 'Esperando Beto voltar.',
    });
    game.b1Away = 0;
    expect(match.serve('a1', { t: 200, x: -0.2, y: 0.7 }, 200)).toEqual({ ok: true });
    expect(match.serve('b1', { t: 300, x: 3, y: 0.7 }, 300)).toMatchObject({ ok: false });
  });
});

describe('ping-pong sozinho', () => {
  function seeded(seed = 3) {
    // (Semente espalhada: com semente pequena, os primeiros números saem quase zero.)
    let x = (seed * 2654435761) % 2147483647 || 1;
    return () => (x = (x * 16807) % 2147483647) / 2147483647;
  }
  /** Ana (A) contra a máquina de bolas ou o computador (B). */
  function solo(kind: 'practice' | 'cpu', level: 'facil' | 'medio' | 'dificil', seed = 3) {
    const game = newArcade('pingpong');
    join(game, 'a1', ana);
    startSolo(game, ana.session, kind, level);
    const match = new PongMatch(game, (side) => (side === 'a' ? 'Ana' : 'Máquina'), seeded(seed));
    return { game, match };
  }
  /** Avança o relógio da partida em passos de 1/60 s até a condição valer (ou o tempo acabar). */
  function run(match: PongMatch, from: number, until: () => boolean, ms = 8000): number {
    let t = from;
    while (!until() && t < from + ms) match.tick((t += 1000 / 60));
    return t;
  }
  /** O primeiro instante em que dá para rebater a bola do lado A. */
  function hittable(ball: PongBall): { t: number; x: number; y: number } {
    for (let t = ball.t0; ; t += 5) {
      const sim = simulate(ball, t);
      const at = ballAt(sim.ball!, t);
      if (canHit(sim.ball!, at, 'a', at) && at.h < 0.5) return { t, x: at.x, y: at.y };
    }
  }

  it('máquina de bolas: lança sozinha para o meu lado e conta devolvidas e perdidas', () => {
    const { game, match } = solo('practice', 'medio');
    expect(game).toMatchObject({ turn: 'b1', phase: 'serve', b1Name: 'Máquina de bolas (médio)' });
    let t = run(match, 0, () => game.phase === 'rally');
    const first = decodeBall(game.ball)!;
    expect(first.by).toBe('b');
    expect(nextEvent(first)).toMatchObject({ kind: 'bounce', side: 'a' });
    // Não rebati: perdida.
    t = run(match, t, () => game.phase === 'point');
    expect(game).toMatchObject({ scoreA: 0, scoreB: 1, detail: 'Essa passou. 0 de 1 devolvidas.' });
    // A próxima: rebato, e a máquina não devolve. Sem sets nem fim.
    t = run(match, t, () => game.phase === 'rally');
    const ball = decodeBall(game.ball)!;
    const at = hittable(ball);
    t = run(match, t, () => false, at.t - t);
    expect(match.hit('a1', { ...at, vx: 0, vy: 0 }, at.t + 5)).toEqual({ ok: true });
    run(match, t, () => game.phase === 'point');
    expect(game).toMatchObject({ scoreA: 1, scoreB: 1, detail: 'Boa! 1 de 2 devolvidas.' });
    expect(game.status).toBe('playing');
  });

  it('máquina: no difícil as bolas chegam mais rápido e mais abertas que no fácil', () => {
    const measure = (level: 'facil' | 'dificil') => {
      let flight = 0;
      let wide = 0;
      for (let k = 0; k < 12; k++) {
        const { game, match } = solo('practice', level, 10 + k);
        run(match, 0, () => game.phase === 'rally');
        const ball = decodeBall(game.ball)!;
        const bounce = nextEvent(ball);
        flight += bounce.t - ball.t0;
        const land = ballAt(ball, bounce.t);
        wide += Math.abs(land.y - PONG.tableW / 2);
      }
      return { flight, wide };
    };
    const facil = measure('facil');
    const dificil = measure('dificil');
    expect(dificil.flight).toBeLessThan(facil.flight * 0.8);
    expect(dificil.wide).toBeGreaterThan(facil.wide);
  });

  it('computador: saca sozinho e devolve; o difícil devolve mais que o fácil', () => {
    const returns = (level: 'facil' | 'dificil') => {
      let ok = 0;
      for (let k = 0; k < 16; k++) {
        const { game, match } = solo('cpu', level, 20 + k);
        // Saque da Ana, de um lado diferente a cada vez.
        match.serve('a1', { t: 0, x: -0.2, y: 0.1 + (k % 8) * 0.18 }, 0);
        run(match, 0, () => game.phase !== 'rally' || decodeBall(game.ball)?.by === 'b');
        if (decodeBall(game.ball)?.by === 'b') ok++;
      }
      return ok;
    };
    const facil = returns('facil');
    const dificil = returns('dificil');
    expect(dificil).toBeGreaterThanOrEqual(15);
    expect(facil).toBeLessThan(dificil);
    // E quando é a vez dele, saca sozinho.
    const { game, match } = solo('cpu', 'medio');
    match.serve('a1', { t: 0, x: -0.2, y: 0.76 }, 0);
    // Deixa o ponto acabar como for, até chegar o saque do computador (troca a cada 2 pontos).
    let t = 0;
    for (let i = 0; i < 6 && game.turn !== 'b1'; i++) {
      t = run(match, t, () => game.phase === 'serve');
      if (game.turn === 'a1') match.serve('a1', { t, x: -0.2, y: 0.76 }, t);
    }
    expect(game.turn).toBe('b1');
    run(match, t, () => game.phase === 'rally');
    expect(decodeBall(game.ball)?.by).toBe('b');
  });
});
