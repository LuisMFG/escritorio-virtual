import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Teto do cache de imagens em disco (avatares, móveis, roupas, capas da TV). */
export const ASSET_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
/** Passando do teto, apaga até sobrar esta fração (para não limpar a toda hora). */
const PRUNE_TO = 0.8;
/** Temporário de uma escrita que falhou (`arquivo.<pid>.tmp`): some depois disto. */
const TMP_MAX_AGE_MS = 60 * 60_000;

interface CachedFile {
  path: string;
  size: number;
  /** Último uso conhecido (leitura ou escrita). */
  used: number;
}

function walk(dir: string, out: CachedFile[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      const s = statSync(path);
      if (s.isDirectory()) walk(path, out);
      else out.push({ path, size: s.size, used: Math.max(s.atimeMs, s.mtimeMs) });
    } catch {
      // Sumiu no meio do caminho: ignora.
    }
  }
}

/**
 * Mantém o cache de imagens abaixo de `maxBytes`: os arquivos usados há mais tempo saem primeiro
 * (voltam do HabboAssets se alguém pedir de novo). Temporários esquecidos saem sempre.
 * Devolve quantos bytes apagou.
 */
export function pruneAssetCache(
  dir: string,
  maxBytes = ASSET_CACHE_MAX_BYTES,
  now = Date.now(),
): number {
  const files: CachedFile[] = [];
  walk(dir, files);
  let freed = 0;
  const remove = (f: CachedFile) => {
    try {
      rmSync(f.path, { force: true });
      freed += f.size;
    } catch {
      // Sem permissão ou já apagado: segue.
    }
  };
  const kept: CachedFile[] = [];
  for (const f of files) {
    if (f.path.endsWith('.tmp') && now - f.used > TMP_MAX_AGE_MS) remove(f);
    else kept.push(f);
  }
  let total = kept.reduce((n, f) => n + f.size, 0);
  if (total <= maxBytes) return freed;
  kept.sort((a, b) => a.used - b.used);
  for (const f of kept) {
    if (total <= maxBytes * PRUNE_TO) break;
    remove(f);
    total -= f.size;
  }
  return freed;
}
