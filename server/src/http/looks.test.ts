import { beforeEach, describe, expect, it } from 'vitest';
import { deleteLook, myLooks, saveLook } from './looks.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

let deps: TestDeps;
beforeEach(() => {
  deps = makeDeps();
});

describe('looks salvos', () => {
  it('guarda até 5, troca o do slot, valida o visual e apaga', async () => {
    const ana = await registered(deps);
    const asAna = () => callerOf(deps, ana.token);
    const fig = deps.avatarManifest.defaults.F;
    expect(myLooks(asAna(), deps).body).toEqual([]);
    expect(saveLook(asAna(), 5, { figure: fig, gender: 'F' }, deps).status).toBe(404);
    expect(saveLook(asAna(), 0, { figure: 'hd-1-1', gender: 'F' }, deps).status).toBe(400);
    saveLook(asAna(), 2, { figure: fig, gender: 'F' }, deps);
    const male = deps.avatarManifest.defaults.M;
    const res = saveLook(asAna(), 0, { figure: male, gender: 'M' }, deps);
    expect(res.ok && res.body.map((l) => [l.slot, l.gender])).toEqual([
      [0, 'M'],
      [2, 'F'],
    ]);
    saveLook(asAna(), 2, { figure: male, gender: 'M' }, deps);
    expect((myLooks(asAna(), deps).body as { gender: string }[]).map((l) => l.gender)).toEqual([
      'M',
      'M',
    ]);
    const after = deleteLook(asAna(), 0, deps);
    expect(after.ok && after.body.map((l) => l.slot)).toEqual([2]);
  });
});
