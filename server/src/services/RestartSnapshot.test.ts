import { CALL_REJOIN_MS } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { CallService } from './CallService.js';
import { FocusService } from './FocusService.js';
import {
  RESTART_SNAPSHOT_MAX_AGE_MS,
  restoreRestartSnapshot,
  saveRestartSnapshot,
} from './RestartSnapshot.js';
import { OfflineTvMeta, TvService } from './TvService.js';

/** Um "servidor": os serviços em memória sobre o mesmo banco, com relógio e timers falsos. */
function server(db: ReturnType<typeof openDatabase>, clock: { now: number }) {
  const pending: { fn: () => void; at: number }[] = [];
  const timers = {
    set: (fn: () => void, ms: number) => {
      const t = { fn, at: clock.now + ms };
      pending.push(t);
      return t as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (t: ReturnType<typeof setTimeout>) => {
      const i = pending.indexOf(t as unknown as (typeof pending)[number]);
      if (i >= 0) pending.splice(i, 1);
    },
  };
  const run = () => {
    for (const t of [...pending].sort((a, b) => a.at - b.at)) {
      if (t.at > clock.now || !pending.includes(t)) continue;
      pending.splice(pending.indexOf(t), 1);
      t.fn();
    }
  };
  const now = () => clock.now;
  const focus = new FocusService(now);
  const tv = new TvService(new OfflineTvMeta(), now, timers);
  const calls = new CallService(
    { isOnline: () => true, nameOf: (id) => id, figureOf: () => '', isQuiet: () => false },
    now,
    timers,
  );
  return { db, focus, tv, calls, run };
}

describe('atualização do servidor: foco, TV e chamadas voltam', () => {
  it('guarda ao desligar e volta ao subir; quem não reconecta sai da chamada', async () => {
    const db = openDatabase(':memory:');
    const clock = { now: 1_000_000 };
    const a = server(db, clock);
    a.focus.start('ana', 25, 5);
    await a.tv.add('tv-1', { userId: 'ana', name: 'Ana' }, ['dQw4w9WgXcQ', 'jNQXAC9IVRw']);
    a.tv.duration('tv-1', a.tv.state('tv-1').playing!.item.id, 600);
    a.calls.invite('ana', 'beto', '');
    const invite = [
      ...(a.calls as unknown as { invites: Map<string, unknown> }).invites.keys(),
    ][0]!;
    a.calls.answer('beto', invite, true);
    a.calls.setMedia('ana', { mic: true, cam: true, screen: false });
    saveRestartSnapshot(a, clock.now);

    // Desligado por 30 s (o deploy); o servidor novo sobe sem nada na memória.
    clock.now += 30_000;
    const b = server(db, clock);
    expect(restoreRestartSnapshot(b, clock.now)).toEqual({ focus: 1, tv: 1, calls: 1 });
    expect(b.focus.get('ana')).toMatchObject({ kind: 'focus' });
    const st = b.tv.state('tv-1');
    expect(st.playing?.item.videoId).toBe('dQw4w9WgXcQ');
    expect(st.queue.map((i) => i.videoId)).toEqual(['jNQXAC9IVRw']);
    // O vídeo seguiu passando enquanto o servidor estava desligado.
    expect(clock.now - st.playing!.startedAt).toBe(30_000);
    // Na chamada, os dois "reconectando" (câmera desligada: a aba nova começa sem ela).
    const view = b.calls.callOf('ana')!;
    expect(view.members.map((m) => [m.userId, m.away, m.cam])).toEqual([
      ['ana', true, false],
      ['beto', true, false],
    ]);
    // A Ana reconecta a tempo; o Beto não: sai, e a chamada (com uma pessoa só) acaba.
    expect(b.calls.resume('ana')).toBe(true);
    clock.now += CALL_REJOIN_MS;
    b.run();
    expect(b.calls.callOf('ana')).toBeNull();

    // O retrato vale uma vez só.
    expect(restoreRestartSnapshot(server(db, clock), clock.now)).toBeNull();
  });

  it('retrato velho (servidor parado muito tempo) não volta', () => {
    const db = openDatabase(':memory:');
    const clock = { now: 1_000_000 };
    const a = server(db, clock);
    a.focus.start('ana', 25, 5);
    saveRestartSnapshot(a, clock.now);
    clock.now += RESTART_SNAPSHOT_MAX_AGE_MS + 1;
    const b = server(db, clock);
    expect(restoreRestartSnapshot(b, clock.now)).toBeNull();
    expect(b.focus.get('ana')).toBeNull();
  });
});
