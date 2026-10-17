import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

/** Configurações editáveis pelo painel Admin; o `.env` vale como valor inicial. */
export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly defaults: { inviteCode: string },
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
}
