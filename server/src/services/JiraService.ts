import {
  JIRA_SHARE,
  jiraColumn,
  type JiraIssue,
  type JiraShare,
  type JiraStatus,
} from '@office/shared';
import { eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jiraLinks } from '../db/schema.js';
import type { SecretBox } from '../util/secretBox.js';
import type { SettingsService } from './SettingsService.js';

/** O Jira recusou as credenciais (token revogado/vencido ou sem acesso). */
export class JiraAuthError extends Error {}

/** Demandas da pessoa: abertas e as concluídas nos últimos 7 dias, mais recentes primeiro. */
export const MY_ISSUES_JQL =
  'assignee = currentUser() AND (statusCategory != Done OR resolved >= -7d) ORDER BY updated DESC';

const AUTH_ERROR = 'O Jira recusou o token (venceu ou foi revogado). Conecte de novo.';
const TIMEOUT_MS = 10_000;

interface SearchResponse {
  issues?: {
    key: string;
    fields?: {
      summary?: string;
      updated?: string;
      status?: { name?: string; statusCategory?: { key?: string } };
    };
  }[];
}

/**
 * Integração com o Jira Cloud: cada pessoa conecta com e-mail + token de API (Basic auth), e o
 * servidor consulta as demandas atribuídas a ela com as permissões dela.
 */
export class JiraService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly box: SecretBox,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get site(): string | null {
    return this.settings.jiraSite();
  }

  get configured(): boolean {
    return this.site !== null;
  }

  status(userId: string): JiraStatus {
    const link = this.link(userId);
    return {
      configured: this.configured,
      site: this.site,
      linked: Boolean(link),
      email: link?.email ?? null,
      displayName: link?.displayName ?? null,
      share: toShare(link?.share),
      error: link?.lastError ?? null,
    };
  }

  /** Confere as credenciais no Jira e liga a conta. Devolve o motivo se não der. */
  async connect(userId: string, email: string, token: string): Promise<string | null> {
    if (!this.site) return 'O Jira ainda não foi configurado neste escritório.';
    let me: { accountId?: string; displayName?: string };
    try {
      me = (await this.call(email, token, 'GET', '/rest/api/3/myself')) as typeof me;
    } catch (err) {
      if (err instanceof JiraAuthError)
        return 'E-mail ou token recusado pelo Jira. Confira e tente de novo.';
      return 'Não foi possível falar com o Jira agora. Tente de novo em instantes.';
    }
    if (!me.accountId) return 'O Jira respondeu de um jeito inesperado.';
    const row = {
      email,
      tokenEnc: this.box.seal(token),
      accountId: me.accountId,
      displayName: me.displayName ?? null,
      lastError: null,
    };
    this.db
      .insert(jiraLinks)
      .values({ userId, ...row, createdAt: new Date(this.now()) })
      .onConflictDoUpdate({ target: jiraLinks.userId, set: row })
      .run();
    return null;
  }

  setShare(userId: string, share: JiraShare): boolean {
    return (
      this.db.update(jiraLinks).set({ share }).where(eq(jiraLinks.userId, userId)).run().changes > 0
    );
  }

  shareOf(userId: string): JiraShare {
    return toShare(this.link(userId)?.share);
  }

  unlink(userId: string): void {
    this.db.delete(jiraLinks).where(eq(jiraLinks.userId, userId)).run();
  }

  /** Quem conectou e não está com erro (o poller consulta só esses). */
  activeUserIds(): string[] {
    return this.db
      .select({ userId: jiraLinks.userId })
      .from(jiraLinks)
      .where(isNull(jiraLinks.lastError))
      .all()
      .map((r) => r.userId);
  }

  /** Demandas da pessoa. Credencial recusada: marca o erro (para de consultar) e lança. */
  async issues(userId: string): Promise<JiraIssue[]> {
    const link = this.link(userId);
    const site = this.site;
    if (!link || !site) return [];
    let res: SearchResponse;
    try {
      res = (await this.call(
        link.email,
        this.box.open(link.tokenEnc),
        'POST',
        '/rest/api/3/search/jql',
        {
          jql: MY_ISSUES_JQL,
          fields: ['summary', 'status', 'updated'],
          maxResults: 30,
        },
      )) as SearchResponse;
    } catch (err) {
      if (err instanceof JiraAuthError) {
        this.db
          .update(jiraLinks)
          .set({ lastError: AUTH_ERROR })
          .where(eq(jiraLinks.userId, userId))
          .run();
      }
      throw err;
    }
    return (res.issues ?? []).map((i) => ({
      key: i.key,
      title: i.fields?.summary ?? '',
      url: `${site}/browse/${encodeURIComponent(i.key)}`,
      status: i.fields?.status?.name ?? '',
      column: jiraColumn(i.fields?.status?.statusCategory?.key),
      updatedAt: Date.parse(i.fields?.updated ?? '') || 0,
    }));
  }

  private link(userId: string) {
    return this.db.select().from(jiraLinks).where(eq(jiraLinks.userId, userId)).get();
  }

  private async call(
    email: string,
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const site = this.site;
    if (!site) throw new Error('Jira não configurado.');
    const res = await this.http(`${site}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403)
      throw new JiraAuthError(`Jira: HTTP ${res.status}`);
    if (!res.ok) throw new Error(`Jira: HTTP ${res.status}`);
    return res.json();
  }
}

function toShare(s: string | undefined): JiraShare {
  return (JIRA_SHARE as readonly string[]).includes(s ?? '') ? (s as JiraShare) : 'title';
}
