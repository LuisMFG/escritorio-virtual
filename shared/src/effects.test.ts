import { describe, expect, it } from 'vitest';
import { EFFECT_IDS, EFFECTS, effectUnlocked, isDropCommand, unlockHint } from './effects.js';

const progress = (achievements: number, kudosReceived = 0) => ({
  unlocked: Array.from({ length: achievements }, (_, i) => ({ id: `a${i}`, at: 0 })),
  stats: { kudosReceived },
});

describe('efeitos', () => {
  it('desbloqueio por conquistas e por elogios recebidos', () => {
    expect(effectUnlocked('twinkle', progress(0))).toBe(true);
    expect(effectUnlocked('thumbs', progress(0))).toBe(false);
    expect(effectUnlocked('thumbs', progress(0, 1))).toBe(true);
    expect(effectUnlocked('bluetwinkle', progress(2))).toBe(false);
    expect(effectUnlocked('bluetwinkle', progress(3))).toBe(true);
    expect(effectUnlocked('lightning', progress(17))).toBe(true);
    // A medalha é só das comemorações.
    expect(effectUnlocked('medal', progress(19, 50))).toBe(false);
  });

  it('dicas e catálogo', () => {
    expect(unlockHint('twinkle')).toBe('Liberado');
    expect(unlockHint('thumbs')).toBe('Receba 1 elogio');
    expect(unlockHint('love')).toBe('Receba 3 elogios');
    expect(unlockHint('halo')).toBe('Desbloqueie 11 conquistas');
    expect(unlockHint('medal')).toBe('Só nas comemorações');
    for (const id of EFFECT_IDS) expect(EFFECTS[id].lib).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('/largar', () => {
    expect(['/largar', ' /LARGAR ', '/largar já', 'largar'].map(isDropCommand)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
