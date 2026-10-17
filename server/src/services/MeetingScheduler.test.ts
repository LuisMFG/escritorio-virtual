import type { DirectMessage, Meeting } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { DmService } from './DmService.js';
import { MeetingScheduler } from './MeetingScheduler.js';
import { MeetingService } from './MeetingService.js';
import { UserService } from './UserService.js';

const FIG = 'hd-180-1.ch-210-66.lg-270-82';

function setup() {
  const db = openDatabase(':memory:');
  let now = Date.parse('2026-10-19T14:00:00Z');
  const clock = () => new Date(now);
  const users = new UserService(db);
  const meetings = new MeetingService(db, clock);
  const dms = new DmService(db, clock);
  const ana = users.create('Ana', FIG).user.id;
  const beto = users.create('Beto', FIG).user.id;
  const caio = users.create('Caio', FIG).user.id;
  return {
    meetings,
    dms,
    ana,
    beto,
    caio,
    scheduler: new MeetingScheduler(meetings, dms),
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}

describe('MeetingScheduler', () => {
  it('lembra 5 min antes, uma vez só, com DM para quem não recusou', () => {
    const t = setup();
    const m = t.meetings.create({
      title: 'Daily',
      description: '',
      roomId: 'meeting',
      startsAt: t.now() + 20 * 60_000,
      durationMin: 15,
      createdBy: t.ana,
      attendeeIds: [t.beto, t.caio],
    });
    t.meetings.respond(m.id, t.caio, 'no');
    const reminders: Meeting[] = [];
    const dms: DirectMessage[] = [];
    t.meetings.events.on('reminder', (x) => reminders.push(x));
    t.meetings.events.on('dm', (x) => dms.push(x));

    t.scheduler.tick(); // faltam 20 min: nada
    expect(reminders).toEqual([]);
    t.advance(16 * 60_000); // faltam 4 min
    t.scheduler.tick();
    t.scheduler.tick(); // de novo: não repete
    expect(reminders.map((r) => r.title)).toEqual(['Daily']);
    expect(dms.map((d) => [d.fromUserId, d.toUserId])).toEqual([[t.ana, t.beto]]);
    expect(dms[0]!.text).toContain('Daily');
  });

  it('placa da sala: título só durante a reunião', () => {
    const t = setup();
    t.meetings.create({
      title: 'Retro',
      description: '',
      roomId: 'meeting',
      startsAt: t.now() + 10 * 60_000,
      durationMin: 30,
      createdBy: t.ana,
      attendeeIds: [],
    });
    expect(t.meetings.currentByRoom().get('meeting')).toBeUndefined();
    t.advance(15 * 60_000);
    expect(t.meetings.currentByRoom().get('meeting')).toBe('Retro');
    t.advance(30 * 60_000);
    expect(t.meetings.currentByRoom().get('meeting')).toBeUndefined();
  });
});
