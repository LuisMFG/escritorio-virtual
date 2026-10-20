import { describe, expect, it } from 'vitest';
import { dayLight } from './ambience.js';

/** Quanto a cor escurece/tinge a sala: 0 = branco (sem efeito), 1 = preto. */
const strength = (tint: number) => {
  const [r, g, b] = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255];
  return 1 - (r + g + b) / (3 * 255);
};

describe('dayLight', () => {
  it('de dia não muda a cor da sala', () => {
    expect(dayLight(12)).toMatchObject({ darkness: 0, tint: 0xffffff });
  });

  it('entardecer e noite são sutis (a sala não fica amarelada nem escura demais)', () => {
    expect(strength(dayLight(18).tint)).toBeLessThan(0.12);
    expect(strength(dayLight(22).tint)).toBeLessThan(0.25);
    expect(dayLight(22).label).toBe('noite');
  });
});
