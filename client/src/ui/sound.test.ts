import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSound } from './sound.js';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

/** Quantas vezes o som sairia de fato. */
function played(sound: ChatSound) {
  const tones = vi.spyOn(sound as unknown as { tones: () => void }, 'tones');
  return () => tones.mock.calls.length;
}

beforeEach(() => store.clear());

describe('som dos avisos', () => {
  it('começa ligado para todo mundo, inclusive quem desligou quando o padrão era desligado', () => {
    store.set('escritorio.som', '0');
    const sound = new ChatSound();
    expect(sound.enabled).toBe(true);
    const count = played(sound);
    sound.mention();
    sound.play();
    expect(count()).toBe(2);
  });

  it('o sino desliga e a escolha fica salva', () => {
    const sound = new ChatSound();
    expect(sound.toggle()).toBe(false);
    expect(new ChatSound().enabled).toBe(false);
    expect(sound.toggle()).toBe(true);
    expect(new ChatSound().enabled).toBe(true);
  });

  it('em foco ou ocupado, nenhum som de aviso (menos o fim do próprio foco)', () => {
    const sound = new ChatSound();
    let quiet = true;
    sound.quiet = () => quiet;
    const count = played(sound);
    sound.mention();
    sound.play();
    expect(count()).toBe(0);
    sound.mention(true);
    expect(count()).toBe(1);
    quiet = false;
    sound.mention();
    expect(count()).toBe(2);
  });
});
