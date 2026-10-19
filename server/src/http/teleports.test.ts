import type { FurniManifestEntry } from '@office/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { linkTeleport, listTeleports } from './teleports.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

let deps: TestDeps;
beforeEach(() => {
  deps = makeDeps();
  const defs = deps.furniDefs as Map<string, FurniManifestEntry>;
  const base = defs.get('plant_yukka')!;
  defs.set('tele_t', { ...base, id: 'tele_t', name: 'Teleporte', interaction: 'teleport' });
});

describe('teleportes (Fase 37)', () => {
  it('lista os de todas as salas e liga/desliga dos dois lados; sala travada só admin', async () => {
    const admin = await registered(deps);
    const beto = await registered(deps, { username: 'beto', name: 'Beto' });
    const rooms = deps.rooms.list();
    const [r1, r2] = [rooms[0]!.id, rooms[1]!.id];
    const a = deps.furni.add(r1, { defId: 'tele_t', x: 3, y: 3, z: 0, rot: 0 }, admin.userId);
    const b = deps.furni.add(r2, { defId: 'tele_t', x: 2, y: 2, z: 0, rot: 0 }, admin.userId);
    const c = deps.furni.add(r2, { defId: 'tele_t', x: 4, y: 2, z: 0, rot: 0 }, admin.userId);
    deps.furni.add(r1, { defId: 'plant_yukka', x: 5, y: 5, z: 0, rot: 0 }, admin.userId);

    const list = listTeleports(deps);
    expect(list.ok && list.body.map((t) => t.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const asBeto = callerOf(deps, beto.token);
    const res = linkTeleport(asBeto, a.id, { targetId: b.id }, deps);
    expect(res.ok && res.body.find((t) => t.id === b.id)?.linkedTo).toBe(a.id);
    expect(res.ok && res.body.find((t) => t.id === a.id)?.roomName).toBe(rooms[0]!.name);

    // Religar a com c desfaz a–b.
    linkTeleport(asBeto, a.id, { targetId: c.id }, deps);
    expect(deps.furni.linkedTo(b.id)).toBeNull();
    expect(deps.furni.linkedTo(c.id)).toBe(a.id);

    expect(linkTeleport(asBeto, a.id, { targetId: a.id }, deps).status).toBe(404);
    expect(linkTeleport(asBeto, 'nada', { targetId: c.id }, deps).status).toBe(404);

    deps.rooms.setDecorLocked(r2, true);
    expect(linkTeleport(asBeto, a.id, { targetId: null }, deps).status).toBe(403);
    expect(linkTeleport(callerOf(deps, admin.token), a.id, { targetId: null }, deps).ok).toBe(true);
    expect(deps.furni.linkedTo(c.id)).toBeNull();

    // Remover um teleporte desfaz a ligação.
    deps.furni.link(a.id, b.id);
    deps.furni.remove(r2, b.id);
    expect(deps.furni.linkedTo(a.id)).toBeNull();
  });
});
