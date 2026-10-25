import { EventEmitter } from 'node:events';
import { nameKey, NAME_MAX } from '@office/shared';

/** Por quanto tempo uma aba substituída fica sem poder voltar sozinha (recarregar sempre pode). */
const REPLACED_TTL_MS = 12 * 3600_000;
const REPLACED_MAX = 5000;

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
  /** Abas que saíram porque a conta entrou por outra (`userId:aba` → quando). */
  private readonly replaced = new Map<string, number>();
  /**
   * `changed`: alguém entrou, saiu, trocou de sala, de nome ou de status (o lobby repassa).
   * `claimed`: a pessoa entrou por esta aba; as conexões das outras abas dela saem.
   */
  readonly events = new EventEmitter<{ changed: []; claimed: [userId: string, tab: string] }>();

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

  /**
   * Uma pessoa, uma aba: entrou por `tab`, então as outras abas dela saem (cada sala e o canal
   * global tiram as suas conexões e chamam `markReplaced`). Recusada se `tab` já foi substituída
   * (a aba antiga tentando voltar sozinha não tira a nova).
   */
  claim(userId: string, tab: string): boolean {
    if (this.wasReplaced(userId, tab)) return false;
    this.events.emit('claimed', userId, tab);
    return true;
  }

  markReplaced(userId: string, tab: string, now = Date.now()): void {
    this.replaced.set(`${userId}:${tab}`, now);
    if (this.replaced.size > REPLACED_MAX) {
      for (const [key, at] of this.replaced) {
        if (now - at > REPLACED_TTL_MS || this.replaced.size > REPLACED_MAX) {
          this.replaced.delete(key);
        }
      }
    }
  }

  wasReplaced(userId: string, tab: string, now = Date.now()): boolean {
    const at = this.replaced.get(`${userId}:${tab}`);
    return at !== undefined && now - at <= REPLACED_TTL_MS;
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
