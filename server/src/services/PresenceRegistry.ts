import { EventEmitter } from 'node:events';
import { nameKey, NAME_MAX } from '@office/shared';

export interface OnlineEntry {
  sessionId: string;
  userId: string;
  name: string;
  roomId: string;
  /** 'available' | 'busy' | 'away' (padrão: disponível). */
  status?: string;
}

/**
 * Quem está online agora, em qualquer sala (memória do processo).
 * Usado para recusar nomes em uso e, na Fase 5, para a lista de pessoas por sala.
 */
export class PresenceRegistry {
  private readonly bySession = new Map<string, OnlineEntry>();
  /** `changed`: alguém entrou, saiu, trocou de sala, de nome ou de status (o lobby repassa). */
  readonly events = new EventEmitter<{ changed: [] }>();

  constructor() {
    this.events.setMaxListeners(100);
  }

  add(entry: OnlineEntry): void {
    this.bySession.set(entry.sessionId, entry);
    this.events.emit('changed');
  }

  remove(sessionId: string): void {
    if (this.bySession.delete(sessionId)) this.events.emit('changed');
  }

  /** A pessoa mudou o nome exibido: vale para todas as conexões dela. */
  rename(userId: string, name: string): void {
    for (const e of this.bySession.values()) if (e.userId === userId) e.name = name;
    this.events.emit('changed');
  }

  setStatus(sessionId: string, status: string): void {
    const e = this.bySession.get(sessionId);
    if (!e || e.status === status) return;
    e.status = status;
    this.events.emit('changed');
  }

  list(): OnlineEntry[] {
    return [...this.bySession.values()];
  }

  /** Alguém online (que não seja o próprio usuário) já usa esse nome? */
  isNameTaken(name: string, exceptUserId?: string): boolean {
    const key = nameKey(name);
    return this.list().some((e) => e.userId !== exceptUserId && nameKey(e.name) === key);
  }

  /** Primeiro nome livre do tipo "Ana 2", "Ana 3"… respeitando o tamanho máximo. */
  suggestName(name: string, exceptUserId?: string): string {
    for (let n = 2; n < 100; n++) {
      const suffix = ` ${n}`;
      const candidate = name.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
      if (!this.isNameTaken(candidate, exceptUserId)) return candidate;
    }
    return name;
  }
}
