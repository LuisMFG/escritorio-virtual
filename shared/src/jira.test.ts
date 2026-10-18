import { describe, expect, it } from 'vitest';
import { jiraColumn, jiraText, normalizeJiraSite } from './jira.js';

describe('jira', () => {
  it('normaliza o endereço do Jira Cloud', () => {
    for (const input of [
      'empresa',
      'Empresa.atlassian.net',
      'https://empresa.atlassian.net/jira/software/projects',
      ' http://empresa.atlassian.net/ ',
    ])
      expect(normalizeJiraSite(input), input).toBe('https://empresa.atlassian.net');
    for (const input of [
      '',
      'jira.empresa.com.br',
      'https://evil.com/empresa.atlassian.net',
      'a b',
      'empresa.atlassian.net.evil.com',
    ])
      expect(normalizeJiraSite(input), input).toBeNull();
  });

  it('coluna pela categoria de status e texto do cartão pela privacidade', () => {
    expect([
      jiraColumn('new'),
      jiraColumn('indeterminate'),
      jiraColumn('done'),
      jiraColumn(undefined),
    ]).toEqual(['todo', 'doing', 'done', 'todo']);
    const issue = {
      key: 'TI-42',
      title: 'Migrar o banco de dados do sistema de chamados para o novo servidor',
    };
    expect(jiraText(issue, 'hidden')).toBe('');
    expect(jiraText(issue, 'key')).toBe('📋 TI-42');
    const text = jiraText(issue, 'title');
    expect(text).toMatch(/^📋 TI-42 · Migrar o banco de dados.*…$/);
    expect(text.length).toBeLessThanOrEqual('📋 TI-42 · '.length + 50);
  });
});
