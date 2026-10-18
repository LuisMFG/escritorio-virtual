import { beforeEach, describe, expect, it } from 'vitest';
import { myEffects, setEffect } from './effects.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

let deps: TestDeps;
beforeEach(() => {
  deps = makeDeps();
});

describe('efeitos do perfil', () => {
  it('lista liberados, usa só o que está liberado e avisa as salas', async () => {
    const ana = await registered(deps);
    const asAna = () => callerOf(deps, ana.token);
    const first = myEffects(asAna(), deps);
    expect(first.ok && first.body.current).toBeNull();
    expect(first.ok && first.body.effects.find((e) => e.id === 'twinkle')?.unlocked).toBe(true);
    expect(first.ok && first.body.effects.find((e) => e.id === 'love')?.unlocked).toBe(false);

    expect(setEffect(asAna(), { effect: 'love' }, deps).status).toBe(403);
    expect(setEffect(asAna(), { effect: 'inventado' }, deps).status).toBe(400);

    const updated: string[] = [];
    deps.users.events.on('updated', (u) => updated.push(u.effect));
    const ok = setEffect(asAna(), { effect: 'twinkle' }, deps);
    expect(ok.ok && ok.body.current).toBe('twinkle');
    expect(updated).toEqual(['twinkle']);
    expect(deps.users.publicProfile(deps.users.findById(ana.userId)!).effect).toBe('twinkle');

    // Três elogios recebidos liberam os corações.
    for (let i = 0; i < 3; i++) deps.achievements.bump(ana.userId, 'kudosReceived');
    expect(setEffect(asAna(), { effect: 'love' }, deps).ok).toBe(true);
    const off = setEffect(asAna(), { effect: null }, deps);
    expect(off.ok && off.body.current).toBeNull();
  });
});
