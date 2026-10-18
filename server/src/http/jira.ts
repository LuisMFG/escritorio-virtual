import {
  ErrorCode,
  jiraConnectSchema,
  jiraSettingsSchema,
  type JiraBoard,
  type JiraStatus,
} from '@office/shared';
import type { JiraPoller } from '../services/JiraPoller.js';
import type { JiraService } from '../services/JiraService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface JiraDeps {
  jira: JiraService;
  jiraPoller: JiraPoller;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });
const invalid = (message: string) => fail(400, ErrorCode.InvalidPayload, { message });

export function jiraStatus(caller: Caller, deps: JiraDeps): Result<JiraStatus> {
  return ok(deps.jira.status(caller.user.id));
}

/** Liga a conta: confere e-mail + token no Jira antes de guardar. */
export async function jiraConnect(
  caller: Caller,
  input: unknown,
  deps: JiraDeps,
): Promise<Result<JiraStatus>> {
  const p = jiraConnectSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues[0]?.message ?? 'Dados inválidos.');
  const problem = await deps.jira.connect(caller.user.id, p.data.email, p.data.token);
  if (problem) return invalid(problem);
  await deps.jiraPoller.refresh(caller.user.id);
  return ok(deps.jira.status(caller.user.id));
}

export function jiraSettings(caller: Caller, input: unknown, deps: JiraDeps): Result<JiraStatus> {
  const p = jiraSettingsSchema.safeParse(input);
  if (!p.success) return invalid('Escolha uma opção.');
  if (!deps.jira.setShare(caller.user.id, p.data.share)) return fail(404, ErrorCode.NotFound);
  deps.jiraPoller.updateCard(caller.user.id);
  return ok(deps.jira.status(caller.user.id));
}

export function jiraDisconnect(caller: Caller, deps: JiraDeps): Result<JiraStatus> {
  deps.jira.unlink(caller.user.id);
  deps.jiraPoller.forget(caller.user.id);
  return ok(deps.jira.status(caller.user.id));
}

export function jiraBoard(_caller: Caller, deps: JiraDeps): Result<JiraBoard> {
  return ok(deps.jiraPoller.board());
}
