import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPipSize, PIP_DEFAULT_SIZE, pipResolution } from './pipLayout.js';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

beforeEach(() => store.clear());

describe('janela flutuante', () => {
  it('desenha maior em janela pequena, para os rostos ficarem nítidos', () => {
    expect(pipResolution(300, 220, 1)).toBe(2.75);
    expect(pipResolution(420, 320, 1)).toBe(2.25);
    expect(pipResolution(480, 380, 1)).toBe(2);
    // Tela de alta densidade: acompanha a tela, até o limite de 3,5×.
    expect(pipResolution(300, 220, 2)).toBe(3.5);
  });

  it('em janela grande não passa do teto de pixels (nem abaixo da densidade da tela)', () => {
    const res = pipResolution(1000, 700, 1);
    expect(1000 * 700 * res * res).toBeLessThanOrEqual(1440 * 900 + 1);
    expect(res).toBeGreaterThanOrEqual(1);
    expect(pipResolution(1600, 1000, 1)).toBe(1);
    expect(pipResolution(1600, 1000, 2)).toBe(2);
  });

  it('abre no tamanho em que foi fechada da última vez', () => {
    expect(loadPipSize()).toEqual(PIP_DEFAULT_SIZE);
    store.set('escritorio.pip.tamanho', JSON.stringify({ width: 640, height: 420 }));
    expect(loadPipSize()).toEqual({ width: 640, height: 420 });
  });

  it('ignora tamanho salvo estragado ou absurdo', () => {
    store.set('escritorio.pip.tamanho', '{quebrado');
    expect(loadPipSize()).toEqual(PIP_DEFAULT_SIZE);
    store.set('escritorio.pip.tamanho', JSON.stringify({ width: 50, height: 9000 }));
    expect(loadPipSize()).toEqual(PIP_DEFAULT_SIZE);
  });
});
