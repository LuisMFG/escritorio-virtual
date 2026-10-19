import { describe, expect, it } from 'vitest';
import {
  baseClassname,
  CATALOG_CATEGORIES,
  catalogMatches,
  catalogTerms,
  DEFAULT_HIDDEN_CATEGORIES,
} from './furniCatalog.js';

describe('catálogo completo de móveis', () => {
  it('tira a cor do classname', () => {
    expect(baseClassname('purablk_c16_round*8')).toBe('purablk_c16_round');
    expect(baseClassname('chair_norja')).toBe('chair_norja');
  });

  it('busca por todas as palavras, sem acento, no nome ou no classname', () => {
    const item = { id: 'chair_norja', n: 'Cadeira Nórdica' };
    expect(catalogMatches(item, catalogTerms('nordica'))).toBe(true);
    expect(catalogMatches(item, catalogTerms('  CADEIRA  nór '))).toBe(true);
    expect(catalogMatches(item, catalogTerms('norja'))).toBe(true);
    expect(catalogMatches(item, catalogTerms('cadeira mesa'))).toBe(false);
  });

  it('festa e jogos começam escondidos, e todas as categorias têm nome em português', () => {
    for (const c of DEFAULT_HIDDEN_CATEGORIES) expect(CATALOG_CATEGORIES[c]).toBeTruthy();
    expect(DEFAULT_HIDDEN_CATEGORIES).toContain('games');
    expect(DEFAULT_HIDDEN_CATEGORIES).not.toContain('chair');
  });
});
