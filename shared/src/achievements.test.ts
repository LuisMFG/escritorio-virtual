import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, badgeImageUrl } from './achievements.js';

describe('emblemas do Habbo das conquistas (Fase 39)', () => {
  it('cada conquista tem um emblema próprio, com código de conquista do Habbo', () => {
    const codes = ACHIEVEMENTS.map((a) => a.badge);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^ACH_[A-Za-z]+\d+$/);
    // A medalha antiga continua como reserva sem internet.
    for (const a of ACHIEVEMENTS) expect(a.emoji).toBeTruthy();
  });

  it('imagem pelo proxy do servidor', () => {
    expect(badgeImageUrl('ACH_PetLover1')).toBe('/hh/badge/ACH_PetLover1.gif');
  });
});
