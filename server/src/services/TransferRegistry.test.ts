import { describe, expect, it } from 'vitest';
import { TransferRegistry } from './TransferRegistry.js';

const target = { userId: 'u1', roomId: 'meeting', x: 1, y: 3, dir: 2 };

describe('TransferRegistry', () => {
  it('ticket vale uma única vez', () => {
    const reg = new TransferRegistry();
    const t = reg.issue(target);
    expect(reg.consume(t, 'u1', 'meeting')).toEqual(target);
    expect(reg.consume(t, 'u1', 'meeting')).toBeUndefined();
  });

  it('recusa outra pessoa, outra sala ou ticket vencido (e o ticket se perde)', () => {
    let now = 0;
    const reg = new TransferRegistry(() => now);
    expect(reg.consume(reg.issue(target), 'u2', 'meeting')).toBeUndefined();
    expect(reg.consume(reg.issue(target), 'u1', 'pantry')).toBeUndefined();
    const t = reg.issue(target);
    now = 31_000;
    expect(reg.consume(t, 'u1', 'meeting')).toBeUndefined();
    expect(reg.consume(undefined, 'u1', 'meeting')).toBeUndefined();
  });
});
