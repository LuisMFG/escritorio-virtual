import { SESSION_IDLE_MS } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { UserService } from './UserService.js';

const DAY = 24 * 60 * 60_000;

describe('sessões que vencem', () => {
  it('90 dias sem uso: a sessão deixa de valer; usar renova; a limpeza apaga as vencidas', () => {
    let now = new Date('2026-10-26T12:00:00Z');
    const users = new UserService(openDatabase(':memory:'), () => now);
    const ana = users.create('Ana', 'hd-180-1');
    const other = users.createSession(ana.user.id);
    expect(users.findByToken(ana.token)?.id).toBe(ana.user.id);

    // 80 dias depois, a Ana volta por um aparelho; o outro fica parado.
    now = new Date(now.getTime() + 80 * DAY);
    users.touchSession(ana.token);
    now = new Date(now.getTime() + 20 * DAY);
    expect(users.findByToken(ana.token)?.id).toBe(ana.user.id);
    expect(users.findByToken(other)).toBeUndefined();
    expect(SESSION_IDLE_MS).toBe(90 * DAY);

    expect(users.deleteExpiredSessions()).toBe(1);
    expect(users.findByToken(ana.token)?.id).toBe(ana.user.id);
  });
});
