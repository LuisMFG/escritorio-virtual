/**
 * Sincroniza os assets curados com a HabboAssets API (hotel Brasil).
 *
 *   npm run assets:sync              # regenera client/public/assets/avatar/manifest.json
 *   npm run assets:sync -- --thumbs  # e pré-baixa as miniaturas das roupas para o cache do servidor
 *
 * O manifesto gerado deve ser revisado e versionado no git. As miniaturas ficam em
 * data/asset-cache (o mesmo cache do proxy /hh), então o editor abre sem esperar o imager.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clothingSetImageUrl } from '@office/shared';
import { cacheFileFor, writeAtomic } from '../src/assets/AssetProxy.js';
import {
  AVATAR_CURATION,
  buildAvatarManifest,
  type ClothingInfo,
} from '../src/assets/avatarManifest.js';
import { HabboAssetsClient } from '../src/assets/HabboAssetsClient.js';
import { config, ROOT_DIR } from '../src/config.js';

const withThumbs = process.argv.includes('--thumbs');
const client = new HabboAssetsClient({
  apiKey: config.habboAssetsApiKey,
  restPerMinute: 60,
  imagerPerMinute: 90,
});

const libraries = [...new Set(AVATAR_CURATION.flatMap((c) => c.libraries))];
const infos = new Map<string, ClothingInfo>();
for (const lib of libraries) {
  process.stdout.write(`[sync] biblioteca ${lib}… `);
  infos.set(lib, await client.getImagerJson<ClothingInfo>(`/info/clothing/${lib}`));
  console.log('ok');
}

const manifest = buildAvatarManifest(infos);
const out = resolve(ROOT_DIR, 'client', 'public', 'assets', 'avatar', 'manifest.json');
const comment =
  'Gerado por `npm run assets:sync` a partir de /imaging/info/clothing/* da HabboAssets (hotel 2). ' +
  'Curadoria em server/src/assets/avatarManifest.ts. Não editar à mão: rode o script de novo.';
await writeFile(out, `${JSON.stringify({ $comment: comment, ...manifest }, null, 2)}\n`);
const total = manifest.categories.reduce((n, c) => n + c.sets.length, 0);
console.log(
  `[sync] manifesto do avatar: ${manifest.categories.length} categorias, ${total} peças → ${out}`,
);

if (withThumbs) {
  let done = 0;
  let fetched = 0;
  let failed = 0;
  for (const category of manifest.categories) {
    for (const set of category.sets) {
      const url = clothingSetImageUrl(set.id, { direction: 2 });
      const file = cacheFileFor(config.assetCacheDir, url);
      done++;
      if (existsSync(file)) continue;
      try {
        const img = await client.fetchImage(url);
        await writeAtomic(file, img.body);
        fetched++;
      } catch (err) {
        failed++;
        console.warn(`[sync] miniatura ${category.type}-${set.id}: ${(err as Error).message}`);
      }
      if (done % 25 === 0) console.log(`[sync] miniaturas: ${done}/${total}`);
    }
  }
  console.log(
    `[sync] miniaturas: ${fetched} baixadas, ${total - fetched - failed} já em cache, ${failed} falharam`,
  );
}
