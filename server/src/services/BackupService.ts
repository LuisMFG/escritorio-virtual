import { OFFICE_TIME_ZONE, type BackupInfo } from '@office/shared';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sqliteOf, type Db } from '../db/client.js';

/** `escritorio-2026-10-17-0300.db` (com `-2`, `-3`… se cair no mesmo minuto). */
const NAME = /^escritorio-(\d{4}-\d{2}-\d{2})-(\d{4})(?:-\d+)?\.db$/;

/** Data e hora no fuso do escritório: `{ day: '2026-10-17', hm: '0300', hour: 3 }`. */
export function officeClock(date: Date, timeZone = OFFICE_TIME_ZONE) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}${p.minute}`, hour: Number(p.hour) };
}

/**
 * Backups do SQLite com a API de backup do próprio SQLite (consistente mesmo com o servidor
 * rodando e o WAL ligado). Guarda os últimos `keep` arquivos em `dir`.
 */
export class BackupService {
  constructor(
    private readonly db: Db,
    readonly dir: string,
    readonly keep = 7,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): BackupInfo[] {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((n) => NAME.test(n));
    } catch {
      return [];
    }
    return names
      .map((name) => {
        const st = statSync(join(this.dir, name));
        return { name, size: st.size, createdAt: st.mtimeMs };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  /** Faz um backup agora e apaga os mais antigos além de `keep`. */
  async create(): Promise<BackupInfo> {
    mkdirSync(this.dir, { recursive: true });
    const { day, hm } = officeClock(this.now());
    let name = `escritorio-${day}-${hm}.db`;
    for (let i = 2; this.list().some((b) => b.name === name); i++) {
      name = `escritorio-${day}-${hm}-${i}.db`;
    }
    await sqliteOf(this.db).backup(join(this.dir, name));
    this.prune();
    return this.list().find((b) => b.name === name)!;
  }

  /** Já tem backup do dia (no fuso do escritório)? */
  hasBackupOn(day: string): boolean {
    return this.list().some((b) => NAME.exec(b.name)?.[1] === day);
  }

  /** Caminho de um backup existente (`null` para nomes inválidos ou que não existem). */
  pathOf(name: string): string | null {
    if (!NAME.test(name)) return null;
    return this.list().some((b) => b.name === name) ? join(this.dir, name) : null;
  }

  private prune(): void {
    for (const old of this.list().slice(this.keep))
      rmSync(join(this.dir, old.name), { force: true });
  }
}

/** Hora do backup diário, no fuso do escritório. */
export const BACKUP_HOUR = 3;

/**
 * Confere a cada 10 min: passou das 3h e ainda não tem backup de hoje → faz. Assim, se o
 * servidor estava desligado às 3h, o backup sai assim que ele voltar.
 */
export class BackupScheduler {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly backups: BackupService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(everyMs = 10 * 60_000): void {
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<BackupInfo | null> {
    const { day, hour } = officeClock(this.now());
    if (hour < BACKUP_HOUR || this.backups.hasBackupOn(day)) return null;
    try {
      const b = await this.backups.create();
      console.log(`[backup] ${b.name} (${Math.round(b.size / 1024)} KB)`);
      return b;
    } catch (err) {
      console.error(`[backup] falhou: ${(err as Error).message}`);
      return null;
    }
  }
}
