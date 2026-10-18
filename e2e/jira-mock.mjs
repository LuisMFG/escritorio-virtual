// Jira Cloud de mentira para os testes de ponta a ponta: confere o Basic auth e devolve
// duas demandas para quem usar o token certo.
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import process from 'node:process';

const PORT = Number(process.env.JIRA_MOCK_PORT ?? 2601);
const GOOD = 'token-e2e-valido-123';

createServer((req, res) => {
  const [, b64 = ''] = (req.headers.authorization ?? '').split(' ');
  const [email = '', token = ''] = Buffer.from(b64, 'base64').toString().split(':');
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/healthz') return json(200, { ok: true });
  if (token !== GOOD) return json(401, { errorMessages: ['Unauthorized'] });
  const who = email.split('@')[0];
  if (req.url === '/rest/api/3/myself') {
    return json(200, { accountId: `acc-${who}`, displayName: `${who} (Jira)` });
  }
  if (req.url === '/rest/api/3/search/jql' && req.method === 'POST') {
    const now = new Date().toISOString();
    return json(200, {
      issues: [
        {
          key: 'E2E-1',
          fields: {
            summary: 'Ajustar relatório de vendas',
            updated: now,
            status: { name: 'Em andamento', statusCategory: { key: 'indeterminate' } },
          },
        },
        {
          key: 'E2E-2',
          fields: {
            summary: 'Revisar acessos da VPN',
            updated: now,
            status: { name: 'Tarefas pendentes', statusCategory: { key: 'new' } },
          },
        },
      ],
    });
  }
  json(404, {});
}).listen(PORT, '127.0.0.1');
