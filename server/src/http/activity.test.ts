import { API_TOKEN_MAX } from '@office/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createToken,
  getSettings,
  revokeToken,
  setCodeShare,
  editorHeartbeat,
} from './activity.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

let deps: TestDeps;

beforeEach(() => {
  deps = makeDeps();
});

describe('atividade (VS Code)', () => {
  it('token pessoal manda atividade; a sessão não serve; revogar corta', async () => {
    const ana = await registered(deps);
    const caller = callerOf(deps, ana.token);
    const created = createToken(caller, { name: '  VS Code do trabalho ' }, deps);
    if (!created.ok) throw new Error(created.body.message);
    expect(created.body).toMatchObject({ name: 'VS Code do trabalho', lastUsedAt: null });
    expect(created.body.token).toMatch(/^esc_/);

    const hb = { state: 'active', language: 'typescriptreact', project: 'portal' };
    expect(editorHeartbeat(ana.token, hb, deps).ok).toBe(false);
    expect(editorHeartbeat(created.body.token, hb, deps).ok).toBe(true);
    expect(deps.activity.text(ana.userId)).toBe('💻 Codando em TypeScript no VS Code');

    setCodeShare(callerOf(deps, ana.token), { codeShare: 'project' }, deps);
    expect(deps.activity.text(ana.userId)).toBe('💻 Codando em TypeScript no VS Code · portal');
    setCodeShare(callerOf(deps, ana.token), { codeShare: 'hidden' }, deps);
    expect(deps.activity.text(ana.userId)).toBe('');
    expect(setCodeShare(caller, { codeShare: 'tudo' }, deps).ok).toBe(false);

    const settings = getSettings(callerOf(deps, ana.token), deps);
    expect(settings.ok && settings.body.tokens[0]?.lastUsedAt).toBeTypeOf('number');
    expect(revokeToken(caller, created.body.id, deps).ok).toBe(true);
    expect(editorHeartbeat(created.body.token, hb, deps).status).toBe(401);
  });

  it('limite de tokens e token de outra pessoa', async () => {
    const ana = await registered(deps);
    const beto = await registered(deps, { username: 'beto', name: 'Beto' });
    const caller = callerOf(deps, ana.token);
    for (let i = 0; i < API_TOKEN_MAX; i++)
      expect(createToken(caller, { name: `t${i}` }, deps).ok).toBe(true);
    expect(createToken(caller, { name: 'demais' }, deps).ok).toBe(false);
    const id = deps.apiTokens.list(ana.userId)[0]!.id;
    expect(revokeToken(callerOf(deps, beto.token), id, deps).status).toBe(404);
  });

  it('sem sinal por 3 minutos a atividade some; ocioso tira na hora', async () => {
    const ana = await registered(deps);
    let now = 1_000_000;
    const { ActivityService } = await import('../services/ActivityService.js');
    const activity = new ActivityService(deps.users, () => now);
    const changes: string[] = [];
    activity.events.on('changed', (id) => changes.push(id));
    activity.editor(ana.userId, { state: 'active', language: 'python' });
    activity.editor(ana.userId, { state: 'active', language: 'python' }); // mesmo texto: sem aviso
    expect(changes).toHaveLength(1);
    now += 2 * 60_000;
    activity.sweep();
    expect(activity.text(ana.userId)).toBe('💻 Codando em Python no VS Code');
    now += 2 * 60_000;
    activity.sweep();
    expect(activity.text(ana.userId)).toBe('');
    activity.editor(ana.userId, { state: 'active', editor: 'visualstudio', language: 'CSharp' });
    expect(activity.text(ana.userId)).toBe('💻 Codando em C# no Visual Studio');
    activity.editor(ana.userId, { state: 'idle' });
    expect(activity.text(ana.userId)).toBe('');
    expect(changes).toHaveLength(4);
  });
});
