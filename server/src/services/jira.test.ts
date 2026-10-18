import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { jiraLinks } from '../db/schema.js';
import { SecretBox } from '../util/secretBox.js';
import { createServices } from './index.js';

const GOOD = 'token-bom-123456';

/** Jira de mentira: confere o Basic auth e devolve demandas. */
function fakeJira(issues: unknown[] = []) {
  const calls: { url: string; auth: string; body?: string }[] = [];
  const http = (async (url: string | URL, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>).Authorization);
    calls.push({ url: String(url), auth, body: init?.body as string | undefined });
    const [, b64] = auth.split(' ');
    const [, token] = Buffer.from(b64!, 'base64').toString().split(':');
    if (token !== GOOD) return new Response('{}', { status: 401 });
    if (String(url).endsWith('/rest/api/3/myself'))
      return Response.json({ accountId: 'acc-1', displayName: 'Ana Jira' });
    return Response.json({ issues });
  }) as typeof fetch;
  return { http, calls };
}

const ISSUES = [
  {
    key: 'TI-7',
    fields: {
      summary: 'Configurar VPN',
      updated: '2026-10-18T10:00:00.000-0300',
      status: { name: 'Em revisão', statusCategory: { key: 'indeterminate' } },
    },
  },
  {
    key: 'TI-9',
    fields: {
      summary: 'Trocar teclado',
      updated: '2026-10-17T10:00:00.000-0300',
      status: { name: 'Tarefas pendentes', statusCategory: { key: 'new' } },
    },
  },
  {
    key: 'TI-3',
    fields: {
      summary: 'Backup do ERP',
      updated: '2026-10-16T10:00:00.000-0300',
      status: { name: 'Concluído', statusCategory: { key: 'done' } },
    },
  },
];

function setup(issues: unknown[] = ISSUES) {
  const fake = fakeJira(issues);
  const svc = createServices(
    openDatabase(':memory:'),
    { inviteCode: 'x' },
    undefined,
    undefined,
    undefined,
    {
      http: fake.http,
    },
  );
  const ana = svc.users.create('Ana', 'hd-180-1').user;
  return { svc, ana, ...fake };
}

describe('cofre de segredos', () => {
  it('cifra e abre; outra chave não abre', () => {
    const box = new SecretBox(randomBytes(32));
    const sealed = box.seal(GOOD);
    expect(sealed).not.toContain(GOOD);
    expect(box.open(sealed)).toBe(GOOD);
    expect(box.seal(GOOD)).not.toBe(sealed);
    expect(() => new SecretBox(randomBytes(32)).open(sealed)).toThrow();
  });
});

describe('Jira', () => {
  it('sem endereço configurado não conecta', async () => {
    const { svc, ana } = setup();
    expect(svc.jira.status(ana.id)).toMatchObject({ configured: false, linked: false });
    expect(await svc.jira.connect(ana.id, 'ana@empresa.com', GOOD)).toMatch(/não foi configurado/);
  });

  it('conecta conferindo o token, guarda cifrado e põe a demanda em andamento no cartão', async () => {
    const { svc, ana, calls } = setup();
    svc.settings.setJiraSite('https://empresa.atlassian.net');
    expect(await svc.jira.connect(ana.id, 'ana@empresa.com', 'token-errado-999')).toMatch(
      /recusado/,
    );
    expect(await svc.jira.connect(ana.id, 'ana@empresa.com', GOOD)).toBeNull();
    expect(calls[0]!.url).toBe('https://empresa.atlassian.net/rest/api/3/myself');
    expect(svc.jira.status(ana.id)).toMatchObject({
      linked: true,
      displayName: 'Ana Jira',
      share: 'title',
      error: null,
    });
    const row = svc.db.select().from(jiraLinks).get()!;
    expect(row.tokenEnc).not.toContain(GOOD);

    await svc.jiraPoller.refresh(ana.id);
    expect(JSON.parse(calls.at(-1)!.body!)).toMatchObject({
      jql: expect.stringContaining('assignee = currentUser()'),
    });
    expect(svc.activity.text(ana.id)).toBe('📋 TI-7 · Configurar VPN');
    expect(svc.activity.url(ana.id)).toBe('https://empresa.atlassian.net/browse/TI-7');

    svc.jira.setShare(ana.id, 'key');
    svc.jiraPoller.updateCard(ana.id);
    expect(svc.activity.text(ana.id)).toBe('📋 TI-7');
    svc.jira.setShare(ana.id, 'hidden');
    svc.jiraPoller.updateCard(ana.id);
    expect(svc.activity.text(ana.id)).toBe('');

    const board = svc.jiraPoller.board();
    expect(board).toMatchObject({ configured: true, people: 1 });
    expect(board.issues.map((i) => [i.key, i.column, i.status, i.name])).toEqual([
      ['TI-7', 'doing', 'Em revisão', 'Ana'],
      ['TI-9', 'todo', 'Tarefas pendentes', 'Ana'],
      ['TI-3', 'done', 'Concluído', 'Ana'],
    ]);

    svc.jira.unlink(ana.id);
    svc.jiraPoller.forget(ana.id);
    expect(svc.jiraPoller.board().issues).toEqual([]);
  });

  it('token revogado: marca o erro, some do quadro e para de consultar', async () => {
    const { svc, ana } = setup();
    svc.settings.setJiraSite('https://empresa.atlassian.net');
    await svc.jira.connect(ana.id, 'ana@empresa.com', GOOD);
    await svc.jiraPoller.tick();
    expect(svc.jiraPoller.board().issues).toHaveLength(3);
    // Simula a revogação trocando o token guardado.
    const box = (svc.jira as unknown as { box: SecretBox }).box;
    svc.db
      .update(jiraLinks)
      .set({ tokenEnc: box.seal('token-revogado-000') })
      .run();
    await svc.jiraPoller.tick();
    expect(svc.jira.status(ana.id).error).toMatch(/Conecte de novo/);
    expect(svc.jira.activeUserIds()).toEqual([]);
    expect(svc.jiraPoller.board().issues).toEqual([]);
    expect(svc.activity.text(ana.id)).toBe('');
  });

  it('linhas do cartão e links ficam alinhados (editor, Jira, música)', () => {
    const { svc, ana } = setup();
    svc.activity.editor(ana.id, { state: 'active', language: 'typescript' });
    svc.activity.setJira(ana.id, { text: '📋 TI-1', url: 'https://e.atlassian.net/browse/TI-1' });
    svc.activity.setMusic(ana.id, {
      track: 'Música',
      artists: 'Banda',
      url: 'https://open.spotify.com/track/1',
    });
    expect(svc.activity.text(ana.id).split('\n')).toHaveLength(3);
    expect(svc.activity.url(ana.id).split('\n')).toEqual([
      '',
      'https://e.atlassian.net/browse/TI-1',
      'https://open.spotify.com/track/1',
    ]);
  });
});
