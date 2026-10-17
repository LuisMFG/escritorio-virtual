import { RECEPTION } from '@office/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { cancelMeeting, createMeeting, listMeetings, respondMeeting } from './meetings.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

let deps: TestDeps;
let ana: Awaited<ReturnType<typeof registered>>;
let beto: Awaited<ReturnType<typeof registered>>;
let caio: Awaited<ReturnType<typeof registered>>;
let events: string[];
const HOUR = 3_600_000;

beforeEach(async () => {
  deps = makeDeps();
  ana = await registered(deps); // admin
  beto = await registered(deps, { username: 'beto', name: 'Beto' });
  caio = await registered(deps, { username: 'caio', name: 'Caio' });
  events = [];
  deps.meetings.events.on('changed', () => events.push('changed'));
  deps.meetings.events.on('invited', (_m, ids) => events.push(`invited:${ids.length}`));
});

const base = () => ({
  title: '  Planejamento   da sprint ',
  roomId: 'meeting',
  startsAt: Date.now() + 2 * HOUR,
  durationMin: 60,
  attendeeIds: [] as string[],
});

describe('agenda', () => {
  it('marca reunião: quem marcou já vai, convidados ficam sem resposta e são avisados', () => {
    const res = createMeeting(
      callerOf(deps, beto.token),
      { ...base(), attendeeIds: [caio.userId] },
      deps,
    );
    if (!res.ok) throw new Error(res.body.message);
    expect(res.body).toMatchObject({
      title: 'Planejamento da sprint',
      roomName: 'Sala de reunião',
      createdByName: 'Beto',
    });
    expect(res.body.attendees.map((a) => [a.name, a.response])).toEqual([
      ['Beto', 'yes'],
      ['Caio', 'pending'],
    ]);
    expect(events).toEqual(['changed', 'invited:1']);
    const list = listMeetings({}, deps);
    expect(list.ok && list.body).toHaveLength(1);
  });

  it('recusa horário passado, sala inexistente, convidado inexistente e choque de horário', () => {
    const me = callerOf(deps, ana.token);
    expect(createMeeting(me, { ...base(), startsAt: Date.now() - HOUR }, deps)).toMatchObject({
      status: 400,
    });
    expect(createMeeting(me, { ...base(), roomId: 'nao-existe' }, deps)).toMatchObject({
      status: 404,
    });
    expect(createMeeting(me, { ...base(), attendeeIds: ['ninguem'] }, deps)).toMatchObject({
      status: 404,
    });
    expect(createMeeting(me, { ...base(), durationMin: 5 }, deps)).toMatchObject({ status: 400 });

    expect(createMeeting(me, base(), deps).ok).toBe(true);
    // Mesma sala, começando no meio da outra: choque.
    const clash = createMeeting(me, { ...base(), startsAt: base().startsAt + 30 * 60_000 }, deps);
    expect(clash).toMatchObject({
      status: 409,
      body: { message: expect.stringContaining('Planejamento') },
    });
    // Outra sala, mesmo horário: tudo bem.
    expect(createMeeting(me, { ...base(), roomId: RECEPTION.id }, deps).ok).toBe(true);
  });

  it('responder: só convidado; cancelar: quem marcou ou admin', () => {
    const created = createMeeting(
      callerOf(deps, beto.token),
      { ...base(), attendeeIds: [caio.userId] },
      deps,
    );
    if (!created.ok) throw new Error();
    const id = created.body.id;
    expect(respondMeeting(callerOf(deps, caio.token), id, { response: 'yes' }, deps)).toMatchObject(
      {
        ok: true,
      },
    );
    expect(respondMeeting(callerOf(deps, ana.token), id, { response: 'no' }, deps)).toMatchObject({
      status: 404,
    });
    expect(cancelMeeting(callerOf(deps, caio.token), id, deps)).toMatchObject({ status: 403 });
    expect(cancelMeeting(callerOf(deps, ana.token), id, deps).ok).toBe(true); // admin
    const list = listMeetings({}, deps);
    expect(list.ok && list.body).toEqual([]);
  });
});
