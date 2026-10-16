import {
  avatarImageUrl,
  NAME_MAX,
  validateFigure,
  type AvatarManifest,
  type Gender,
  type SessionResponse,
} from '@office/shared';
import { ApiRequestError, createSession } from '../net/api.js';
import { loadSession, saveSession } from '../net/storage.js';
import { openAvatarEditor } from './avatarEditor.js';

export interface LoginOptions {
  manifest: AvatarManifest;
  fallbackPreview: (figure: string, dir: number) => Promise<string>;
  notice?: string;
}

/**
 * Tela de entrada: nome, código de convite e visual (editor de avatar). Se o navegador já
 * tem um token válido, o código é opcional. Resolve com a sessão criada pelo servidor.
 */
export function showLogin(opts: LoginOptions): Promise<SessionResponse> {
  const stored = loadSession();
  let gender: Gender = stored?.gender ?? 'M';
  let figure = stored?.figure ?? opts.manifest.defaults[gender];
  // Visual salvo de uma versão antiga do manifesto: volta para o padrão.
  if (!validateFigure(figure, gender, opts.manifest).ok) figure = opts.manifest.defaults[gender];

  const backdrop = document.createElement('div');
  backdrop.className = 'login-backdrop';
  backdrop.innerHTML = `
    <form class="login-card" novalidate>
      <h1>Escritório Virtual</h1>
      <p class="login-sub">Entre para encontrar o pessoal.</p>
      <div class="login-avatar"><img alt="Prévia do seu avatar" width="64" height="110" /></div>
      <button type="button" class="btn-secondary login-edit">Editar visual</button>
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
    </form>`;
  document.body.append(backdrop);

  const form = backdrop.querySelector('form')!;
  const nameInput = form.querySelector<HTMLInputElement>('input[name=name]')!;
  const inviteInput = form.querySelector<HTMLInputElement>('input[name=invite]')!;
  const hint = form.querySelector<HTMLElement>('.field-hint')!;
  const errorBox = form.querySelector<HTMLElement>('.login-error')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const editBtn = form.querySelector<HTMLButtonElement>('.login-edit')!;
  const img = form.querySelector('img')!;

  /** Prévia: proxy do servidor → imager direto → avatar provisório gerado por código. */
  function renderPreview(): void {
    const f = figure;
    const sources = [
      avatarImageUrl(f, { direction: 3 }, '/hh'),
      avatarImageUrl(f, { direction: 3 }),
    ];
    img.onerror = () => {
      const next = sources.shift();
      if (next) img.src = next;
      else {
        img.onerror = null;
        void opts.fallbackPreview(f, 3).then((url) => {
          if (f === figure) img.src = url;
        });
      }
    };
    img.src = sources.shift()!;
  }
  renderPreview();

  editBtn.addEventListener('click', async () => {
    const choice = await openAvatarEditor({
      manifest: opts.manifest,
      figure,
      gender,
      fallbackPreview: opts.fallbackPreview,
      saveLabel: 'Usar este visual',
    });
    if (!choice) return;
    figure = choice.figure;
    gender = choice.gender;
    saveSession({ ...(loadSession() ?? { name: nameInput.value }), figure, gender });
    renderPreview();
  });

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
      if (nameInput.value.trim().length < 2) {
        return showError('Digite seu nome (pelo menos 2 letras).');
      }
      submit.disabled = true;
      submit.textContent = 'Entrando…';
      try {
        const session = await createSession({
          name: nameInput.value,
          inviteCode: inviteInput.value || undefined,
          figure,
          gender,
          token: loadSession()?.token,
        });
        saveSession({
          name: session.name,
          figure: session.figure,
          gender: session.gender,
          token: session.token,
        });
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
