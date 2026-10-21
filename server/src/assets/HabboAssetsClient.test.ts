import { HABBOASSETS_CDN, HABBOASSETS_IMAGER } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { HabboAssetsClient, UpstreamError } from './HabboAssetsClient.js';

const SWF = Buffer.from('CWS fake swf');

describe('HabboAssetsClient', () => {
  it('renders do imager esgotados não impedem baixar as roupas (SWF vem da cota da CDN)', async () => {
    const fetchFn = (async (url: string) =>
      url.endsWith('.swf')
        ? new Response(SWF)
        : new Response(new Uint8Array([1]), {
            headers: { 'content-type': 'image/png' },
          })) as typeof fetch;
    // Cota do imager mínima: 1 render e quase nada por minuto.
    const client = new HabboAssetsClient({ fetchFn, imagerPerMinute: 1 });
    await client.fetchImage(`${HABBOASSETS_IMAGER}/avatar.png?figure=a`);
    await expect(client.fetchImage(`${HABBOASSETS_IMAGER}/avatar.png?figure=b`)).rejects.toThrow(
      UpstreamError,
    );
    // Mesmo assim as bibliotecas de roupa continuam baixando.
    for (let i = 0; i < 5; i++) {
      expect(await client.fetchSwf(`${HABBOASSETS_CDN}/clothing/lib${i}.swf`)).toEqual(SWF);
    }
  });
});
