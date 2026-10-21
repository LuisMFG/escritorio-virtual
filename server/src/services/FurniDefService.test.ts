import type { CatalogItem } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { curationFor, hasTop } from './FurniDefService.js';

const item = (over: Partial<CatalogItem>): CatalogItem => ({
  id: 'x',
  n: 'Coisa',
  c: 'other',
  w: 1,
  d: 1,
  h: 1,
  rev: 1,
  ...over,
});

describe('tampo dos móveis do catálogo (empilhar)', () => {
  it('mesas, estantes e divisórias têm tampo; e pelo nome, balcões, armários, cômodas…', () => {
    expect(hasTop(item({ c: 'table', n: 'Mesa Pura' }))).toBe(true);
    expect(hasTop(item({ c: 'shelf', n: 'Estante' }))).toBe(true);
    expect(hasTop(item({ c: 'divider', n: 'Divisória' }))).toBe(true);
    for (const n of ['Balcão de Bar', 'Armário de Metal', 'Cômoda Antiga', 'Escrivaninha Pura'])
      expect(hasTop(item({ n })), n).toBe(true);
  });

  it('assento, cama, tapete, parede e o resto não', () => {
    expect(hasTop(item({ c: 'chair', n: 'Cadeira', sit: 1 }))).toBe(false);
    expect(hasTop(item({ c: 'bed', n: 'Cama', lay: 1 }))).toBe(false);
    expect(hasTop(item({ c: 'rug', n: 'Tapete de mesa', walk: 1 }))).toBe(false);
    expect(hasTop(item({ c: 'wall_decoration', n: 'Prateleira de parede', wall: 1 }))).toBe(false);
    expect(hasTop(item({ c: 'other', n: 'Computador' }))).toBe(false);
    expect(hasTop(item({ c: 'plant', n: 'Planta' }))).toBe(false);
  });

  it('vai para a definição do móvel (curadoria)', () => {
    expect(curationFor(item({ c: 'table', n: 'Mesa' }), 'mesa_x').hasTop).toBe(true);
    expect(curationFor(item({ n: 'Abajur' }), 'abajur_x').hasTop).toBe(false);
  });
});
