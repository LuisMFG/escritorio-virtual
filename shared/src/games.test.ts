import { describe, expect, it } from 'vitest';
import { parseQuickCommand, quickCommandText, tttFull, tttWinner } from './games.js';

describe('comandos rápidos', () => {
  it('reconhece /dado e /moeda sem ligar para maiúsculas', () => {
    expect(parseQuickCommand('/dado')).toBe('dice');
    expect(parseQuickCommand(' /MOEDA ')).toBe('coin');
    expect(parseQuickCommand('/dado 2')).toBeNull();
    expect(parseQuickCommand('dado')).toBeNull();
    expect(parseQuickCommand('/acenar')).toBeNull();
  });

  it('monta o texto do resultado', () => {
    expect(quickCommandText('dice', 5)).toBe('🎲 tirou 5 no dado');
    expect(quickCommandText('coin', 0)).toMatch(/cara$/);
    expect(quickCommandText('coin', 1)).toMatch(/coroa$/);
  });
});

describe('jogo da velha', () => {
  it('acha linha, coluna e diagonal', () => {
    expect(tttWinner('XXX......')).toEqual({ mark: 'X', line: [0, 1, 2] });
    expect(tttWinner('.O..O..O.')).toEqual({ mark: 'O', line: [1, 4, 7] });
    expect(tttWinner('..X.X.X..')).toEqual({ mark: 'X', line: [2, 4, 6] });
    expect(tttWinner('XOXXOOOXX')).toBeNull();
    expect(tttFull('XOXXOOOXX')).toBe(true);
  });
});
