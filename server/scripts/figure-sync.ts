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
const dir = resolve(ROOT_DIR, 'client', 'public', 'assets', 'figure');
await mkdir(dir, { recursive: true });
const out = resolve(dir, 'figuredata.json');
await writeFile(out, `${JSON.stringify(data)}\n`);
console.log(
  `[figure] ${Object.keys(data.sets).length} conjuntos, ${Object.keys(data.partLib).length} partes, ${Object.keys(data.libs).length} bibliotecas → ${out}`,
);
