import { describe, expect, it, vi } from 'vitest';
import { openDatabase, sqliteOf } from '../db/client.js';
import { AchievementService, officeDay } from './AchievementService.js';
import { createServices } from './index.js';

function setup(start = new Date('2026-10-12T15:00:00Z')) {
  const svc = createServices(openDatabase(':memory:'));
  let now = start;
  const ach = new AchievementService(svc.db, svc.users, () => now);
  const user = svc.users.create('Ana', 'hd-180-1.ch-210-66.lg-270-82').user;
  const unlocked: string[] = [];
  ach.events.on('unlocked', (_id, def) => unlocked.push(def.id));
  return { svc, ach, user, unlocked, setNow: (d: Date) => (now = d) };
}

describe('AchievementService', () => {
  it('contadores desbloqueiam na meta, uma vez só', () => {
    const { ach, user, unlocked } = setup();
    ach.bump(user.id, 'chat');
    expect(unlocked).toEqual(['first_message']);
    for (let i = 0; i < 98; i++) ach.bump(user.id, 'chat');
    expect(unlocked).toEqual(['first_message']);
    expect(ach.bump(user.id, 'chat')).toBe(100);
    expect(unlocked).toEqual(['first_message', 'chatter']);
    expect(ach.unlock(user.id, 'chatter')).toBe(false);
    expect(ach.unlock(user.id, 'nao-existe')).toBe(false);
    expect(ach.get(user.id).stats.chat).toBe(100);
  });

  it('conquista já conhecida não volta ao banco (várias são pedidas a cada ação)', () => {
    const { svc, ach, user, unlocked } = setup();
    const prepare = vi.spyOn(sqliteOf(svc.db), 'prepare');
    expect(ach.unlock(user.id, 'artist')).toBe(true);
    const calls = prepare.mock.calls.length;
    for (let i = 0; i < 50; i++) expect(ach.unlock(user.id, 'artist')).toBe(false);
    expect(prepare.mock.calls.length).toBe(calls);
    expect(unlocked).toEqual(['artist']);
    const rows = sqliteOf(svc.db)
      .prepare('select count(*) as n from user_achievements where user_id = ?')
      .get(user.id) as { n: number };
    expect(rows.n).toBe(1);
  });

  it('dias seguidos no fuso do escritório; pular um dia recomeça', () => {
    const { ach, user, unlocked, setNow } = setup();
    const day = (d: number) => new Date(Date.UTC(2026, 9, 12 + d, 15));
    for (let d = 0; d < 6; d++) {
      setNow(day(d));
      ach.touchDay(user.id);
      ach.touchDay(user.id); // mesmo dia não conta duas vezes
    }
    expect(ach.get(user.id).stats.streak).toBe(6);
    setNow(day(7)); // pulou o dia 6
    ach.touchDay(user.id);
    expect(ach.get(user.id).stats.streak).toBe(1);
    for (let d = 8; d <= 13; d++) {
      setNow(day(d));
      ach.touchDay(user.id);
    }
    expect(unlocked).toContain('streak');
    // 23h em Brasília ainda é "hoje", mesmo já sendo amanhã em UTC.
    expect(officeDay(new Date('2026-10-13T01:30:00Z'))).toBe(
      officeDay(new Date('2026-10-12T15:00:00Z')),
    );
  });

  it('Explorador ao visitar todas as salas; emblemas só das conquistas que tem', () => {
    const { svc, ach, user, unlocked } = setup();
    const ids = svc.rooms.list().map((r) => r.id);
    for (const id of ids.slice(0, -1)) ach.visit(user.id, id);
    expect(unlocked).not.toContain('explorer');
    ach.visit(user.id, ids.at(-1)!);
    expect(unlocked).toContain('explorer');

    expect(ach.setShowcase(user.id, ['explorer', 'ttt_master'])).toBeNull();
    expect(ach.setShowcase(user.id, ['explorer'])).toEqual(['explorer']);
    expect(svc.users.publicProfile(svc.users.findById(user.id)!).badges).toBe('explorer');
  });
});
