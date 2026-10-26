import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, HASHED_ASSET } from './app.js';

const connect = (csp: string) => csp.split('; ').find((d) => d.startsWith('connect-src'));

describe('política de conteúdo: servidor de mídia das chamadas', () => {
  it('num caminho deste site, só a própria origem', () => {
    expect(connect(contentSecurityPolicy('/livekit'))).toBe("connect-src 'self'");
    expect(connect(contentSecurityPolicy())).toBe("connect-src 'self'");
  });

  it('em outro endereço, libera o WebSocket e a checagem por HTTP dele', () => {
    expect(connect(contentSecurityPolicy('ws://localhost:7880'))).toBe(
      "connect-src 'self' ws://localhost:7880 http://localhost:7880",
    );
    expect(connect(contentSecurityPolicy('wss://midia.exemplo.com.br/rtc'))).toBe(
      "connect-src 'self' wss://midia.exemplo.com.br https://midia.exemplo.com.br",
    );
  });
});

describe('cache dos arquivos do site', () => {
  it('só o código com hash no nome fica guardado de vez', () => {
    expect(HASHED_ASSET.test('/app/client/dist/assets/index-sIMA6Gra.js')).toBe(true);
    expect(HASHED_ASSET.test('/app/client/dist/assets/livekit-client.esm-gUMSztzH.js')).toBe(true);
    expect(HASHED_ASSET.test('/app/client/dist/assets/index-C_N4gtlZ.css')).toBe(true);
    // Catálogos e imagens não têm hash: mudam com o mesmo nome.
    expect(HASHED_ASSET.test('/app/client/dist/assets/avatar/manifest.json')).toBe(false);
    expect(HASHED_ASSET.test('/app/client/dist/assets/furni/chair-norja.png')).toBe(false);
    expect(HASHED_ASSET.test('/app/client/dist/index.html')).toBe(false);
  });
});
