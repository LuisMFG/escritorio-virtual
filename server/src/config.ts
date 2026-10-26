import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaConfig } from './services/MediaService.js';

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

/** App do Spotify (Fase 21). Sem `SPOTIFY_CLIENT_ID`, a integração fica desligada. */
export interface SpotifyConfig {
  clientId: string;
  /** Endereço de retorno cadastrado no app do Spotify (https, ou http://127.0.0.1 em dev). */
  redirectUri: string;
  /** Para onde o navegador volta depois de conectar (o endereço do escritório). */
  returnUrl: string;
}

function spotify(port: number): SpotifyConfig | undefined {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) return undefined;
  return {
    clientId,
    redirectUri:
      process.env.SPOTIFY_REDIRECT_URI?.trim() || `http://127.0.0.1:${port}/api/spotify/callback`,
    returnUrl: process.env.SPOTIFY_RETURN_URL?.trim() || '/',
  };
}

export interface Config {
  port: number;
  inviteCode: string;
  /** `ADMIN_USERNAMES` (separados por vírgula, minúsculos). */
  adminUsernames: string[];
  databasePath: string;
  assetCacheDir: string;
  habboAssetsApiKey: string | undefined;
  clientDistDir: string;
  isProduction: boolean;
  spotify?: SpotifyConfig;
  /** Pasta dos backups diários do banco (Fase 22). */
  backupDir: string;
  /** Jira Cloud fixo pelo servidor (senão, o admin define no painel). */
  jiraSite?: string;
  /** Chave que cifra os tokens das integrações (`SECRET_KEY`, base64) e o arquivo usado sem ela. */
  secretKey: string | undefined;
  secretKeyFile: string;
  /** Pasta dos anexos do chat (Fase 29). */
  uploadDir: string;
  /** Quantos backups guardar. */
  backupKeep: number;
  /** Tentativas de entrada/cadastro por minuto por IP (os testes de ponta a ponta sobem isso). */
  loginRateLimit: number;
  /** TURN da Cloudflare para as chamadas (Fase 49); sem ele, só STUN. */
  turn?: { keyId: string; apiToken: string };
  /** Servidor de mídia das chamadas (LiveKit); sem ele, as chamadas não ligam áudio e vídeo. */
  media?: MediaConfig;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 2567),
  inviteCode: inviteCode(),
  adminUsernames: (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean),
  databasePath: fromRoot(process.env.DATABASE_PATH ?? './data/sqlite.db'),
  assetCacheDir: fromRoot(process.env.ASSET_CACHE_DIR ?? './data/asset-cache'),
  habboAssetsApiKey: process.env.HABBOASSETS_API_KEY?.trim() || undefined,
  clientDistDir: resolve(ROOT_DIR, 'client', 'dist'),
  isProduction,
  spotify: spotify(Number(process.env.PORT ?? 2567)),
  backupDir: fromRoot(process.env.BACKUP_DIR ?? './data/backups'),
  jiraSite: process.env.JIRA_SITE?.trim().replace(/\/+$/, '') || undefined,
  secretKey: process.env.SECRET_KEY,
  secretKeyFile: fromRoot(process.env.SECRET_KEY_FILE ?? './data/secret.key'),
  uploadDir: fromRoot(process.env.UPLOAD_DIR ?? './data/uploads'),
  backupKeep: Math.max(1, Number(process.env.BACKUP_KEEP ?? 7) || 7),
  loginRateLimit: Math.max(1, Number(process.env.LOGIN_RATE_LIMIT ?? 60) || 60),
  turn: turnConfig(),
  media: mediaConfig(),
};

/**
 * LiveKit: em desenvolvimento e nos testes, o `livekit-server --dev` (chave e segredo de
 * desenvolvimento, porta 7880). Em produção, a chave do `.env` e o LiveKit atrás do Caddy em
 * `/livekit` (o servidor fala com ele direto, pela rede do Docker).
 */
function mediaConfig(): MediaConfig | undefined {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() || (isProduction ? '' : 'devkey');
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() || (isProduction ? '' : 'secret');
  if (!apiKey || !apiSecret) return undefined;
  return {
    apiKey,
    apiSecret,
    url: process.env.LIVEKIT_URL?.trim() || (isProduction ? '/livekit' : 'ws://localhost:7880'),
    apiUrl:
      process.env.LIVEKIT_API_URL?.trim() ||
      (isProduction ? 'http://livekit:7880' : 'http://localhost:7880'),
  };
}

function turnConfig(): Config['turn'] {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  return keyId && apiToken ? { keyId, apiToken } : undefined;
}
