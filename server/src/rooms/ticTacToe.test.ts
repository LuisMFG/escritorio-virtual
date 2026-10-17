import { describe, expect, it } from 'vitest';
import { join, leave, newGame, play, rematch } from './ticTacToe.js';

const ana = { session: 's-ana', user: 'u-ana', name: 'Ana' };
const beto = { session: 's-beto', user: 'u-beto', name: 'Beto' };

function ready() {
  const g = newGame();
  join(g, ana);
  join(g, beto);
  return g;
}

describe('ticTacToe', () => {
  it('começa quando os dois sentam; mesma conta não pega os dois lugares', () => {
    const g = newGame();
    expect(join(g, ana)).toMatchObject({ ok: true, mark: 'X' });
    expect(g.status).toBe('waiting');
    expect(join(g, { ...ana, session: 'outra-aba' })).toMatchObject({ ok: false });
    expect(join(g, beto)).toMatchObject({ ok: true, mark: 'O' });
    expect(g.status).toBe('playing');
  });

  it('empate quando enche sem linha', () => {
    const g = ready();
    // X O X / X O O / O X X
    const moves: [string, number][] = [
      ['s-ana', 0],
      ['s-beto', 1],
      ['s-ana', 2],
      ['s-beto', 4],
      ['s-ana', 3],
      ['s-beto', 5],
      ['s-ana', 7],
      ['s-beto', 6],
    ];
    for (const [s, c] of moves) expect(play(g, s, c).ok).toBe(true);
    expect(play(g, 's-ana', 8)).toEqual({ ok: true, outcome: { draw: true } });
    expect(g).toMatchObject({ status: 'ended', winner: 'draw' });
    expect(play(g, 's-beto', 0).ok).toBe(false);
  });

  it('não marca casa ocupada; revanche alterna quem começa', () => {
    const g = ready();
    play(g, 's-ana', 4);
    expect(play(g, 's-beto', 4)).toMatchObject({ ok: false });
    expect(rematch(g, 's-ana')).toMatchObject({ ok: false }); // ainda em andamento
    leave(g, 's-beto');
    expect(join(g, beto)).toMatchObject({ ok: true, mark: 'O' });
    expect(g).toMatchObject({ status: 'playing', board: '.........', turn: 'X' });
  });

  it('desistência dá a vitória ao outro', () => {
    const g = ready();
    const res = leave(g, 's-ana');
    expect(res?.forfeitTo?.name).toBe('Beto');
    expect(g).toMatchObject({ status: 'ended', winner: 'O', xSession: '' });
    expect(leave(g, 's-beto')?.forfeitTo).toBeUndefined();
  });
});
