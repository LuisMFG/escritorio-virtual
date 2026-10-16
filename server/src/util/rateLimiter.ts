/**
 * Token bucket simples: `capacity` ações de rajada, recarregando `refillPerSecond` por segundo.
 * Uma instância por chave (cliente, IP…) via `KeyedRateLimiter`.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  tryTake(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((t - this.last) / 1000) * this.refillPerSecond,
    );
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Milissegundos até haver `cost` fichas disponíveis. */
  msUntil(cost = 1): number {
    this.tryTake(0);
    return this.tokens >= cost
      ? 0
      : Math.ceil(((cost - this.tokens) / this.refillPerSecond) * 1000);
  }
}

export class KeyedRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryTake(key: string, cost = 1): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      b = new TokenBucket(this.capacity, this.refillPerSecond, this.now);
      this.buckets.set(key, b);
    }
    return b.tryTake(cost);
  }

  delete(key: string): void {
    this.buckets.delete(key);
  }
}
