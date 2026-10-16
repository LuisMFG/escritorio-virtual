import { describe, expect, it } from 'vitest';
import {
  figureSchema,
  joinOptionsSchema,
  moveSchema,
  nameKey,
  nameSchema,
  sessionRequestSchema,
} from './protocol.js';

describe('nome', () => {
  it('normaliza espaços', () => {
    expect(nameSchema.parse('  Ana   Paula ')).toBe('Ana Paula');
  });

  it('aceita acentos e recusa HTML', () => {
    expect(nameSchema.parse('João_São-Paulo')).toBe('João_São-Paulo');
    expect(nameSchema.safeParse('<b>oi</b>').success).toBe(false);
  });

  it('respeita os limites de tamanho', () => {
    expect(nameSchema.safeParse('A').success).toBe(false);
    expect(nameSchema.safeParse('A'.repeat(21)).success).toBe(false);
  });

  it('a chave ignora acentos, maiúsculas e espaços', () => {
    expect(nameKey(' JOÃO  Silva')).toBe(nameKey('joao silva'));
  });
});

describe('figure', () => {
  it('aceita figure strings bem formadas', () => {
    expect(figureSchema.safeParse('hd-180-1.ch-210-66.lg-270-82.hr-115-45-61').success).toBe(true);
  });

  it('recusa formatos estranhos', () => {
    for (const bad of ['', 'hd', 'hd-180-1.', 'HD-180-1', 'hd-180-1.ch-<script>', 'hd-1-1-1-1']) {
      expect(figureSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('payloads', () => {
  it('move exige inteiros dentro da grade', () => {
    expect(moveSchema.safeParse({ x: 3, y: 4 }).success).toBe(true);
    expect(moveSchema.safeParse({ x: 1.5, y: 4 }).success).toBe(false);
    expect(moveSchema.safeParse({ x: -1, y: 4 }).success).toBe(false);
    expect(moveSchema.safeParse({ x: '3', y: 4 }).success).toBe(false);
    expect(moveSchema.safeParse({ x: 3 }).success).toBe(false);
  });

  it('sessão: convite e token são opcionais, nome não', () => {
    expect(sessionRequestSchema.safeParse({ name: 'Ana' }).success).toBe(true);
    expect(sessionRequestSchema.safeParse({ inviteCode: 'x' }).success).toBe(false);
  });

  it('join exige sala e token', () => {
    expect(joinOptionsSchema.safeParse({ roomId: 'reception', token: 'abc' }).success).toBe(true);
    expect(joinOptionsSchema.safeParse({ roomId: 'reception' }).success).toBe(false);
  });
});
