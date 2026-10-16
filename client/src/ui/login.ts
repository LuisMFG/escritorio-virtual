import { avatarImageUrl, NAME_MAX, type SessionResponse } from '@office/shared';
import { ApiRequestError, createSession } from '../net/api.js';
import { loadSession, saveSession } from '../net/storage.js';

/**
 * Tela de entrada: nome + código de convite. Se o navegador já tem um token válido,
 * o código é opcional. Resolve com a sessão criada pelo servidor.
 */
export function showLogin(opts: {
  defaultFigure: string;
  notice?: string;
}): Promise<SessionResponse> {
  const stored = loadSession();
  const figure = stored?.figure ?? opts.defaultFigure;

  const backdrop = document.createElement('div');
  backdrop.className = 'login-backdrop';
  backdrop.innerHTML = `
    <form class="login-card" novalidate>
      <h1>Escritório Virtual</h1>
      <p class="login-sub">Entre para encontrar o pessoal.</p>
      <div class="login-avatar"><img alt="Prévia do seu avatar" width="64" height="110" /></div>
      <label class="field">
        <span>Seu nome</span>
        <input name="name" autocomplete="nickname" maxlength="${NAME_MAX}" required />
      </label>
      <label class="field">
        <span>Código de convite</span>
        <input name="invite" autocomplete="off" />
        <small class="field-hint" hidden>Este navegador já entrou antes: pode deixar em branco.</small>
      </label>
      <p class="login-error" role="alert" hidden></p>
      <button type="submit" class="btn-primary">Entrar</button>
      <p class="login-foot">O editor de avatar chega na próxima fase.</p>
    </form>`;
  document.body.append(backdrop);

  const form = backdrop.querySelector('form')!;
  const nameInput = form.querySelector<HTMLInputElement>('input[name=name]')!;
  const inviteInput = form.querySelector<HTMLInputElement>('input[name=invite]')!;
  const hint = form.querySelector<HTMLElement>('.field-hint')!;
  const errorBox = form.querySelector<HTMLElement>('.login-error')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const img = form.querySelector('img')!;

  // Prévia: proxy do servidor → imager direto → esconde.
  const sources = [
    avatarImageUrl(figure, { direction: 3 }, '/hh'),
    avatarImageUrl(figure, { direction: 3 }),
  ];
  img.onerror = () => {
    const next = sources.shift();
    if (next) img.src = next;
    else img.hidden = true;
  };
  img.src = sources.shift()!;

  nameInput.value = stored?.name ?? '';
  hint.hidden = !stored?.token;
  if (opts.notice) showError(opts.notice);
  (nameInput.value ? inviteInput : nameInput).focus();

  function showError(message: string, suggestion?: string): void {
    errorBox.hidden = false;
    errorBox.textContent = message;
    if (suggestion) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-link';
      btn.textContent = `Usar “${suggestion}”`;
      btn.addEventListener('click', () => {
        nameInput.value = suggestion;
        form.requestSubmit();
      });
      errorBox.append(' ', btn);
    }
  }

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      if (nameInput.value.trim().length < 2)
        return showError('Digite seu nome (pelo menos 2 letras).');
      submit.disabled = true;
      submit.textContent = 'Entrando…';
      try {
        const session = await createSession({
          name: nameInput.value,
          inviteCode: inviteInput.value || undefined,
          figure,
          token: stored?.token,
        });
        saveSession({ name: session.name, figure: session.figure, token: session.token });
        backdrop.remove();
        resolve(session);
      } catch (err) {
        const body = err instanceof ApiRequestError ? err.body : {};
        showError((err as Error).message, body.suggestion);
        if (body.error === 'INVALID_INVITE') inviteInput.focus();
      } finally {
        submit.disabled = false;
        submit.textContent = 'Entrar';
      }
    });
  });
}
