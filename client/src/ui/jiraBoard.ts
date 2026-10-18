import { formatLastSeen, JIRA_COLUMNS, type JiraBoard, type JiraBoardIssue } from '@office/shared';
import { jiraApi } from '../net/api.js';
import { sheet } from './kudos.js';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

/** Quadro de Demandas: as demandas de quem conectou o Jira, por coluna, com filtro por pessoa. */
export function openJiraBoard(opts: { token: string; myUserId: string; openProfile(): void }): {
  close(): void;
} {
  const { body, close } = sheet('📋 Quadro de Demandas', 'sheet-wide jira-board');
  const top = el('div', { className: 'kudos-top' });
  const who = el('select', { className: 'kudos-picker' });
  who.setAttribute('aria-label', 'Filtrar por pessoa');
  const info = el('small', { className: 'muted jira-info' });
  top.append(who, info);
  const columns = el('div', { className: 'jira-columns' });
  body.append(el('p', { className: 'muted', textContent: 'Carregando…' }));
  let board: JiraBoard | null = null;

  const draw = () => {
    if (!board) return;
    if (!board.configured) {
      body.replaceChildren(
        el('p', {
          className: 'muted',
          textContent:
            'O Jira ainda não foi configurado. Um administrador informa o endereço em Admin → Convite e salas.',
        }),
      );
      return;
    }
    const filter = who.value;
    const issues = board.issues.filter((i) => !filter || i.userId === filter);
    columns.replaceChildren(
      ...JIRA_COLUMNS.map((c) => {
        const list = issues.filter((i) => i.column === c.id);
        const col = el('section', { className: `jira-col jira-col-${c.id}` });
        col.setAttribute('aria-label', c.label);
        col.append(el('h3', { textContent: `${c.label} · ${list.length}` }));
        const ul = el('ul');
        ul.append(...list.map(card));
        if (list.length === 0)
          ul.append(el('li', { className: 'muted jira-empty', textContent: '—' }));
        col.append(ul);
        return col;
      }),
    );
    const site = board.site?.replace(/^https?:\/\//, '') ?? '';
    info.textContent = `${board.people} ${board.people === 1 ? 'pessoa conectada' : 'pessoas conectadas'} · ${site}${
      board.updatedAt ? ` · atualizado ${formatLastSeen(board.updatedAt)}` : ''
    }`;
    const connect = el('button', {
      type: 'button',
      className: 'btn-link',
      textContent: 'Conectar meu Jira (Perfil)',
    });
    connect.addEventListener('click', () => {
      close();
      opts.openProfile();
    });
    const nodes: HTMLElement[] = [top, columns];
    if (!board.issues.some((i) => i.userId === opts.myUserId)) nodes.push(connect);
    body.replaceChildren(...nodes);
  };

  const card = (i: JiraBoardIssue) => {
    const li = el('li', { className: 'jira-card' });
    const link = el('a', {
      href: i.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'jira-key',
      textContent: i.key,
    });
    li.append(
      link,
      el('span', { className: 'jira-title', textContent: i.title }),
      el('small', { className: 'muted', textContent: `${i.name} · ${i.status}` }),
    );
    return li;
  };

  who.addEventListener('change', draw);
  void jiraApi
    .board(opts.token)
    .then((b) => {
      board = b;
      const people = new Map(b.issues.map((i) => [i.userId, i.name]));
      who.replaceChildren(
        new Option('Toda a equipe', ''),
        ...[...people]
          .sort((a, b2) => a[1].localeCompare(b2[1], 'pt-BR'))
          .map(([id, name]) => new Option(name, id)),
      );
      draw();
    })
    .catch((err: Error) =>
      body.replaceChildren(el('p', { className: 'login-error', textContent: err.message })),
    );
  return { close };
}

const COLORS = { todo: '#94a3b8', doing: '#3b82f6', done: '#22c55e' } as const;

/** Mini-kanban desenhado no papel do móvel: três colunas com um bloquinho por demanda. */
export function renderJiraThumb(
  board: JiraBoard | null,
  reuse?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = reuse ?? document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 160;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f8fafc';
  g.fillRect(0, 0, 120, 160);
  JIRA_COLUMNS.forEach((c, i) => {
    const x = 6 + i * 38;
    g.fillStyle = '#e2e8f0';
    g.fillRect(x, 6, 34, 148);
    g.fillStyle = COLORS[c.id];
    g.fillRect(x, 6, 34, 8);
    const count = Math.min(9, board?.issues.filter((iss) => iss.column === c.id).length ?? 0);
    for (let k = 0; k < count; k++) {
      g.fillStyle = '#ffffff';
      g.fillRect(x + 3, 18 + k * 15, 28, 12);
      g.fillStyle = COLORS[c.id];
      g.fillRect(x + 3, 18 + k * 15, 3, 12);
    }
  });
  return canvas;
}
