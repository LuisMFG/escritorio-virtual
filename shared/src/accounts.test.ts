import { describe, expect, it } from 'vitest';
import {
  birthdaySchema,
  formatBirthday,
  formatLastSeen,
  isBirthdayToday,
  monthDay,
  officeDate,
  profileUpdateSchema,
  registerSchema,
  usernameSchema,
} from './accounts.js';

describe('usuário e cadastro', () => {
  it('usuário vira minúsculo e só aceita caracteres simples', () => {
    expect(usernameSchema.parse('  Luis.M ')).toBe('luis.m');
    expect(usernameSchema.safeParse('joão').success).toBe(false);
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('com espaço').success).toBe(false);
  });

  it('cadastro exige convite, usuário, senha de 8+ e nome', () => {
    const ok = { inviteCode: 'x', username: 'ana', password: '12345678', name: 'Ana' };
    expect(registerSchema.safeParse(ok).success).toBe(true);
    expect(registerSchema.safeParse({ ...ok, password: '1234567' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, inviteCode: undefined }).success).toBe(false);
  });
});

describe('perfil', () => {
  it('aniversário MM-DD com dia existente', () => {
    expect(birthdaySchema.safeParse('02-29').success).toBe(true);
    expect(birthdaySchema.safeParse('02-30').success).toBe(false);
    expect(birthdaySchema.safeParse('04-31').success).toBe(false);
    expect(birthdaySchema.safeParse('13-01').success).toBe(false);
    expect(formatBirthday('03-05')).toBe('5 de mar');
  });

  it('bio é limpa e limitada', () => {
    expect(profileUpdateSchema.parse({ bio: '  DBA   de plantão ' }).bio).toBe('DBA de plantão');
    expect(profileUpdateSchema.safeParse({ bio: 'x'.repeat(161) }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ birthday: null }).success).toBe(true);
  });
});

describe('datas', () => {
  it('aniversário de hoje usa o fuso de Brasília', () => {
    // 02:00 UTC de 16/10 ainda é 15/10 em Brasília (UTC-3).
    const d = new Date('2026-10-16T02:00:00Z');
    expect(monthDay(d)).toBe('10-15');
    expect(isBirthdayToday('10-15', d)).toBe(true);
    expect(isBirthdayToday('10-16', d)).toBe(false);
    expect(isBirthdayToday(null, d)).toBe(false);
    // O "hoje" do escritório (corações uma vez por dia) também é o de Brasília.
    expect(officeDate(d)).toBe('2026-10-15');
  });

  it('visto por último em português', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(formatLastSeen(now - 20_000, now)).toBe('agora');
    expect(formatLastSeen(now - 5 * 60_000, now)).toBe('há 5 min');
    expect(formatLastSeen(now - 3 * 3_600_000, now)).toBe('há 3 h');
    expect(formatLastSeen(now - 30 * 3_600_000, now)).toBe('ontem');
    expect(formatLastSeen(now - 4 * 86_400_000, now)).toBe('há 4 dias');
  });
});
