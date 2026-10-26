import { describe, expect, it, vi } from 'vitest';
import { dbHealthy, openDatabase, sqliteOf } from '../db/client.js';
import { guarded } from './guard.js';

describe('servidor resistente a erros', () => {
  it('erro (ou promessa rejeitada) num cronômetro vira log, sem derrubar nada', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let ran = 0;
    guarded('teste', () => {
      ran++;
      throw new Error('quebrou');
    })();
    guarded('teste', async () => {
      ran++;
      throw new Error('rejeitou');
    })();
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toBe(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0]![0])).toContain('[teste]');
    log.mockRestore();
  });

  it('healthz: o banco responde; fechado, não', () => {
    const db = openDatabase(':memory:');
    expect(dbHealthy(db)).toBe(true);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sqliteOf(db).close();
    expect(dbHealthy(db)).toBe(false);
    log.mockRestore();
  });
});
