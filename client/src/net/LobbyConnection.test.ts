import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('location', { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost' });
vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined });
const { LobbyConnection } = await import('./LobbyConnection.js');

afterEach(() => vi.useRealTimers());

describe('canal global (lobby)', () => {
  it('se a primeira conexão falhar, tenta de novo sozinho até conseguir', async () => {
    vi.useFakeTimers();
    const conn = new LobbyConnection('token', {} as never);
    let tries = 0;
    const connect = vi.spyOn(conn, 'connect').mockImplementation(async () => {
      if (++tries < 3) throw new Error('rede caiu');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await conn.start();
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(connect).toHaveBeenCalledTimes(3);
    // Conectou: para de tentar.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(3);
  });
});
