import { describe, expect, it } from 'vitest';
import { KeyedRateLimiter, TokenBucket } from './rateLimiter.js';

describe('TokenBucket', () => {
  it('permite a rajada e depois bloqueia até recarregar', () => {
    let now = 0;
    const b = new TokenBucket(3, 1, () => now);
    expect([b.tryTake(), b.tryTake(), b.tryTake(), b.tryTake()]).toEqual([true, true, true, false]);
    expect(b.msUntil()).toBe(1000);
    now = 1000;
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it('não passa da capacidade depois de muito tempo parado', () => {
    let now = 0;
    const b = new TokenBucket(2, 10, () => now);
    now = 60_000;
    expect([b.tryTake(), b.tryTake(), b.tryTake()]).toEqual([true, true, false]);
  });
});

describe('KeyedRateLimiter', () => {
  it('isola as chaves', () => {
    const l = new KeyedRateLimiter(1, 0.001, () => 0);
    expect(l.tryTake('a')).toBe(true);
    expect(l.tryTake('a')).toBe(false);
    expect(l.tryTake('b')).toBe(true);
  });
});
