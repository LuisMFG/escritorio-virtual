/**
 * Catálogo completo de móveis (Fase 36): lê os ~18 mil móveis do Habbo Brasil na API da
 * HabboAssets (precisa de HABBOASSETS_API_KEY) e grava `client/public/assets/furni/catalog.json`
 * com nome, categoria, tamanho, se senta/deita/anda por cima e as variações de cor.
 *
 *   npm run assets:furni
 */
import {
  CATALOG_CATEGORY_IDS,
  baseClassname,
  type CatalogItem,
  type FurniCatalog,
} from '@office/shared';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HabboAssetsClient } from '../src/assets/HabboAssetsClient.js';
import { config, ROOT_DIR } from '../src/config.js';

if (!config.habboAssetsApiKey)
  throw new Error('Defina HABBOASSETS_API_KEY no .env (token gratuito da HabboAssets).');
const client = new HabboAssetsClient({ apiKey: config.habboAssetsApiKey, restPerMinute: 120 });

interface ApiFurni {
  classname: string;
  name: string;
  category: string;
  type: 'room' | 'wall';
  revision: string;
  dimensions: { x: number | null; y: number | null; z: number | null };
  logic: string;
  can_sit_on: boolean;
  can_stand_on: boolean;
  can_lay_on: boolean;
  swf: { directions?: number[] } | null;
}

/** Só móveis comuns (os outros tipos são coisas do hotel: créditos, wired, presentes, roupas…). */
const LOGICS = new Set(['furniture_basic', 'furniture_multistate']);

// Lista bruta em cache por um dia (a paginação inteira leva um minuto e meio).
const rawFile = join(config.assetCacheDir, 'furni-list.json');
let all: ApiFurni[] = [];
try {
  const st = await stat(rawFile);
  if (Date.now() - st.mtimeMs < 86_400_000) all = JSON.parse(await readFile(rawFile, 'utf8'));
} catch {
  // sem cache
}
for (let page = 1; all.length === 0 || page > 1; page++) {
  const res = await client.getJson<{ data: ApiFurni[]; meta: { last_page: number } }>(
    `/furniture?per_page=100&page=${page}&sort=name`,
    { auth: true },
  );
  all.push(...res.data);
  process.stdout.write(`\r[furni] ${all.length} móveis (página ${page}/${res.meta.last_page})`);
  if (page >= res.meta.last_page) {
    await mkdir(config.assetCacheDir, { recursive: true });
    await writeFile(rawFile, JSON.stringify(all));
    break;
  }
}
console.log();

const usable = all.filter(
  (f) =>
    LOGICS.has(f.logic) &&
    CATALOG_CATEGORY_IDS.includes(f.category) &&
    (f.name ?? '').trim() &&
    // NFT são cópias dos mesmos desenhos.
    !/^\s*(ads_|test|nft_)/i.test(f.classname) &&
    (f.swf?.directions?.length ?? 0) > 0,
);

// Agrupa as variações de cor (`base*N`) num item só.
const groups = new Map<string, ApiFurni[]>();
for (const f of usable) {
  const base = baseClassname(f.classname);
  groups.set(base, [...(groups.get(base) ?? []), f]);
}
const items: CatalogItem[] = [];
for (const [base, variants] of groups) {
  variants.sort(
    (a, b) => Number(a.classname.split('*')[1] ?? 0) - Number(b.classname.split('*')[1] ?? 0),
  );
  const main = variants.find((v) => v.classname === base) ?? variants[0]!;
  const wall = main.type === 'wall';
  const item: CatalogItem = {
    id: main.classname,
    n: main.name.trim().replace(/\s+/g, ' '),
    c: main.category,
    w: wall ? 1 : Math.max(1, main.dimensions.x ?? 1),
    d: wall ? 1 : Math.max(1, main.dimensions.y ?? 1),
    h: Math.round((main.dimensions.z ?? 1) * 100) / 100,
    rev: Number(main.revision),
  };
  if (wall) item.wall = 1;
  if (main.can_sit_on) item.sit = 1;
  if (main.can_lay_on) item.lay = 1;
  if (main.can_stand_on && !main.can_sit_on && !main.can_lay_on) item.walk = 1;
  if (main.logic === 'furniture_multistate') item.multi = 1;
  if (variants.length > 1) item.colors = variants.map((v) => v.classname);
  items.push(item);
}
items.sort((a, b) => a.n.localeCompare(b.n, 'pt-BR'));

const catalog: FurniCatalog = { version: 1, generatedAt: new Date().toISOString(), items };
const out = resolve(ROOT_DIR, 'client', 'public', 'assets', 'furni', 'catalog.json');
await writeFile(out, `${JSON.stringify(catalog)}\n`);
const byCat = new Map<string, number>();
for (const i of items) byCat.set(i.c, (byCat.get(i.c) ?? 0) + 1);
console.log(`[furni] ${items.length} móveis no catálogo (${usable.length} com as cores) → ${out}`);
console.log(
  [...byCat]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}: ${n}`)
    .join(' · '),
);
