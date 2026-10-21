import { describe, expect, it } from 'vitest';
import { STUN_ONLY, TurnService } from './TurnService.js';

const turnReply = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
  ],
};

function fakeHttp(reply: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const http = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { http, calls };
}

describe('TurnService', () => {
  it('sem chave no .env: só STUN, sem chamar a Cloudflare', async () => {
    const f = fakeHttp(turnReply);
    const svc = new TurnService(undefined, f.http);
    expect(await svc.iceServers()).toEqual(STUN_ONLY);
    expect(f.calls).toHaveLength(0);
  });

  it('com chave: gera credenciais temporárias uma vez e guarda', async () => {
    const f = fakeHttp(turnReply);
    let t = 0;
    const svc = new TurnService({ keyId: 'k1', apiToken: 'tok' }, f.http, () => t);
    const a = await svc.iceServers();
    await svc.iceServers();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toContain('/turn/keys/k1/credentials/generate-ice-servers');
    expect((f.calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(a.some((s) => s.username === 'u' && s.credential === 'c')).toBe(true);
    // Passadas 7 h, renova.
    t += 7 * 3600_000;
    await svc.iceServers();
    expect(f.calls).toHaveLength(2);
  });

  it('Cloudflare fora do ar: volta para só STUN (sem quebrar a chamada)', async () => {
    const f = fakeHttp({ error: 'x' }, 500);
    const svc = new TurnService({ keyId: 'k1', apiToken: 'tok' }, f.http);
    expect(await svc.iceServers()).toEqual(STUN_ONLY);
  });
});
