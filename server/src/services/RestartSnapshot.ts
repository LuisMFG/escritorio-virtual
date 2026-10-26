import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { CallService, CallSnapshot } from './CallService.js';
import type { FocusService, FocusState } from './FocusService.js';
import type { TvService, TvSnapshot } from './TvService.js';

/** Chave em `settings` do retrato guardado ao desligar. */
const KEY = 'estado_ao_desligar';
/** Retrato mais velho que isto (o servidor ficou parado muito tempo) não volta. */
export const RESTART_SNAPSHOT_MAX_AGE_MS = 10 * 60_000;

interface RestartSnapshot {
  savedAt: number;
  focus: [string, FocusState][];
  tv: TvSnapshot[];
  calls: CallSnapshot[];
}

interface Deps {
  db: Db;
  focus: FocusService;
  tv: TvService;
  calls: CallService;
}

/**
 * Guarda o que só existe na memória (foco, TVs e chamadas) ao desligar o servidor, como numa
 * atualização: antes, tudo sumia a cada deploy.
 */
export function saveRestartSnapshot(deps: Deps, now = Date.now()): void {
  const snap: RestartSnapshot = {
    savedAt: now,
    focus: deps.focus.snapshot(),
    tv: deps.tv.snapshot(),
    calls: deps.calls.snapshot(),
  };
  const value = JSON.stringify(snap);
  deps.db
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

/**
 * Ao subir: volta o retrato, se for recente, e o apaga (vale uma vez só). Devolve o que voltou,
 * para o log.
 */
export function restoreRestartSnapshot(
  deps: Deps,
  now = Date.now(),
): { focus: number; tv: number; calls: number } | null {
  const row = deps.db.select().from(settings).where(eq(settings.key, KEY)).get();
  if (!row) return null;
  deps.db.delete(settings).where(eq(settings.key, KEY)).run();
  let snap: RestartSnapshot;
  try {
    snap = JSON.parse(row.value) as RestartSnapshot;
  } catch {
    return null;
  }
  if (!(now - snap.savedAt <= RESTART_SNAPSHOT_MAX_AGE_MS)) return null;
  deps.focus.restore(snap.focus ?? []);
  deps.tv.restore(snap.tv ?? []);
  deps.calls.restore(snap.calls ?? []);
  return {
    focus: snap.focus?.length ?? 0,
    tv: snap.tv?.length ?? 0,
    calls: snap.calls?.length ?? 0,
  };
}
