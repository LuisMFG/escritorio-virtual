import { CATALOG_CATEGORY_IDS, DEFAULT_HIDDEN_CATEGORIES } from '@office/shared';
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

  /** Categorias do catálogo de móveis escondidas (festa e jogos, por padrão). */
  hiddenCategories(): string[] {
    const raw = this.get('hidden_furni_categories');
    if (raw === undefined) return [...DEFAULT_HIDDEN_CATEGORIES];
    try {
      const list = JSON.parse(raw) as unknown;
      return Array.isArray(list) ? list.filter((c) => CATALOG_CATEGORY_IDS.includes(c)) : [];
    } catch {
      return [];
    }
  }

  setHiddenCategories(list: string[]): void {
    this.set(
      'hidden_furni_categories',
      JSON.stringify([...new Set(list.filter((c) => CATALOG_CATEGORY_IDS.includes(c)))]),
    );
  }
}
