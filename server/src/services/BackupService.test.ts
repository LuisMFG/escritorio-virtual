import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { BackupScheduler, BackupService, officeClock } from './BackupService.js';
import { createServices } from './index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(start: string, keep = 7) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-teste-'));
  dirs.push(dir);
  const svc = createServices(openDatabase(':memory:'));
  svc.users.create('Ana', 'hd-180-1.ch-210-66.lg-270-82');
  let now = new Date(start);
  const backups = new BackupService(svc.db, dir, keep, () => now);
  return { backups, dir, set: (iso: string) => (now = new Date(iso)) };
}

describe('BackupService', () => {
  it('o arquivo é um banco válido com os dados', async () => {
    const { backups, dir } = setup('2026-10-17T06:00:00Z'); // 03:00 em Brasília
    const b = await backups.create();
    expect(b.name).toBe('escritorio-2026-10-17-0300.db');
    const copy = new Database(join(dir, b.name), { readonly: true });
    expect(copy.prepare('select name from users').all()).toEqual([{ name: 'Ana' }]);
    copy.close();
  });

  it('mesmo minuto ganha sufixo; guarda só os últimos N', async () => {
    const { backups, set } = setup('2026-10-10T06:00:00Z', 3);
    await backups.create();
    expect((await backups.create()).name).toBe('escritorio-2026-10-10-0300-2.db');
    for (const d of [11, 12, 13]) {
      set(`2026-10-${d}T06:00:00Z`);
      await backups.create();
    }
    expect(backups.list().map((b) => b.name)).toEqual([
      'escritorio-2026-10-13-0300.db',
      'escritorio-2026-10-12-0300.db',
      'escritorio-2026-10-11-0300.db',
    ]);
  });

  it('só entrega arquivos de backup que existem', async () => {
    const { backups } = setup('2026-10-17T06:00:00Z');
    const b = await backups.create();
    expect(backups.pathOf(b.name)).toContain(b.name);
    expect(backups.pathOf('../sqlite.db')).toBeNull();
    expect(backups.pathOf('escritorio-2020-01-01-0000.db')).toBeNull();
  });

  it('agendador: só depois das 3h e um por dia (no fuso do escritório)', async () => {
    const { backups, set } = setup('2026-10-17T05:30:00Z'); // 02:30 em Brasília
    let now = new Date('2026-10-17T05:30:00Z');
    const scheduler = new BackupScheduler(backups, () => now);
    expect(await scheduler.tick()).toBeNull();
    now = new Date('2026-10-17T06:10:00Z');
    set('2026-10-17T06:10:00Z');
    expect((await scheduler.tick())?.name).toBe('escritorio-2026-10-17-0310.db');
    now = new Date('2026-10-17T20:00:00Z');
    expect(await scheduler.tick()).toBeNull();
    expect(officeClock(new Date('2026-10-18T02:30:00Z')).day).toBe('2026-10-17'); // 23:30 ainda é dia 17
  });
});
