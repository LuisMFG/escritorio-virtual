/**
 * Miniaturas das fantasias (aba Fantasias do Meu visual): cada fantasia vestida no visual padrão
 * de cada gênero, gravada em `client/public/assets/costumes/{id}-{M|F}.png`. Antes as miniaturas
 * eram renders do imager na hora (25 de uma vez), que gastavam a cota de renders do servidor e
 * atrasavam a prévia e as roupas do avatar.
 *
 *   npm run assets:costumes            (só as que faltam)
 *   npm run assets:costumes -- --todas (refaz todas)
 */
import {
  applyCostume,
  avatarImageUrl,
  COSTUMES,
  parseAvatarManifest,
  type Gender,
} from '@office/shared';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HabboAssetsClient } from '../src/assets/HabboAssetsClient.js';
import { ROOT_DIR } from '../src/config.js';

/** Um render a cada 1,5 s: fica abaixo da cota do imager (45 por minuto). */
const EVERY_MS = 1500;

const manifest = parseAvatarManifest(
  JSON.parse(readFileSync(resolve(ROOT_DIR, 'client/public/assets/avatar/manifest.json'), 'utf8')),
);
const outDir = resolve(ROOT_DIR, 'client/public/assets/costumes');
await mkdir(outDir, { recursive: true });
const all = process.argv.includes('--todas');
const client = new HabboAssetsClient();
let made = 0;
for (const costume of COSTUMES) {
  for (const gender of ['M', 'F'] as Gender[]) {
    const file = resolve(outDir, `${costume.id}-${gender}.png`);
    if (!all && existsSync(file)) continue;
    const figure = applyCostume(manifest.defaults[gender], costume, gender);
    const { body } = await client.fetchImage(
      avatarImageUrl(figure, { direction: 2, headDirection: 2 }),
    );
    await writeFile(file, body);
    made++;
    console.log(`[fantasias] ${costume.id}-${gender}.png`);
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
console.log(`[fantasias] ${made} miniatura(s) nova(s) em ${outDir}`);
