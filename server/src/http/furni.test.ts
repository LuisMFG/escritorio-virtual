import type { CatalogItem, FurniCatalog, FurniManifestEntry } from '@office/shared';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { furniConfig, furniDef, measuredDefs, setHiddenCategories } from './furni.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

const items: CatalogItem[] = [
  {
    id: 'cadeira_x',
    n: 'Cadeira X',
    c: 'chair',
    w: 1,
    d: 1,
    h: 1,
    sit: 1,
    rev: 1,
    colors: ['cadeira_x', 'cadeira_x*2'],
  },
  { id: 'quadro_y', n: 'Quadro Y', c: 'wall_decoration', wall: 1, w: 1, d: 1, h: 0, rev: 1 },
  { id: 'arcade_z', n: 'Fliperama', c: 'games', w: 1, d: 1, h: 2, rev: 1 },
];

function writeCatalog(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'catalogo-')), 'catalog.json');
  const catalog: FurniCatalog = { version: 1, generatedAt: '', items };
  writeFileSync(file, JSON.stringify(catalog));
  return file;
}

let measured: string[];
let deps: TestDeps;
const fakeMeasure = async (item: CatalogItem, id: string): Promise<FurniManifestEntry> => {
  measured.push(id);
  await new Promise((r) => setTimeout(r, 5));
  return {
    id,
    name: item.n,
    category: item.c,
    width: item.w,
    depth: item.d,
    height: item.h,
    canSit: Boolean(item.sit),
    canLay: false,
    wall: Boolean(item.wall),
    canWalk: false,
    sitHeight: 0.5,
    directions: item.wall ? [2, 4] : [0, 2],
    source: 'habboassets',
    anchors: {},
    states: [],
    stateAnchors: {},
    light: false,
  };
};

beforeEach(() => {
  measured = [];
  deps = makeDeps({ measureFurni: fakeMeasure, catalogFile: writeCatalog() });
});

describe('catálogo completo de móveis (Fase 36)', () => {
  it('mede uma vez só (mesmo com pedidos simultâneos), guarda e lista', async () => {
    const [a, b] = await Promise.all([
      furniDef('cadeira_x*2', deps),
      furniDef('cadeira_x*2', deps),
    ]);
    expect(a.ok && a.body.id).toBe('cadeira_x*2');
    expect(b.ok).toBe(true);
    expect(measured).toEqual(['cadeira_x*2']);
    expect(deps.furniDefs.has('cadeira_x*2')).toBe(true);
    const list = measuredDefs(deps);
    expect(list.ok && list.body.map((d) => d.id)).toEqual(['cadeira_x*2']);
    expect((await furniDef('nao_existe', deps)).status).toBe(404);
    // Curados não passam pela medição.
    const curated = [...deps.furniDefs.keys()][0]!;
    expect((await furniDef(curated, deps)).ok).toBe(true);
    expect(measured).toEqual(['cadeira_x*2']);
  });

  it('falha ao medir vira 502 e pode tentar de novo', async () => {
    let fail = true;
    deps = makeDeps({
      catalogFile: writeCatalog(),
      measureFurni: (item, id) =>
        fail ? Promise.reject(new Error('fora')) : fakeMeasure(item, id),
    });
    expect((await furniDef('quadro_y', deps)).status).toBe(502);
    fail = false;
    const ok = await furniDef('quadro_y', deps);
    expect(ok.ok && ok.body.wall).toBe(true);
  });

  it('categorias escondidas: festa e jogos por padrão, só o admin muda', async () => {
    const admin = await registered(deps);
    const beto = await registered(deps, { username: 'beto', name: 'Beto' });
    const cfg = furniConfig(deps);
    expect(cfg.ok && cfg.body.hiddenCategories).toContain('games');
    expect(deps.furniCatalog.blockedReason('arcade_z', deps.settings.hiddenCategories())).toMatch(
      /desligada/,
    );
    expect(
      deps.furniCatalog.blockedReason('cadeira_x', deps.settings.hiddenCategories()),
    ).toBeNull();

    expect(setHiddenCategories(callerOf(deps, beto.token), { hidden: [] }, deps).status).toBe(403);
    const res = setHiddenCategories(
      callerOf(deps, admin.token),
      { hidden: ['music', 'inventada', 'music'] },
      deps,
    );
    expect(res.ok && res.body.hiddenCategories).toEqual(['music']);
    expect(
      deps.furniCatalog.blockedReason('arcade_z', deps.settings.hiddenCategories()),
    ).toBeNull();
  });
});
