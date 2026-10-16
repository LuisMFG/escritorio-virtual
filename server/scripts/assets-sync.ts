/**
 * Sincroniza os assets curados com a HabboAssets API (hotel Brasil).
 *
 *   npm run assets:sync              # regenera os manifestos do avatar e dos móveis
 *   npm run assets:sync -- --thumbs  # e pré-baixa as miniaturas das roupas para o cache do servidor
 *
 * Os manifestos gerados devem ser revisados e versionados no git. Imagens baixadas ficam em
 * data/asset-cache (o mesmo cache do proxy /hh).
 *
 * Móveis: revisão, direções e âncoras vêm do imager público; o tamanho vem da curadoria
 * (server/src/assets/furniCatalog.ts) ou, se faltar, da estimativa medida nas imagens.
 * Com HABBOASSETS_API_KEY, tenta também nome e tamanho da furnidata (/furniture/{classname}).
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  clothingSetImageUrl,
  furniImageUrl,
  parseFurniManifest,
  type FurniManifestEntry,
} from '@office/shared';
import { PNG } from 'pngjs';
import { cacheFileFor, writeAtomic } from '../src/assets/AssetProxy.js';
import {
  AVATAR_CURATION,
  buildAvatarManifest,
  type ClothingInfo,
} from '../src/assets/avatarManifest.js';
import {
  analyzeRender,
  buildFurniEntry,
  buildLocalEntry,
  FURNI_CURATION,
  type RenderAnalysis,
} from '../src/assets/furniCatalog.js';
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

// ---------- Móveis ----------

interface FurniInfo {
  latest: number;
  directions: number[];
}

/** Lê nome e tamanho da furnidata, aceitando variações de formato (formato não verificado sem token). */
function readFurnidata(json: unknown): { name?: string; width?: number; depth?: number } {
  const root = (json as { data?: unknown })?.data ?? json;
  const pools = [root, (root as { furnidata?: unknown })?.furnidata].filter(Boolean) as Record<
    string,
    unknown
  >[];
  const pick = (keys: string[]) => {
    for (const pool of pools)
      for (const k of keys) if (pool[k] !== undefined && pool[k] !== null) return pool[k];
    return undefined;
  };
  const name = pick(['name', 'publicName', 'title']);
  const xdim = Number(pick(['xdim', 'x_dim', 'width']));
  const ydim = Number(pick(['ydim', 'y_dim', 'length', 'depth']));
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
    width: Number.isInteger(xdim) && xdim > 0 ? xdim : undefined,
    depth: Number.isInteger(ydim) && ydim > 0 ? ydim : undefined,
  };
}

const furniEntries: FurniManifestEntry[] = [];
console.log('[sync] móveis…');
for (const cur of FURNI_CURATION) {
  if (cur.source === 'local') {
    furniEntries.push(buildLocalEntry(cur));
    console.log(`[sync]   ${cur.id.padEnd(30)} local`);
    continue;
  }
  const info = await client.getImagerJson<FurniInfo>(`/info/furniture/${cur.id}`);
  const analyses = new Map<number, RenderAnalysis>();
  for (const dir of info.directions) {
    const url = furniImageUrl(cur.id, { direction: dir, revision: info.latest });
    const file = cacheFileFor(config.assetCacheDir, url);
    let body: Buffer;
    if (existsSync(file)) body = await readFile(file);
    else {
      body = (await client.fetchImage(url)).body;
      await writeAtomic(file, body);
    }
    analyses.set(dir, analyzeRender(PNG.sync.read(body)));
  }
  let curation = cur;
  if (client.hasApiKey) {
    try {
      const fd = readFurnidata(await client.getJson(`/furniture/${cur.id}`, { auth: true }));
      curation = { ...cur, width: fd.width ?? cur.width, depth: fd.depth ?? cur.depth };
    } catch (err) {
      console.warn(`[sync] furnidata de ${cur.id}: ${(err as Error).message}`);
    }
  }
  const { entry, estimated } = buildFurniEntry(curation, info, analyses);
  const size = `${entry.width}×${entry.depth}`;
  const est = `${estimated.width}×${estimated.depth}`;
  const note =
    cur.width === undefined ? '(estimado)' : size === est ? '' : `⚠ imagem sugere ${est}`;
  console.log(
    `[sync]   ${cur.id.padEnd(30)} ${size.padEnd(5)} dirs ${info.directions.join(',').padEnd(8)} ${note}`,
  );
  furniEntries.push(entry);
}
const furniOut = resolve(ROOT_DIR, 'client', 'public', 'assets', 'furni', 'manifest.json');
const furniManifest = parseFurniManifest({ version: 1, hotelId: 2, items: furniEntries });
const furniComment =
  'Gerado por `npm run assets:sync`. Curadoria (nomes, categorias, tamanhos) em server/src/assets/furniCatalog.ts; ' +
  'anchors[dir] = pixel da PNG do imager sobre o vértice de baixo do footprint. width/depth valem para rot 0; rot 2/6 trocam os eixos.';
await writeFile(
  furniOut,
  `${JSON.stringify({ $comment: furniComment, ...furniManifest }, null, 2)}\n`,
);
console.log(`[sync] manifesto de móveis: ${furniEntries.length} itens → ${furniOut}`);
