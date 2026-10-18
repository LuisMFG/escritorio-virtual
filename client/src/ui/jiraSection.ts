import {
  JIRA_SHARE,
  JIRA_SHARE_LABELS,
  JIRA_TOKEN_URL,
  type JiraShare,
  type JiraStatus,
} from '@office/shared';
import { jiraApi } from '../net/api.js';
import { confirmDialog } from './confirm.js';

/**
 * Seção "Jira" do perfil: conectar com e-mail + token de API, escolher o que aparece no cartão
 * e desconectar.
 */
export function mountJiraSection(box: HTMLElement, token: string): void {
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, unknown> = {},
  ): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);
  const title = el('h3', { textContent: '📋 Jira' });
  const error = el('p', { className: 'login-error', hidden: true });

  const fail = (err: unknown) => {
    error.hidden = false;
    error.textContent = (err as Error).message;
  };

  const render = (s: JiraStatus) => {
    error.hidden = true;
    if (!s.configured) {
      box.replaceChildren(
        title,
        el('p', {
          className: 'muted spotify-intro',
          textContent:
            'O Jira ainda não foi configurado neste escritório. Um administrador informa o endereço em Admin → Convite e salas.',
        }),
      );
      return;
    }
    const site = s.site?.replace(/^https?:\/\//, '') ?? '';
    if (!s.linked) {
      const intro = el('p', { className: 'muted spotify-intro' });
      intro.append(
        `Mostre no seu cartão a demanda em andamento no Jira (${site}) e apareça no Quadro de Demandas. Crie um token de API em `,
        el('a', {
          href: JIRA_TOKEN_URL,
          target: '_blank',
          rel: 'noopener noreferrer',
          textContent: 'id.atlassian.com',
        }),
        ' e cole abaixo.',
      );
      const form = el('form', { className: 'jira-form', noValidate: true });
      const email = el('input', {
        type: 'email',
        name: 'jiraEmail',
        placeholder: 'E-mail da conta Atlassian',
        autocomplete: 'email',
        maxLength: 200,
      });
      email.setAttribute('aria-label', 'E-mail do Jira');
      const secret = el('input', {
        type: 'password',
        name: 'jiraToken',
        placeholder: 'Token de API',
        autocomplete: 'off',
        maxLength: 500,
      });
      secret.setAttribute('aria-label', 'Token de API do Jira');
      const connect = el('button', {
        type: 'submit',
        className: 'btn-secondary',
        textContent: 'Conectar Jira',
      });
      form.append(email, secret, connect);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        connect.disabled = true;
        connect.textContent = 'Conferindo…';
        try {
          render(await jiraApi.connect(token, { email: email.value, token: secret.value }));
        } catch (err) {
          connect.disabled = false;
          connect.textContent = 'Conectar Jira';
          fail(err);
        }
      });
      box.replaceChildren(title, intro, form, error);
      return;
    }

    const who = el('p', {
      className: 'spotify-intro',
      textContent: `Conectado como ${s.displayName ?? s.email} (${site}).`,
    });
    const nodes: HTMLElement[] = [title, who];
    if (s.error) nodes.push(el('p', { className: 'login-error', textContent: s.error }));
    const share = el('label', { className: 'field code-share' });
    const select = el('select', { name: 'jiraShare' });
    for (const v of JIRA_SHARE) select.append(new Option(JIRA_SHARE_LABELS[v], v));
    select.value = s.share;
    select.addEventListener('change', async () => {
      try {
        render(await jiraApi.setShare(token, select.value as JiraShare));
      } catch (err) {
        fail(err);
      }
    });
    share.append(el('span', { textContent: 'No cartão' }), select);
    const disconnect = el('button', {
      type: 'button',
      className: 'btn-link',
      textContent: 'Desconectar',
    });
    disconnect.addEventListener('click', async () => {
      const yes = await confirmDialog(
        'Desconectar o Jira? Sua demanda some do cartão e do Quadro de Demandas.',
        { confirmLabel: 'Desconectar' },
      );
      if (!yes) return;
      try {
        render(await jiraApi.disconnect(token));
      } catch (err) {
        fail(err);
      }
    });
    const actions = el('div', { className: 'pet-actions' });
    actions.append(share, disconnect);
    nodes.push(actions, error);
    box.replaceChildren(...nodes);
  };

  box.replaceChildren(title, el('p', { className: 'muted', textContent: 'Carregando…' }));
  jiraApi
    .status(token)
    .then(render)
    .catch(() =>
      box.replaceChildren(
        title,
        el('p', { className: 'muted', textContent: 'Não foi possível carregar.' }),
      ),
    );
}
