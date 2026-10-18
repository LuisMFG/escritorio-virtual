/**
 * Confere o avatar montado no navegador contra o imager da HabboAssets: monta várias figuras
 * nas 8 direções e conta os pixels diferentes. Grava as piores comparações lado a lado.
 *
 *   npm run assets:figure-check -- [pasta-de-saída] [quantidade-de-figuras-aleatórias]
 */
import {
  avatarImageUrl,
  composeFigure,
  FIGURE_HEIGHT,
  FIGURE_WIDTH,
  partsWithoutArt,
  resolveFigure,
  type FigureData,
  type FigureLib,
} from '@office/shared';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { AVATAR_DEFAULTS } from '../src/assets/avatarManifest.js';
import { HabboAssetsClient } from '../src/assets/HabboAssetsClient.js';
import { buildFigureSheet, readSwf } from '../src/assets/swfFigure.js';
import { ROOT_DIR } from '../src/config.js';

const outDir = resolve(process.argv[2] ?? resolve(ROOT_DIR, 'data', 'figure-check'));
const randomCount = Number(process.argv[3] ?? 8);
mkdirSync(outDir, { recursive: true });
const data = JSON.parse(
  readFileSync(resolve(ROOT_DIR, 'client/public/assets/figure/figuredata.json'), 'utf8'),
) as FigureData;
const manifest = JSON.parse(
  readFileSync(resolve(ROOT_DIR, 'client/public/assets/avatar/manifest.json'), 'utf8'),
) as {
  categories: {
    type: string;
    required: boolean;
    sets: { id: number; gender: string; colors: number; palette?: number }[];
  }[];
  palettes: Record<string, { id: number }[]>;
};
const client = new HabboAssetsClient({ imagerPerMinute: 60 });

const libs = new Map<string, FigureLib>();
async function loadLib(name: string): Promise<FigureLib> {
  const hit = libs.get(name);
  if (hit) return hit;
  // A mesma conversão que o servidor faz em /hh/figure/{lib}.png e .json.
  const built = buildFigureSheet(name, readSwf(await client.fetchSwf(data.swf[name]!)));
  const png = PNG.sync.read(built.png);
  const lib: FigureLib = { ...built.sheet, width: png.width, height: png.height, pixels: png.data };
  libs.set(name, lib);
  return lib;
}

/** Figuras aleatórias com as peças do editor (para pegar casos que ninguém testou à mão). */
function randomFigure(seed: number): string {
  let s = seed;
  const rnd = (n: number) => ((s = (s * 1103515245 + 12345) % 2 ** 31), s % n);
  const gender = rnd(2) ? 'M' : 'F';
  const tokens: string[] = [];
  for (const cat of manifest.categories) {
    if (!cat.required && rnd(3) === 0) continue;
    const options = cat.sets.filter((x) => x.gender === gender || x.gender === 'U');
    const set = options[rnd(options.length)];
    if (!set) continue;
    const paletteId = String(data.sets[`${cat.type}:${set.id}`]?.p ?? '');
    const colors = Object.keys(data.palettes[paletteId] ?? {});
    const picks = Array.from(
      { length: Math.max(1, set.colors) },
      () => colors[rnd(colors.length)] ?? '1',
    );
    tokens.push([cat.type, set.id, ...picks].join('-'));
  }
  return tokens.join('.');
}

const figures = [
  AVATAR_DEFAULTS.M,
  AVATAR_DEFAULTS.F,
  'hd-3092-24.hr-848-46.ha-1009-1340.ch-215-107.ca-1817.lg-280-1338.sh-305-101',
  'hd-6021-17.hr-165-1403.ha-1001.ea-1402.ch-262-107.ca-1813.lg-281-94.sh-305-74',
  ...Array.from({ length: randomCount }, (_, i) => randomFigure(i + 7)),
];

const results: { figure: string; dir: number; diff: number; ours: Uint8ClampedArray; ref: PNG }[] =
  [];
for (const figure of figures) {
  const resolved = resolveFigure(figure, data);
  if (resolved.missing.length) {
    console.log(`(imager) ${figure}: falta ${resolved.missing.join(', ')}`);
    continue;
  }
  for (const name of resolved.libs) await loadLib(name);
  const noArt = partsWithoutArt(resolved.parts, libs);
  if (noArt.length) {
    console.log(
      `(imager) ${figure}: sem desenho ${noArt.map((p) => `${p.type}:${p.id}`).join(', ')}`,
    );
    continue;
  }
  for (let dir = 0; dir < 8; dir++) {
    const ours = composeFigure(resolved.parts, libs, { direction: dir });
    const ref = PNG.sync.read(
      (await client.fetchImage(avatarImageUrl(figure, { direction: dir }))).body,
    );
    let diff = 0;
    for (let i = 0; i < FIGURE_WIDTH * FIGURE_HEIGHT; i++) {
      const a = ours[i * 4 + 3]! > 0;
      const b = ref.data[i * 4 + 3]! > 0;
      if (a !== b) diff++;
      else if (a) {
        const d = [0, 1, 2].reduce(
          (n, c) => n + Math.abs(ours[i * 4 + c]! - ref.data[i * 4 + c]!),
          0,
        );
        if (d > 30) diff++;
      }
    }
    results.push({ figure, dir, diff, ours, ref });
  }
  const mine = results.filter((r) => r.figure === figure);
  console.log(`${mine.map((r) => String(r.diff).padStart(4)).join(' ')}  ${figure}`);
}

// As 6 piores, lado a lado (nosso | imager), ampliadas 3x.
const worst = [...results].sort((a, b) => b.diff - a.diff).slice(0, 6);
const S = 3;
const W = FIGURE_WIDTH * S;
const H = FIGURE_HEIGHT * S;
const img = new PNG({ width: worst.length * (2 * W + 16), height: H });
for (let i = 0; i < img.width * img.height; i++) img.data.set([36, 40, 48, 255], i * 4);
worst.forEach((r, k) => {
  for (const [col, px] of [
    [0, r.ours],
    [1, r.ref.data],
  ] as const) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const si = (Math.floor(y / S) * FIGURE_WIDTH + Math.floor(x / S)) * 4;
        if (!px[si + 3]) continue;
        img.data.set(
          [px[si]!, px[si + 1]!, px[si + 2]!, 255],
          (y * img.width + k * (2 * W + 16) + col * W + x) * 4,
        );
      }
  }
});
writeFileSync(resolve(outDir, 'piores.png'), PNG.sync.write(img));
const avg = results.reduce((n, r) => n + r.diff, 0) / Math.max(1, results.length);
console.log(
  `\nmédia ${avg.toFixed(0)} px diferentes de ${FIGURE_WIDTH * FIGURE_HEIGHT}; piores: ${worst.map((r) => `${r.diff}(d${r.dir})`).join(' ')} → ${outDir}/piores.png`,
);
