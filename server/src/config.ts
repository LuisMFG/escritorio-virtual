import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz do monorepo (server/src/config.ts → ../../). */
export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const envFile = resolve(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.VITEST !== undefined;

function fromRoot(p: string): string {
  return isAbsolute(p) ? p : resolve(ROOT_DIR, p);
}

function inviteCode(): string {
  const code = process.env.INVITE_CODE?.trim();
  if (code) return code;
  if (isProduction) throw new Error('Defina INVITE_CODE no ambiente (veja .env.example).');
  if (!isTest)
    console.warn('[config] INVITE_CODE não definido; usando "convite" em desenvolvimento.');
  return 'convite';
}

export interface Config {
  port: number;
  inviteCode: string;
  databasePath: string;
  assetCacheDir: string;
  habboAssetsApiKey: string | undefined;
  clientDistDir: string;
  isProduction: boolean;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 2567),
  inviteCode: inviteCode(),
  databasePath: fromRoot(process.env.DATABASE_PATH ?? './data/sqlite.db'),
  assetCacheDir: fromRoot(process.env.ASSET_CACHE_DIR ?? './data/asset-cache'),
  habboAssetsApiKey: process.env.HABBOASSETS_API_KEY?.trim() || undefined,
  clientDistDir: resolve(ROOT_DIR, 'client', 'dist'),
  isProduction,
};
