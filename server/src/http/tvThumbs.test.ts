import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createTvThumbRouter } from './tvThumbs.js';

/** Sobe o router numa porta livre e devolve o endereço base. */
async function serve(router: express.Router) {
  const server = express().use(router).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => server.close() };
}

describe('capas da TV', () => {
  it('busca no YouTube uma vez e depois serve do disco', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tv-thumbs-'));
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as typeof fetch;
    const s = await serve(createTvThumbRouter(dir, { fetchFn }));
    const a = await fetch(`${s.base}/api/tv/thumb/dQw4w9WgXcQ.jpg`);
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('image/jpeg');
    expect((await fetch(`${s.base}/api/tv/thumb/dQw4w9WgXcQ.jpg`)).status).toBe(200);
    expect(urls).toEqual(['https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg']);
    s.close();
  });

  it('id inválido não vira busca; sem internet (offline) dá 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tv-thumbs-'));
    const s = await serve(createTvThumbRouter(dir, { offline: true }));
    expect((await fetch(`${s.base}/api/tv/thumb/curto.jpg`)).status).toBe(400);
    expect((await fetch(`${s.base}/api/tv/thumb/dQw4w9WgXcQ.jpg`)).status).toBe(404);
    s.close();
  });
});
