import type { FocusKind } from '@office/shared';
import { EventEmitter } from 'node:events';

export interface FocusState {
  kind: FocusKind;
  until: number;
  breakMinutes: number;
}

/**
 * Foco de cada pessoa (em memória): foco → pausa → fim. Fica por conta da pessoa (não da sala),
 * então acompanha quem troca de sala. `changed` avisa as salas; `finished` indica que a fase
 * terminou sozinha (para o aviso "pausa de 5 min" / "pausa acabou").
 */
export class FocusService {
  readonly events = new EventEmitter<{
    changed: [userId: string, state: FocusState | null, finished: boolean];
  }>();
  private readonly states = new Map<string, FocusState>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly now: () => number = () => Date.now()) {
    this.events.setMaxListeners(100);
  }

  get(userId: string): FocusState | null {
    return this.states.get(userId) ?? null;
  }

  start(userId: string, minutes: number, breakMinutes: number): FocusState {
    const state: FocusState = { kind: 'focus', until: this.now() + minutes * 60_000, breakMinutes };
    this.states.set(userId, state);
    this.events.emit('changed', userId, state, false);
    return state;
  }

  stop(userId: string): void {
    if (!this.states.delete(userId)) return;
    this.events.emit('changed', userId, null, false);
  }

  /** Passa de fase quem chegou no fim (chamado a cada poucos segundos). */
  tick(): void {
    const now = this.now();
    for (const [userId, s] of [...this.states]) {
      if (s.until > now) continue;
      if (s.kind === 'focus' && s.breakMinutes > 0) {
        const next: FocusState = { ...s, kind: 'break', until: now + s.breakMinutes * 60_000 };
        this.states.set(userId, next);
        this.events.emit('changed', userId, next, true);
      } else {
        this.states.delete(userId);
        this.events.emit('changed', userId, null, true);
      }
    }
  }

  startTimer(everyMs = 2000): void {
    this.timer = setInterval(() => this.tick(), everyMs);
    this.timer.unref();
  }

  stopTimer(): void {
    clearInterval(this.timer);
  }
}
