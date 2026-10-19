import { furniImageUrl, type FurniManifestEntry } from '@office/shared';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { cacheFileFor, writeAtomic } from './AssetProxy.js';
import {
  analyzeRender,
  buildFurniEntry,
  type FurniCuration,
  type RenderAnalysis,
} from './furniCatalog.js';
import type { HabboAssetsClient } from './HabboAssetsClient.js';

interface FurniInfo {
  latest: number;
  directions: number[];
  states?: number[];
}

/**
 * Mede um móvel pelo imager: revisão, direções e estados, e a âncora de cada direção (pixel sobre
 * o vértice de baixo do footprint). As imagens ficam no mesmo cache do proxy `/hh`.
 */
export async function measureFurni(
  client: HabboAssetsClient,
  cur: FurniCuration,
  cacheDir: string,
): Promise<FurniManifestEntry> {
  const classname = cur.sprite ?? cur.id;
  const info = await client.getImagerJson<FurniInfo>(
    `/info/furniture/${encodeURIComponent(classname)}`,
  );
  /** Tamanho das imagens (itens de parede ancoram no centro). */
  const sizes = new Map<string, [number, number]>();
  const render = async (dir: number, state?: number): Promise<RenderAnalysis> => {
    const url = furniImageUrl(classname, { direction: dir, revision: info.latest, state });
    const file = cacheFileFor(cacheDir, url);
    let body: Buffer;
    if (existsSync(file)) body = await readFile(file);
    else {
      body = (await client.fetchImage(url)).body;
      await writeAtomic(file, body);
    }
    const png = PNG.sync.read(body);
    sizes.set(state === undefined ? String(dir) : `${dir}:${state}`, [png.width, png.height]);
    return analyzeRender(png);
  };
  // Estados com número alto (100…) são efeitos especiais; o toggle usa os primeiros.
  const states = (info.states ?? []).filter((s) => s <= 20).slice(0, 7);
  const analyses = new Map<number, RenderAnalysis>();
  const stateAnalyses = new Map<string, RenderAnalysis>();
  for (const dir of info.directions) {
    analyses.set(dir, await render(dir));
    if (cur.interaction === 'toggle') {
      for (const state of states.filter((s) => s > 0)) {
        // Alguns estados existem no SWF mas o imager não desenha (400): ficam de fora.
        const a = await render(dir, state).catch(() => null);
        if (a) stateAnalyses.set(`${dir}:${state}`, a);
      }
    }
  }
  // Só os estados que o imager desenhou (em alguma direção).
  const drawn = states.filter(
    (st) => st === 0 || [...stateAnalyses.keys()].some((k) => k.endsWith(`:${st}`)),
  );
  const usable = cur.interaction === 'toggle' ? drawn : states.length ? [0] : [];
  const curation =
    cur.interaction === 'toggle' && usable.length < 2 ? { ...cur, interaction: undefined } : cur;
  const entry = buildFurniEntry(
    curation,
    { ...info, states: usable.length > 1 ? usable : [] },
    analyses,
    stateAnalyses,
  ).entry;
  if (cur.wall) {
    // Item de parede: o centro da imagem vai no ponto escolhido da parede.
    const center = (keys: string[]) =>
      Object.fromEntries(
        keys.map((k) => {
          const [w, h] = sizes.get(k)!;
          return [k, [Math.round(w / 2), Math.round(h / 2)] as [number, number]];
        }),
      );
    entry.anchors = center([...sizes.keys()].filter((k) => !k.includes(':')));
    entry.stateAnchors = center([...sizes.keys()].filter((k) => k.includes(':')));
  }
  return entry;
}
