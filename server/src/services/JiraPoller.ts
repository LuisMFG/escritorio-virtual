import { JIRA_POLL_MS, jiraText, type JiraBoard, type JiraIssue } from '@office/shared';
import type { ActivityService } from './ActivityService.js';
import { JiraAuthError, type JiraService } from './JiraService.js';
import type { UserService } from './UserService.js';
import { guarded } from '../util/guard.js';

/**
 * Consulta o Jira de quem conectou (a cada minuto, uma pessoa por vez): guarda as demandas para
 * o Quadro de Demandas e põe a que está em andamento no cartão ("📋 PROJ-123 · título").
 */
export class JiraPoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly cache = new Map<string, JiraIssue[]>();
  private updatedAt: number | null = null;

  constructor(
    private readonly jira: JiraService,
    private readonly activity: ActivityService,
    private readonly users: UserService,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(everyMs = JIRA_POLL_MS): void {
    void this.tick();
    this.timer = setInterval(
      guarded('jira', () => this.tick()),
      everyMs,
    );
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running || !this.jira.configured) return;
    this.running = true;
    try {
      const active = new Set(this.jira.activeUserIds());
      for (const userId of [...this.cache.keys()]) if (!active.has(userId)) this.forget(userId);
      for (const userId of active) await this.refresh(userId);
      this.updatedAt = this.now();
    } finally {
      this.running = false;
    }
  }

  /** Consulta uma pessoa já (ao conectar). */
  async refresh(userId: string): Promise<void> {
    try {
      this.cache.set(userId, await this.jira.issues(userId));
      this.updateCard(userId);
    } catch (err) {
      if (err instanceof JiraAuthError) this.forget(userId);
      else console.warn(`[jira] ${userId}: ${(err as Error).message}`);
    }
  }

  /** A pessoa mudou a privacidade: refaz a linha do cartão. */
  updateCard(userId: string): void {
    const doing = this.cache.get(userId)?.find((i) => i.column === 'doing');
    const text = doing ? jiraText(doing, this.jira.shareOf(userId)) : '';
    this.activity.setJira(userId, text ? { text, url: doing!.url } : null);
  }

  /** Desconectou (ou o token parou de valer): some do quadro e do cartão. */
  forget(userId: string): void {
    this.cache.delete(userId);
    this.activity.setJira(userId, null);
  }

  board(): JiraBoard {
    const issues = [...this.cache.entries()].flatMap(([userId, list]) => {
      const name = this.users.findById(userId)?.name ?? '…';
      return list.map((i) => ({ ...i, userId, name }));
    });
    issues.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      configured: this.jira.configured,
      site: this.jira.site,
      people: this.jira.activeUserIds().length,
      issues,
      updatedAt: this.updatedAt,
    };
  }
}
