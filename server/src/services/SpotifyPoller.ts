import type { ActivityService } from './ActivityService.js';
import type { PresenceRegistry } from './PresenceRegistry.js';
import {
  SpotifyRateLimitError,
  SpotifyRevokedError,
  type SpotifyService,
} from './SpotifyService.js';

/**
 * Consulta a música de quem está online e ligou o Spotify (a cada 20 s, uma pessoa por vez,
 * para ficar longe do limite da API). Quem sai do escritório deixa de ser consultado e a
 * linha 🎵 some pelo prazo da atividade.
 */
export class SpotifyPoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private pauseUntil = 0;

  constructor(
    private readonly spotify: SpotifyService,
    private readonly presence: PresenceRegistry,
    private readonly activity: ActivityService,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(everyMs = 20_000): void {
    if (!this.spotify.configured) return;
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running || this.now() < this.pauseUntil) return;
    this.running = true;
    try {
      const online = new Set(this.presence.list().map((p) => p.userId));
      for (const userId of this.spotify.activeUserIds()) {
        if (online.has(userId)) await this.refresh(userId);
      }
    } finally {
      this.running = false;
    }
  }

  /** Consulta uma pessoa já (ao ligar a conta ou mostrar a música de novo). */
  async refresh(userId: string): Promise<void> {
    try {
      this.activity.setMusic(userId, await this.spotify.nowPlaying(userId));
    } catch (err) {
      if (err instanceof SpotifyRateLimitError) {
        this.pauseUntil = this.now() + err.retryAfterSec * 1000;
        return;
      }
      if (err instanceof SpotifyRevokedError) this.activity.setMusic(userId, null);
      else console.warn(`[spotify] ${userId}: ${(err as Error).message}`);
    }
  }
}
