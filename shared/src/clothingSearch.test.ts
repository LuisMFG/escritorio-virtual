import { describe, expect, it } from 'vitest';
import { clothingSearchText, matchesSearch } from './clothingSearch.js';

describe('busca de roupas', () => {
  it('traduz as palavras do nome da biblioteca', () => {
    const terno = clothingSearchText('shirt_M_pinstripesuit', 'Blusa', 6462);
    expect(matchesSearch(terno, 'terno')).toBe(true);
    expect(matchesSearch(terno, 'Camisa')).toBe(true);
    expect(matchesSearch(terno, '6462')).toBe(true);
    expect(matchesSearch(terno, 'vestido')).toBe(false);
    const capacete = clothingSearchText('hat_U_bananahelmet', 'Chapéu', 6512);
    expect(matchesSearch(capacete, 'capacete banana')).toBe(true);
    expect(matchesSearch(capacete, 'chapeu')).toBe(true);
    // "swimsuit" é maiô, não terno.
    const maio = clothingSearchText('shirt_F_revealingswimsuit', 'Blusa', 5487);
    expect(matchesSearch(maio, 'maiô')).toBe(true);
    expect(matchesSearch(maio, 'terno')).toBe(false);
    // Peças básicas (sem nome) acham pela categoria e pelo número.
    const basica = clothingSearchText('hh_human_shirt', 'Blusa', 210);
    expect(matchesSearch(basica, 'blusa 210')).toBe(true);
  });
});
