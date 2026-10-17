import { parseHeightmap, RECEPTION, type RoomEdit } from '@office/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { updateUser } from './admin.js';
import { createRoom, deleteRoom, getRoom, listRooms, updateRoom, type RoomDeps } from './rooms.js';
import { callerOf, makeDeps, registered } from './testDeps.js';

let deps: RoomDeps;
let admin: Awaited<ReturnType<typeof registered>>;
let beto: Awaited<ReturnType<typeof registered>>;
const asAdmin = () => callerOf(deps, admin.token);
const asBeto = () => callerOf(deps, beto.token);
let events: string[];

beforeEach(async () => {
  deps = makeDeps();
  admin = await registered(deps);
  beto = await registered(deps, { username: 'beto', name: 'Beto' });
  events = [];
  deps.moderation.on('layout', (e) => events.push(`layout:${e.roomId}`));
  deps.moderation.on('rooms', () => events.push('rooms'));
});

function newRoom(name = 'Sala do TI'): string {
  const res = createRoom(asAdmin(), { name }, deps);
  if (!res.ok) throw new Error(res.body.message);
  return res.body.id;
}

function edit(id: string): RoomEdit {
  const res = getRoom(asAdmin(), id, deps);
  if (!res.ok) throw new Error(res.body.message);
  const { name, heightmap, spawn, floorColor, wallColor, ambient, doors } = res.body;
  return { name, heightmap, spawn, floorColor, wallColor, ambient, doors };
}

describe('salas', () => {
  it('só admin ou quem foi liberado edita salas', () => {
    expect(createRoom(asBeto(), { name: 'Minha sala' }, deps)).toMatchObject({ status: 403 });
    updateUser(asAdmin(), beto.userId, { canEditRooms: true }, deps);
    expect(createRoom(asBeto(), { name: 'Minha sala' }, deps).ok).toBe(true);
  });

  it('sala nova tem porta para a Recepção e a Recepção ganha a porta de volta', () => {
    const before = deps.rooms.getLayout(RECEPTION.id)!.doors.length;
    const id = newRoom();
    expect(id).toMatch(/^sala-do-ti-[0-9a-f]{4}$/);
    const list = listRooms(deps);
    expect(list.ok && (list.body as { id: string; name: string }[]).at(-1)).toEqual({
      id,
      name: 'Sala do TI',
    });

    const reception = deps.rooms.getLayout(RECEPTION.id)!;
    expect(reception.doors).toHaveLength(before + 1);
    const back = reception.doors.find((d) => d.targetRoomId === id)!;
    const mine = deps.rooms.getLayout(id)!;
    // Passar pela porta da Recepção leva para logo dentro da porta da sala nova, e vice-versa.
    expect({ x: back.targetX, y: back.targetY }).toEqual({
      x: mine.doors[0]!.x + 1,
      y: mine.doors[0]!.y,
    });
    expect(mine.doors[0]).toMatchObject({ targetRoomId: RECEPTION.id, targetName: 'Recepção' });
    expect(parseHeightmap(reception.heightmap).heights[back.y]![back.x]).toBe(0);
    expect(events).toEqual([`layout:${id}`, `layout:${RECEPTION.id}`, 'rooms']);
  });

  it('editar: formato em L, cores e nome; móvel que não cabe sai', () => {
    const id = newRoom();
    deps.furni.add(id, { defId: 'plant_yukka', x: 8, y: 6, z: 0, rot: 0 }, admin.userId);
    const data = edit(id);
    // Tira a última coluna das três últimas linhas (onde estava a planta).
    const heightmap = data.heightmap.map((row, y) => (y >= 4 ? row.slice(0, -1) + 'x' : row));
    const res = updateRoom(
      asAdmin(),
      id,
      { ...data, name: 'TI', heightmap, floorColor: '#112233' },
      deps,
    );
    expect(res).toMatchObject({ ok: true, body: { removedFurni: 1 } });
    expect(deps.rooms.getLayout(id)).toMatchObject({ name: 'TI', floorColor: '#112233' });
    expect(deps.furni.list(id)).toEqual([]);
  });

  it('edição inválida é recusada com a mensagem da validação', () => {
    const id = newRoom();
    const data = edit(id);
    expect(updateRoom(asAdmin(), id, { ...data, spawn: { x: 0, y: 0 } }, deps)).toMatchObject({
      status: 400,
      body: { message: 'A entrada precisa ficar no piso.' },
    });
  });

  it('porta para outra sala cria a porta de volta lá', () => {
    const ti = newRoom('TI');
    const data = edit(ti);
    const res = updateRoom(
      asAdmin(),
      ti,
      {
        ...data,
        doors: [...data.doors, { x: 3, y: 0, targetRoomId: 'pantry' }],
        heightmap: data.heightmap.map((r, y) => (y === 0 ? 'xxx0xxxxx' : r)),
      },
      deps,
    );
    expect(res.ok).toBe(true);
    expect(deps.rooms.getLayout('pantry')!.doors.some((d) => d.targetRoomId === ti)).toBe(true);
    expect(events).toContain('layout:pantry');
  });

  it('excluir: não a Recepção, não com gente dentro; portas que levavam até ela somem', () => {
    expect(deleteRoom(asAdmin(), RECEPTION.id, deps)).toMatchObject({ status: 409 });
    const id = newRoom();
    deps.presence.add({ sessionId: 's', userId: beto.userId, name: 'Beto', roomId: id });
    expect(deleteRoom(asAdmin(), id, deps)).toMatchObject({ status: 409 });
    deps.presence.remove('s');
    expect(deleteRoom(asAdmin(), id, deps).ok).toBe(true);
    expect(deps.rooms.exists(id)).toBe(false);
    expect(deps.rooms.getLayout(RECEPTION.id)!.doors.some((d) => d.targetRoomId === id)).toBe(
      false,
    );
    expect(events).toContain(`layout:${RECEPTION.id}`);
  });
});
