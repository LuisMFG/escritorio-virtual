import { randomBytes } from 'node:crypto';

export interface TransferTarget {
  userId: string;
  roomId: string;
  x: number;
  y: number;
  dir: number;
}

/** Validade do ticket: tempo de sair de uma sala e entrar na outra. */
const TTL_MS = 30_000;

/**
 * Tickets de uso único emitidos ao passar por uma porta. Dizem em que sala e tile a pessoa
 * deve nascer; sem ticket válido ela entra no ponto de entrada padrão da sala.
 */
export class TransferRegistry {
  private readonly tickets = new Map<string, TransferTarget & { expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(target: TransferTarget): string {
    this.sweep();
    const ticket = randomBytes(16).toString('base64url');
    this.tickets.set(ticket, { ...target, expiresAt: this.now() + TTL_MS });
    return ticket;
  }

  /** Consome o ticket se for da mesma pessoa, para a mesma sala e ainda válido. */
  consume(ticket: string | undefined, userId: string, roomId: string): TransferTarget | undefined {
    if (!ticket) return undefined;
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (
      !entry ||
      entry.expiresAt < this.now() ||
      entry.userId !== userId ||
      entry.roomId !== roomId
    ) {
      return undefined;
    }
    return { userId: entry.userId, roomId: entry.roomId, x: entry.x, y: entry.y, dir: entry.dir };
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.tickets) if (v.expiresAt < t) this.tickets.delete(k);
  }
}
