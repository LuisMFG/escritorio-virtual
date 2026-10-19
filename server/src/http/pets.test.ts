import { beforeEach, describe, expect, it } from 'vitest';
import { getMyPet, releaseMyPet, saveMyPet } from './pets.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

let deps: TestDeps;

beforeEach(() => {
  deps = makeDeps();
});

describe('pets', () => {
  it('adota, edita e solta; as salas são avisadas', async () => {
    const ana = await registered(deps);
    const caller = callerOf(deps, ana.token);
    const seen: unknown[] = [];
    deps.pets.events.on('changed', (_id, pet) => seen.push(pet));

    expect(getMyPet(caller, deps)).toMatchObject({ body: { pet: null } });
    const bad = saveMyPet(caller, { name: 'R', species: 'dog', color: 0 }, deps);
    expect(bad.ok).toBe(false);
    expect(saveMyPet(caller, { name: '  Rex ', species: 'dog', color: 1 }, deps)).toMatchObject({
      ok: true,
      body: { name: 'Rex', species: 'dog', color: 1 },
    });
    saveMyPet(caller, { name: 'Mimi', species: 'cat', color: 2 }, deps);
    expect(getMyPet(caller, deps)).toMatchObject({
      body: { pet: { name: 'Mimi', species: 'cat', color: 2 } },
    });
    expect(saveMyPet(caller, { name: 'Zé', species: 'dragon', color: 0 }, deps).ok).toBe(false);
    // Pets do Habbo (Fase 38): tipo conhecido, paleta e cor; pelagem antiga continua 0–2.
    expect(
      saveMyPet(caller, { name: 'Rex', species: 'hh:dog', color: 7, tint: 'C98A4B' }, deps),
    ).toMatchObject({ ok: true, body: { species: 'hh:dog', color: 7, tint: 'c98a4b' } });
    expect(getMyPet(caller, deps)).toMatchObject({ body: { pet: { tint: 'c98a4b' } } });
    expect(saveMyPet(caller, { name: 'Rex', species: 'hh:unicornio', color: 0 }, deps).ok).toBe(
      false,
    );
    expect(
      saveMyPet(caller, { name: 'Rex', species: 'hh:dog', color: 0, tint: 'zz' }, deps).ok,
    ).toBe(false);
    expect(saveMyPet(caller, { name: 'Mimi', species: 'cat', color: 5 }, deps).ok).toBe(false);
    releaseMyPet(caller, deps);
    expect(getMyPet(caller, deps)).toMatchObject({ body: { pet: null } });
    expect(seen).toHaveLength(4);
    expect(seen.at(-1)).toBeNull();
  });
});
