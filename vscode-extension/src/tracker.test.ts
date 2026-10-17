import { describe, expect, it } from 'vitest';
import { ActivityTracker, HEARTBEAT_MS, IDLE_MS, type Heartbeat } from './tracker.js';

function setup() {
  let now = 0;
  const sent: Heartbeat[] = [];
  const t = new ActivityTracker(
    (hb) => sent.push(hb),
    () => now,
  );
  return { t, sent, advance: (ms: number) => (now += ms) };
}

describe('ActivityTracker', () => {
  it('ativo manda na hora e depois um por minuto; mudar de linguagem manda já', () => {
    const { t, sent, advance } = setup();
    t.touch('typescript', 'portal');
    expect(sent).toEqual([{ state: 'active', language: 'typescript', project: 'portal' }]);
    advance(20_000);
    t.touch('typescript', 'portal');
    expect(sent).toHaveLength(1);
    advance(HEARTBEAT_MS);
    t.tick();
    expect(sent).toHaveLength(2);
    t.touch('sql', 'portal');
    expect(sent.at(-1)).toMatchObject({ language: 'sql' });
  });

  it('5 minutos parado manda ocioso uma vez; fechar manda closed', () => {
    const { t, sent, advance } = setup();
    t.touch('python', undefined);
    advance(IDLE_MS);
    t.tick();
    t.tick();
    expect(sent.map((s) => s.state)).toEqual(['active', 'idle']);
    t.touch('python', undefined);
    t.stop();
    t.stop();
    expect(sent.map((s) => s.state)).toEqual(['active', 'idle', 'active', 'closed']);
  });
});
