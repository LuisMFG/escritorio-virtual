import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pruneAssetCache } from './cachePrune.js';

describe('teto do cache de imagens', () => {
  it('passando do teto, os menos usados saem primeiro; abaixo dele, nada sai', () => {
    const dir = mkdtempSync(join(tmpdir(), 'esc-cache-'));
    mkdirSync(join(dir, 'ab'));
    const now = Date.now();
    const file = (name: string, kb: number, ageMin: number) => {
      const path = join(dir, name);
      writeFileSync(path, Buffer.alloc(kb * 1024));
      const t = (now - ageMin * 60_000) / 1000;
      utimesSync(path, t, t);
      return path;
    };
    const old = file('ab/velho.png', 40, 300);
    const mid = file('ab/meio.png', 40, 120);
    const fresh = file('novo.png', 40, 1);
    // 120 KB num teto de 200 KB: nada sai.
    expect(pruneAssetCache(dir, 200 * 1024, now)).toBe(0);
    // Teto de 100 KB: apaga até 80 KB, começando pelo usado há mais tempo.
    expect(pruneAssetCache(dir, 100 * 1024, now)).toBe(40 * 1024);
    expect(existsSync(old)).toBe(false);
    expect([existsSync(mid), existsSync(fresh)]).toEqual([true, true]);
  });

  it('temporários de escritas que falharam somem depois de uma hora', () => {
    const dir = mkdtempSync(join(tmpdir(), 'esc-cache-'));
    const now = Date.now();
    const tmp = join(dir, 'a.png.123.tmp');
    const recent = join(dir, 'b.png.123.tmp');
    writeFileSync(tmp, 'x');
    writeFileSync(recent, 'x');
    const t = (now - 2 * 60 * 60_000) / 1000;
    utimesSync(tmp, t, t);
    pruneAssetCache(dir, 1024 * 1024, now);
    expect(existsSync(tmp)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });
});
