/**
 * Catálogo dos pets do Habbo (Fase 38): lê a lista de bibliotecas de pet da HabboAssets, baixa o
 * SWF de cada uma e grava `client/public/assets/pets/pets.json` com as paletas e posturas.
 *
 *   npm run assets:pets
 */
import { HABBO_PET_NAMES, type HabboPetCatalog, type HabboPetType } from '@office/shared';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseFurniVisualization } from '../src/assets/furniVisual.js';
import { HabboAssetsClient } from '../src/assets/HabboAssetsClient.js';
import { readSwf } from '../src/assets/swfFigure.js';
import { ROOT_DIR } from '../src/config.js';

const client = new HabboAssetsClient();
const list = await client.getJson<{ data: { name: string; revision: string; url: string }[] }>(
  '/swfs/libraries?kind=pet&per_page=100',
);
const pets: HabboPetType[] = [];
for (const lib of list.data) {
  const name = HABBO_PET_NAMES[lib.name];
  if (!name) {
    console.log(`[pets] ${lib.name}: sem nome em português, fica de fora`);
    continue;
  }
  try {
    const swf = readSwf(await client.fetchSwf(lib.url));
    const vis = parseFurniVisualization(
      swf.binaries.get(`${lib.name}_${lib.name}_visualization`) ?? '',
    );
    const postures = Object.keys(vis.postures ?? {});
    if (!postures.includes('std')) throw new Error('sem postura em pé');
    if (!postures.includes('mv') && !postures.includes('wlk')) throw new Error('não anda');
    // Paletas: dados binários de 256 cores RGB (768 bytes, às vezes com 4 a mais no fim), com
    // nomes variados por pet.
    const palettes = [...swf.raw.entries()]
      .filter(([k, v]) => (v.length === 768 || v.length === 772) && k.startsWith(`${lib.name}_`))
      .map(([k]) => k.slice(lib.name.length + 1))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    // O cavalo pinta corpo e crina com paletas diferentes: fica de fora.
    if (palettes.some((p) => /bodypalette|hairpalette/.test(p))) {
      throw new Error('paletas de corpo e crina separadas');
    }
    const assetsXml = swf.binaries.get(`${lib.name}_${lib.name}_assets`) ?? '';
    if (!palettes.length && /usesPalette=["']1/.test(assetsXml)) {
      throw new Error('as cores dependem de paletas que não vêm no SWF');
    }
    pets.push({
      type: lib.name,
      name,
      revision: Number(lib.revision),
      swf: lib.url,
      palettes,
      postures,
    });
    console.log(`[pets] ${lib.name}: ${palettes.length} paletas, ${postures.join(' ')}`);
  } catch (err) {
    console.log(`[pets] ${lib.name}: ${(err as Error).message}`);
  }
}
pets.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
const out = resolve(ROOT_DIR, 'client', 'public', 'assets', 'pets', 'pets.json');
await mkdir(resolve(out, '..'), { recursive: true });
const catalog: HabboPetCatalog = { version: 1, pets };
await writeFile(out, `${JSON.stringify(catalog, null, 1)}\n`);
console.log(`[pets] ${pets.length} tipos → ${out}`);
