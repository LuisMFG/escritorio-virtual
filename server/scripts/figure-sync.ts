/**
 * Gera `client/public/assets/figure/figuredata.json` (dados para montar o avatar no navegador)
 * a partir de /imaging/info/clothing/* da HabboAssets. Os desenhos vêm dos SWFs originais,
 * convertidos sob demanda pelo servidor em folhas de sprites (`/hh/figure/{lib}.png` e `.json`).
 *
 *   npm run assets:figure
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFigureData, FIGURE_LIBRARIES, type FigureLibInfo } from '../src/assets/figureData.js';
import { HabboAssetsClient } from '../src/assets/HabboAssetsClient.js';
import { config, ROOT_DIR } from '../src/config.js';
import { EFFECT_LIBRARIES, HAND_ITEM_LIB } from '@office/shared';

const client = new HabboAssetsClient({ apiKey: config.habboAssetsApiKey, imagerPerMinute: 90 });
const infos: FigureLibInfo[] = [];
const swf: Record<string, string> = {};
for (const lib of FIGURE_LIBRARIES) {
  process.stdout.write(`[figure] ${lib}… `);
  const info = await client.getImagerJson<FigureLibInfo>(`/info/clothing/${lib}`);
  infos.push(info);
  // SWF original da mesma revisão (o servidor converte em folha de sprites).
  const lib2 = await client.getJson<{ data: { revisions: { revision: string; url: string }[] } }>(
    `/swfs/libraries/clothing/${lib}`,
  );
  const rev =
    lib2.data.revisions.find((r) => Number(r.revision) === Number(info.latest)) ??
    lib2.data.revisions[0];
  if (rev) swf[lib] = rev.url;
  console.log('ok');
}
const data = buildFigureData(infos, swf);

// Itens na mão (Fase 34): só o SWF (não tem conjuntos de roupa).
type LibList = { data: { revisions: { revision: string; url: string }[] } };
const item = (
  await client.getJson<LibList>(`/swfs/libraries/clothing/${HAND_ITEM_LIB}`)
).data.revisions.at(-1)!;
data.libs[HAND_ITEM_LIB] = Number(item.revision);
data.swf[HAND_ITEM_LIB] = item.url;
console.log(`[figure] ${HAND_ITEM_LIB} ok`);

// Efeitos (Fase 34): o servidor converte o SWF de cada um em folha + animação.
data.effects = {};
for (const lib of EFFECT_LIBRARIES) {
  const rev = (await client.getJson<LibList>(`/swfs/libraries/effect/${lib}`)).data.revisions.at(
    -1,
  )!;
  data.effects[lib] = { revision: Number(rev.revision), swf: rev.url };
  console.log(`[figure] efeito ${lib} ok`);
}
const dir = resolve(ROOT_DIR, 'client', 'public', 'assets', 'figure');
await mkdir(dir, { recursive: true });
const out = resolve(dir, 'figuredata.json');
await writeFile(out, `${JSON.stringify(data)}\n`);
console.log(
  `[figure] ${Object.keys(data.sets).length} conjuntos, ${Object.keys(data.partLib).length} partes, ${Object.keys(data.libs).length} bibliotecas → ${out}`,
);
