/**
 * Catálogo completo de roupas (Fase 35) e dados para montar o avatar no navegador:
 *
 *   - `client/public/assets/figure/figuredata.json`: partes de cada roupa, onde está cada parte,
 *     paletas, o SWF de cada biblioteca, itens na mão e efeitos;
 *   - `client/public/assets/avatar/manifest.json`: o catálogo do editor (todas as roupas usáveis
 *     do Habbo Brasil, menos as NFT).
 *
 * Lê a lista de bibliotecas de roupa da HabboAssets e o `/imaging/info/clothing/{lib}` de cada
 * uma (com cache em disco por revisão: rodar de novo só baixa o que mudou).
 *
 *   npm run assets:figure
 */
import { EFFECT_LIBRARIES, HAND_ITEM_LIB, parseAvatarManifest } from '@office/shared';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  buildAvatarManifest,
  FULL_CATALOG,
  type ClothingInfo,
} from '../src/assets/avatarManifest.js';
import { buildFigureData, type FigureLibInfo } from '../src/assets/figureData.js';
import { HabboAssetsClient } from '../src/assets/HabboAssetsClient.js';
import { config, ROOT_DIR } from '../src/config.js';

const client = new HabboAssetsClient({
  apiKey: config.habboAssetsApiKey,
  restPerMinute: 300,
  imagerPerMinute: 90,
});
type LibRow = { name: string; revision: string; url: string; wearable?: boolean | null };
type LibList = { data: { revisions: { revision: string; url: string }[] } };

// 1. Todas as bibliotecas de roupa (paginado).
const all: LibRow[] = [];
for (let page = 1; ; page++) {
  const res = await client.getJson<{ data: LibRow[]; meta: { last_page: number } }>(
    `/swfs/libraries?kind=clothing&page=${page}`,
  );
  all.push(...res.data);
  process.stdout.write(
    `\r[figure] lista: ${all.length} bibliotecas (página ${page}/${res.meta.last_page})`,
  );
  if (page >= res.meta.last_page) break;
}
console.log();
// Sem NFT (decisão do roadmap v5) e sem as bibliotecas que não são roupa.
const libs = all.filter(
  (l) => !/nft/i.test(l.name) && l.name !== 'hh_human_fx' && l.name !== HAND_ITEM_LIB,
);
// As básicas primeiro: numa parte declarada em duas bibliotecas, vale a básica.
libs.sort(
  (a, b) => Number(b.name.startsWith('hh_human_')) - Number(a.name.startsWith('hh_human_')),
);

// 2. Dados de cada biblioteca (cache em disco por revisão).
const cacheDir = join(config.assetCacheDir, 'clothing-info');
await mkdir(cacheDir, { recursive: true });
const infos: (FigureLibInfo & ClothingInfo)[] = [];
let done = 0;
let failed = 0;
const queue = [...libs];
async function worker(): Promise<void> {
  for (let lib = queue.shift(); lib; lib = queue.shift()) {
    const file = join(cacheDir, `${lib.name}-${lib.revision}.json`);
    try {
      let info: FigureLibInfo & ClothingInfo;
      try {
        info = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        info = await client.getImagerJson(`/info/clothing/${lib.name}`);
        await writeFile(file, JSON.stringify(info));
      }
      if (info.figuredata?.length) infos.push(info);
    } catch (err) {
      failed++;
      console.warn(`\n[figure] ${lib.name}: ${(err as Error).message}`);
    }
    done++;
    if (done % 25 === 0 || done === libs.length) {
      process.stdout.write(
        `\r[figure] dados: ${done}/${libs.length}${failed ? ` (${failed} falharam)` : ''}`,
      );
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log();
// Ordem estável (as básicas primeiro) para o arquivo não mudar à toa entre execuções.
const order = new Map(libs.map((l, i) => [l.name, i]));
infos.sort((a, b) => order.get(a.library)! - order.get(b.library)!);

// 3. Dados de montagem.
const swf = Object.fromEntries(libs.map((l) => [l.name, l.url]));
const data = buildFigureData(infos, swf);
const item = (
  await client.getJson<LibList>(`/swfs/libraries/clothing/${HAND_ITEM_LIB}`)
).data.revisions.at(-1)!;
data.libs[HAND_ITEM_LIB] = Number(item.revision);
data.swf[HAND_ITEM_LIB] = item.url;
data.effects = {};
for (const lib of EFFECT_LIBRARIES) {
  const rev = (await client.getJson<LibList>(`/swfs/libraries/effect/${lib}`)).data.revisions.at(
    -1,
  )!;
  data.effects[lib] = { revision: Number(rev.revision), swf: rev.url };
}
const figureDir = resolve(ROOT_DIR, 'client', 'public', 'assets', 'figure');
await mkdir(figureDir, { recursive: true });
await writeFile(resolve(figureDir, 'figuredata.json'), `${JSON.stringify(data)}\n`);

// 4. Catálogo do editor.
const manifest = buildAvatarManifest(new Map(infos.map((i) => [i.library, i])), FULL_CATALOG);
// Só peças que dá para montar (todas as partes com biblioteca conhecida).
for (const cat of manifest.categories) {
  cat.sets = cat.sets.filter((s) => data.sets[`${cat.type}:${s.id}`]);
}
parseAvatarManifest(manifest);
const comment =
  'Gerado por `npm run assets:figure` (catálogo completo de roupas do Habbo Brasil, sem NFT). Não editar à mão.';
await writeFile(
  resolve(ROOT_DIR, 'client', 'public', 'assets', 'avatar', 'manifest.json'),
  `${JSON.stringify({ $comment: comment, ...manifest }, null, 1)}\n`,
);
const total = manifest.categories.reduce((n, c) => n + c.sets.length, 0);
console.log(
  `[figure] ${infos.length} bibliotecas, ${Object.keys(data.sets).length} conjuntos; editor: ${total} peças em ${manifest.categories.length} categorias`,
);
console.log(manifest.categories.map((c) => `${c.label}: ${c.sets.length}`).join(' · '));
