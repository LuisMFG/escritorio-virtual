import {
  CODE_SHARE,
  CODE_SHARE_LABELS,
  formatLastSeen,
  type ActivitySettings,
  type CodeShare,
} from '@office/shared';
import { activityApi } from '../net/api.js';
import { confirmDialog } from './confirm.js';

/**
 * Seção "Editores de código" do perfil: o que aparece quando a pessoa programa e os tokens
 * pessoais usados pelas extensões do VS Code e do Visual Studio.
 */
export function mountCodeSection(box: HTMLElement, token: string): void {
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, unknown> = {},
  ): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);
  const title = el('h3', { textContent: '💻 Editores de código' });
  let settings: ActivitySettings | null = null;
  let fresh: { name: string; token: string } | null = null;

  const render = () => {
    if (!settings) return;
    const intro = el('p', { className: 'muted code-intro' });
    intro.append(
      'Mostre no seu cartão quando estiver programando. Instale a extensão ',
      el('a', {
        href: '/downloads/escritorio-atividade.vsix',
        download: 'escritorio-atividade.vsix',
        textContent: 'do VS Code',
      }),
      ' (Extensões → … → Instalar do VSIX) ou a do Visual Studio, e cole um token abaixo no comando “Escritório: conectar”.',
    );

    const share = el('label', { className: 'field code-share' });
    const select = el('select', { name: 'codeShare' });
    for (const s of CODE_SHARE) select.append(new Option(CODE_SHARE_LABELS[s], s));
    select.value = settings.codeShare;
    select.addEventListener('change', async () => {
      const value = select.value as CodeShare;
      await activityApi.setCodeShare(token, value);
      settings!.codeShare = value;
    });
    share.append(el('span', { textContent: 'O que os outros veem' }), select);

    const list = el('ul', { className: 'token-list' });
    for (const t of settings.tokens) {
      const li = el('li');
      const used = t.lastUsedAt ? `usado ${formatLastSeen(t.lastUsedAt)}` : 'nunca usado';
      li.append(
        el('span', { textContent: t.name }),
        el('small', { className: 'muted', textContent: used }),
      );
      const revoke = el('button', {
        type: 'button',
        className: 'btn-link',
        textContent: 'Revogar',
      });
      revoke.addEventListener('click', async () => {
        const yes = await confirmDialog(
          `Revogar o token “${t.name}”? A extensão que usa ele para de funcionar.`,
          { confirmLabel: 'Revogar', danger: true },
        );
        if (!yes) return;
        await activityApi.revokeToken(token, t.id);
        await load();
      });
      li.append(revoke);
      list.append(li);
    }
    if (settings.tokens.length === 0) {
      list.append(el('li', { className: 'muted', textContent: 'Nenhum token ainda.' }));
    }

    const form = el('form', { className: 'token-form', noValidate: true });
    const name = el('input', {
      name: 'tokenName',
      maxLength: 40,
      placeholder: 'Nome (ex.: VS Code do trabalho)',
    });
    name.setAttribute('aria-label', 'Nome do token');
    const error = el('p', { className: 'login-error', hidden: true });
    form.append(
      name,
      el('button', { type: 'submit', className: 'btn-secondary', textContent: 'Gerar token' }),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      try {
        const created = await activityApi.createToken(token, name.value);
        fresh = { name: created.name, token: created.token };
        await load();
      } catch (err) {
        error.hidden = false;
        error.textContent = (err as Error).message;
      }
    });

    const nodes: HTMLElement[] = [title, intro, share];
    if (fresh) {
      const shown = el('div', { className: 'token-fresh' });
      const input = el('input', { readOnly: true, value: fresh.token, className: 'token-value' });
      input.setAttribute('aria-label', `Token ${fresh.name}`);
      const copy = el('button', {
        type: 'button',
        className: 'btn-primary btn-small',
        textContent: 'Copiar',
      });
      copy.addEventListener('click', async () => {
        input.select();
        try {
          await navigator.clipboard.writeText(input.value);
        } catch {
          document.execCommand('copy');
        }
        copy.textContent = 'Copiado ✓';
      });
      shown.append(
        el('strong', {
          textContent: `Token “${fresh.name}” criado. Copie agora: ele não aparece de novo.`,
        }),
        input,
        copy,
      );
      nodes.push(shown);
    }
    nodes.push(list, form, error);
    box.replaceChildren(...nodes);
  };

  const load = async () => {
    settings = await activityApi.settings(token);
    render();
  };

  box.replaceChildren(title, el('p', { className: 'muted', textContent: 'Carregando…' }));
  load().catch(() =>
    box.replaceChildren(
      title,
      el('p', { className: 'muted', textContent: 'Não foi possível carregar.' }),
    ),
  );
}
