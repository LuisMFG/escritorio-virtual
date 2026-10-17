import { AUTO_AWAY_MINUTES } from '@office/shared';

/**
 * Detecta inatividade (sem mouse/teclado/toque) para o "Ausente" automático.
 * `onIdle` dispara uma vez ao passar do limite; `onActive` na primeira atividade depois disso.
 */
export class IdleWatcher {
  private timer = 0;
  private idle = false;

  constructor(
    private readonly onIdle: () => void,
    private readonly onActive: () => void,
    private readonly timeoutMs = AUTO_AWAY_MINUTES * 60_000,
  ) {
    const activity = () => this.activity();
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(ev, activity, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.activity();
    });
    this.arm();
  }

  private activity(): void {
    if (this.idle) {
      this.idle = false;
      this.onActive();
    }
    this.arm();
  }

  private arm(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.idle = true;
      this.onIdle();
    }, this.timeoutMs);
  }
}
