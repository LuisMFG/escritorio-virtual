import express from 'express';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssetRouter } from './AssetProxy.js';
import type { HabboAssetsClient } from './HabboAssetsClient.js';
import { tinySwf } from './testSwf.js';

let base = '';
let downloads = 0;
let close: () => void;

beforeAll(async () => {
  const client = {
    fetchCdnImage: async (url: string) => {
      expect(url).toBe('https://cdn.habboassets.com/derived/clothing/shirt_M_suit/9/set_6462.png');
      return Buffer.from('png');
    },
    fetchSwf: async (url: string) => {
      downloads++;
      expect(url).toBe('https://cdn.habboassets.com/x/hh_test.swf');
      return tinySwf();
    },
  } as unknown as HabboAssetsClient;
  const app = express();
  app.use(
    '/hh',
    createAssetRouter(client, mkdtempSync(join(tmpdir(), 'esc-assets-')), () => ({
      libs: { hh_test: 7, shirt_M_suit: 9 },
      swf: {
        hh_test: 'https://cdn.habboassets.com/x/hh_test.swf',
        shirt_M_suit: 'https://cdn.habboassets.com/x/shirt_M_suit.swf',
      },
    })),
  );
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hh`;
  close = () => server.close();
});
afterAll(() => close());

describe('proxy das bibliotecas de roupa', () => {
  it('converte o SWF uma vez e serve a folha e os dados', async () => {
    const json = await fetch(`${base}/figure/hh_test.json?revision=7`);
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({ assets: { h_std_hr_5_2_0: { x: -11, y: 39 } } });
    const png = await fetch(`${base}/figure/hh_test.png?revision=7`);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('cache-control')).toContain('immutable');
    expect(downloads).toBe(1);
  });

  it('prévia de roupa da CDN: só biblioteca e revisão conhecidas', async () => {
    const ok = await fetch(`${base}/clothing/preview/shirt_M_suit/set_6462.png?revision=9`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    for (const path of [
      'shirt_M_suit/set_6462.png?revision=8',
      'outra/set_1.png?revision=9',
      'shirt_M_suit/set_x.png?revision=9',
    ])
      expect((await fetch(`${base}/clothing/preview/${path}`)).status, path).toBe(400);
  });

  it('só bibliotecas conhecidas, na revisão dos dados', async () => {
    for (const path of [
      'hh_outra.png?revision=7',
      'hh_test.png?revision=8',
      'hh_test.png',
      'hh_test.swf?revision=7',
      '..%2Fx.png?revision=7',
    ])
      expect((await fetch(`${base}/figure/${path}`)).status, path).toBe(400);
  });
});
