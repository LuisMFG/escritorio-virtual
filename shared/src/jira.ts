import { z } from 'zod';

/**
 * Jira Cloud (Fase 30): cada pessoa liga a própria conta (e-mail + token de API) e o cartão
 * mostra a demanda em andamento; o Quadro de Demandas junta as demandas de quem conectou.
 */

/** O que aparece no cartão. */
export const JIRA_SHARE = ['hidden', 'key', 'title'] as const;
export type JiraShare = (typeof JIRA_SHARE)[number];
export const JIRA_SHARE_LABELS: Record<JiraShare, string> = {
  hidden: 'Não mostrar',
  key: 'Só o código (PROJ-123)',
  title: 'Código e título',
};

/** De quanto em quanto tempo o servidor pergunta ao Jira. */
export const JIRA_POLL_MS = 60_000;

/** Onde criar o token de API da Atlassian. */
export const JIRA_TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';

export const jiraConnectSchema = z.object({
  email: z.email('Informe o e-mail da sua conta Atlassian.').max(200),
  token: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(10, 'Cole o token de API inteiro.').max(500)),
});
export type JiraConnect = z.input<typeof jiraConnectSchema>;

export const jiraSettingsSchema = z.object({ share: z.enum(JIRA_SHARE) });

/**
 * Endereço do Jira Cloud a partir do que o admin digitou: `empresa`, `empresa.atlassian.net`
 * ou a URL inteira viram `https://empresa.atlassian.net`. `null` = não é um Jira Cloud.
 */
export function normalizeJiraSite(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(s)) s = `${s}.atlassian.net`;
  return /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/.test(s) ? `https://${s}` : null;
}

export const jiraSiteSchema = z.object({
  /** Vazio desliga a integração. */
  site: z.string().max(200),
});

/** Coluna do quadro (categoria de status do Jira). */
export type JiraColumn = 'todo' | 'doing' | 'done';
export const JIRA_COLUMNS: { id: JiraColumn; label: string }[] = [
  { id: 'todo', label: 'A fazer' },
  { id: 'doing', label: 'Em andamento' },
  { id: 'done', label: 'Concluídas (7 dias)' },
];

/** `statusCategory.key` do Jira → coluna. */
export function jiraColumn(categoryKey: string | undefined): JiraColumn {
  if (categoryKey === 'done') return 'done';
  if (categoryKey === 'indeterminate') return 'doing';
  return 'todo';
}

export interface JiraIssue {
  key: string;
  title: string;
  url: string;
  /** Nome do status no Jira (ex.: "Em revisão"). */
  status: string;
  column: JiraColumn;
  updatedAt: number;
}

/** Demanda no quadro, com quem está com ela (nome do escritório). */
export interface JiraBoardIssue extends JiraIssue {
  userId: string;
  name: string;
}

/** `GET /api/jira/board`. */
export interface JiraBoard {
  configured: boolean;
  site: string | null;
  /** Quantas pessoas conectaram a conta. */
  people: number;
  issues: JiraBoardIssue[];
  updatedAt: number | null;
}

/** `GET /api/jira/status`. */
export interface JiraStatus {
  configured: boolean;
  site: string | null;
  linked: boolean;
  email: string | null;
  displayName: string | null;
  share: JiraShare;
  /** Problema na última consulta (token vencido etc.). */
  error: string | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "📋 PROJ-123 · título" conforme a privacidade (`''` = nada). */
export function jiraText(issue: Pick<JiraIssue, 'key' | 'title'>, share: JiraShare): string {
  if (share === 'hidden') return '';
  if (share === 'key') return `📋 ${issue.key}`;
  return `📋 ${issue.key} · ${clip(issue.title, 50)}`;
}
