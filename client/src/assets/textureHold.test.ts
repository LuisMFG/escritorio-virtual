import type { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { disposeTexture, dropTexture, holdTexture } from './textureHold.js';

/** Textura de mentira: só o que o registro usa. */
function fakeTexture() {
  const t = { destroyed: false, destroy: vi.fn(() => void (t.destroyed = true)) };
  return t as unknown as Texture & { destroy: ReturnType<typeof vi.fn> };
}

describe('texturas na tela (Fase 52)', () => {
  it('o cache destrói na hora a textura que ninguém mostra', () => {
    const t = fakeTexture();
    disposeTexture(t);
    expect(t.destroy).toHaveBeenCalledTimes(1);
    // Já destruída: descartar de novo não destrói duas vezes.
    disposeTexture(t);
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it('textura na tela só é destruída quando o avatar larga dela', () => {
    const t = fakeTexture();
    holdTexture(t);
    disposeTexture(t);
    expect(t.destroy).not.toHaveBeenCalled();
    dropTexture(t);
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it('a mesma pose em dois avatares espera os dois largarem', () => {
    const t = fakeTexture();
    holdTexture(t);
    holdTexture(t);
    disposeTexture(t);
    dropTexture(t);
    expect(t.destroy).not.toHaveBeenCalled();
    dropTexture(t);
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it('largar sem o cache ter descartado não destrói (a pose continua guardada)', () => {
    const t = fakeTexture();
    holdTexture(t);
    dropTexture(t);
    expect(t.destroy).not.toHaveBeenCalled();
    // Mais tarde o cache descarta: ninguém mostra, então destrói.
    disposeTexture(t);
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });
});
