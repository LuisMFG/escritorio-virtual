import type { CatalogItem, FurniCatalog, FurniManifestEntry } from '@office/shared';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { furniDefs } from '../db/schema.js';
import { curationFor, FurniDefService, hasTop, layHeight } from './FurniDefService.js';

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

describe('altura de deitar das camas do catálogo (Fase 52)', () => {
  it('segue a Cama de Casal (h 1,73 → 0,5) sem passar dela; as baixas ficam baixas', () => {
    expect(layHeight(1.73)).toBe(0.5);
    expect(layHeight(1.9)).toBe(0.5);
    expect(layHeight(3.1)).toBe(0.5);
    expect(layHeight(1.1)).toBe(0.3);
    expect(layHeight(0.73)).toBe(0.2);
    expect(layHeight(0.1)).toBe(0.1);
    const bed = curationFor(item({ c: 'bed', n: 'Cama', w: 1, d: 3, h: 1.9, lay: 1 }), 'cama_x');
    expect(bed).toMatchObject({ canLay: true, sitHeight: 0.5 });
    // Cadeiras continuam na metade da altura.
    expect(curationFor(item({ c: 'chair', h: 1, sit: 1 }), 'cadeira_x').sitHeight).toBe(0.5);
  });

  it('camas medidas antes, gravadas no banco, ganham a altura nova ao carregar', () => {
    const db = openDatabase(':memory:');
    const old: FurniManifestEntry = {
      id: 'cama_velha',
      name: 'Cama Velha',
      category: 'camas',
      width: 1,
      depth: 3,
      height: 1.8,
      canSit: false,
      canLay: true,
      wall: false,
      canWalk: false,
      sitHeight: 0.9,
      directions: [0, 2],
      source: 'habboassets',
      anchors: {},
      states: [],
      stateAnchors: {},
      light: false,
      animated: false,
    };
    db.insert(furniDefs)
      .values({ id: old.id, json: JSON.stringify(old), createdAt: new Date() })
      .run();
    const file = join(mkdtempSync(join(tmpdir(), 'catalogo-')), 'catalog.json');
    const catalog: FurniCatalog = {
      version: 1,
      generatedAt: '',
      items: [item({ id: 'cama_velha', n: 'Cama Velha', c: 'bed', w: 1, d: 3, h: 1.8, lay: 1 })],
    };
    writeFileSync(file, JSON.stringify(catalog));
    const svc = new FurniDefService(db, new Map(), () => Promise.reject(new Error('—')), file);
    expect(svc.defs.get('cama_velha')?.sitHeight).toBe(0.5);
  });
});
