import { describe, expect, it } from 'vitest';
import { HeldItems } from './HeldItems.js';

describe('HeldItems', () => {
  it('devolve o item até vencer e apaga os vencidos ao consultar', () => {
    const held = new HeldItems();
    held.set('ana', 6, 1_000);
    held.set('beto', 2, 5_000);
    expect(held.get('ana', 500)).toEqual({ item: 6, until: 1_000 });
    // Venceu o da Ana: some ao consultar qualquer pessoa.
    expect(held.get('beto', 1_000)).toEqual({ item: 2, until: 5_000 });
    expect(held.size).toBe(1);
    expect(held.get('ana', 1_000)).toBeUndefined();
    held.delete('beto');
    expect(held.size).toBe(0);
  });
});
