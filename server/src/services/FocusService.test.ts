import { describe, expect, it } from 'vitest';
import { FocusService } from './FocusService.js';

describe('FocusService', () => {
  it('foco → pausa → fim, avisando que terminou sozinho; parar no meio', () => {
    let now = 0;
    const focus = new FocusService(() => now);
    const seen: string[] = [];
    focus.events.on('changed', (id, s, finished) =>
      seen.push(`${id}:${s?.kind ?? 'fim'}:${finished}`),
    );

    focus.start('ana', 25, 5);
    expect(focus.get('ana')).toMatchObject({ kind: 'focus', until: 25 * 60_000 });
    now = 24 * 60_000;
    focus.tick();
    expect(focus.get('ana')?.kind).toBe('focus');
    now = 25 * 60_000;
    focus.tick();
    expect(focus.get('ana')).toMatchObject({ kind: 'break', until: 30 * 60_000 });
    now = 30 * 60_000;
    focus.tick();
    expect(focus.get('ana')).toBeNull();

    focus.start('beto', 50, 0); // sem pausa: acaba direto
    now += 50 * 60_000;
    focus.tick();
    focus.start('caio', 25, 5);
    focus.stop('caio');
    focus.stop('caio'); // de novo: nada
    expect(seen).toEqual([
      'ana:focus:false',
      'ana:break:true',
      'ana:fim:true',
      'beto:focus:false',
      'beto:fim:true',
      'caio:focus:false',
      'caio:fim:false',
    ]);
  });
});
