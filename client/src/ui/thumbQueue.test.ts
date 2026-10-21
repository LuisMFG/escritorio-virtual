import { describe, expect, it } from 'vitest';
import { ThumbQueue } from './thumbQueue.js';

/** Imagem de mentira: só guarda o `src` (nunca termina de carregar sozinha). */
function fakeImg() {
  const listeners: (() => void)[] = [];
  return {
    src: '',
    onerror: null as (() => void) | null,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    finish: () => listeners.splice(0).forEach((fn) => fn()),
  };
}

describe('ThumbQueue', () => {
  it('carrega poucas de cada vez e a próxima começa quando uma termina', () => {
    const q = new ThumbQueue(2);
    const imgs = [fakeImg(), fakeImg(), fakeImg()];
    for (const img of imgs) q.load(img as unknown as HTMLImageElement, ['a.png'], () => {});
    expect(imgs.map((i) => i.src)).toEqual(['a.png', 'a.png', '']);
    imgs[0]!.finish();
    expect(imgs[2]!.src).toBe('a.png');
  });

  it('trocar de lista libera a fila mesmo com imagens antigas que nunca terminam', () => {
    const q = new ThumbQueue(2);
    // Lista antiga: duas imagens que saíram da tela e nunca vão terminar (loading=lazy).
    for (let i = 0; i < 2; i++)
      q.load(fakeImg() as unknown as HTMLImageElement, ['x.png'], () => {});
    q.clear();
    const fresh = [fakeImg(), fakeImg()];
    for (const img of fresh) q.load(img as unknown as HTMLImageElement, ['b.png'], () => {});
    expect(fresh.map((i) => i.src)).toEqual(['b.png', 'b.png']);
  });
});
