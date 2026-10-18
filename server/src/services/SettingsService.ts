import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

/** Configurações editáveis pelo painel Admin; o `.env` vale como valor inicial. */
export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly defaults: { inviteCode: string; jiraSite?: string },
  ) {}

  private get(key: string): string | undefined {
    return this.db.select().from(settings).where(eq(settings.key, key)).get()?.value;
  }

  private set(key: string, value: string): void {
    this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }

  inviteCode(): string {
    return this.get('invite_code') ?? this.defaults.inviteCode;
  }

  setInviteCode(code: string): void {
    this.set('invite_code', code);
  }

  /** Endereço do Jira Cloud (`JIRA_SITE` no servidor vale mais que o do painel). `null` = desligado. */
  jiraSite(): string | null {
    return this.defaults.jiraSite || this.get('jira_site') || null;
  }

  /** Definido no `.env`: o painel só mostra. */
  get jiraSiteLocked(): boolean {
    return Boolean(this.defaults.jiraSite);
  }

  setJiraSite(site: string | null): void {
    this.set('jira_site', site ?? '');
  }
}
