import { ballAt, decodeBall, nextEvent, PONG, simulate } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { join, newArcade, start } from './arcade.js';
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
