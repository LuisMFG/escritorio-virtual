import { KUDOS_PER_DAY } from '@office/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { giveKudos, kudosWall } from './kudos.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

let deps: TestDeps;

beforeEach(() => {
  deps = makeDeps();
});

describe('elogios', () => {
  it('elogia um colega; não a si mesmo; mural e conquistas', async () => {
    const ana = await registered(deps);
    const beto = await registered(deps, { username: 'beto', name: 'Beto' });
    const asAna = () => callerOf(deps, ana.token);
    const live: string[] = [];
    deps.kudos.events.on('given', (k) => live.push(`${k.fromName}→${k.toName}`));

    expect(
      giveKudos(asAna(), { toUserId: ana.userId, type: 'help', message: 'eu mesma' }, deps).ok,
    ).toBe(false);
    expect(
      giveKudos(asAna(), { toUserId: 'ninguem', type: 'help', message: 'oi tudo' }, deps).status,
    ).toBe(404);
    expect(giveKudos(asAna(), { toUserId: beto.userId, type: 'help', message: 'x' }, deps).ok).toBe(
      false,
    );
    const ok = giveKudos(
      asAna(),
      {
        toUserId: beto.userId,
        type: 'delivered',
        message: '  Entregou o painel   antes do prazo! ',
      },
      deps,
    );
    if (!ok.ok) throw new Error(ok.body.message);
    expect(ok.body).toMatchObject({
      type: 'delivered',
      message: 'Entregou o painel antes do prazo!',
      fromName: 'Ana',
      toName: 'Beto',
    });
    expect(live).toEqual(['Ana→Beto']);
    expect(kudosWall(asAna(), {}, deps)).toMatchObject({ body: [{ toName: 'Beto' }] });
    expect(kudosWall(asAna(), { para: ana.userId }, deps)).toMatchObject({ body: [] });

    // Mais 4: destrava as duas conquistas.
    for (let i = 0; i < 4; i++) {
      giveKudos(asAna(), { toUserId: beto.userId, type: 'idea', message: `ideia ${i}` }, deps);
    }
    expect(deps.achievements.get(ana.userId).unlocked.map((u) => u.id)).toContain('recognizer');
    expect(deps.achievements.get(beto.userId).unlocked.map((u) => u.id)).toContain('beloved');
  });

  it(`no máximo ${KUDOS_PER_DAY} por dia`, async () => {
    const ana = await registered(deps);
    const beto = await registered(deps, { username: 'beto', name: 'Beto' });
    for (let i = 0; i < KUDOS_PER_DAY; i++) {
      expect(
        giveKudos(
          callerOf(deps, ana.token),
          { toUserId: beto.userId, type: 'help', message: `valeu ${i}` },
          deps,
        ).ok,
      ).toBe(true);
    }
    expect(
      giveKudos(
        callerOf(deps, ana.token),
        { toUserId: beto.userId, type: 'help', message: 'mais um' },
        deps,
      ).status,
    ).toBe(429);
  });
});
