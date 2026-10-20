import { OFFLINE_ASSETS } from '../config.js';
import {
  avatarImageUrl,
  NAME_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  validateFigure,
  type AvatarManifest,
  type Gender,
  type SessionResponse,
} from '@office/shared';
import { api, ApiRequestError } from '../net/api.js';
import { loadSession, rememberSession, saveSession } from '../net/storage.js';
import { openAvatarEditor } from './avatarEditor.js';
import { motionReduced } from './prefs.js';
import { markTourPending } from './tour.js';

/** Campo do formulário que cada erro do servidor aponta. */
const ERROR_FIELDS: Record<string, string> = {
  INVALID_INVITE: 'invite',
  USERNAME_TAKEN: 'username',
  NAME_IN_USE: 'name',
  INVALID_CREDENTIALS: 'password',
};
/** Nome no servidor → nome do campo aqui. */
const PAYLOAD_FIELDS: Record<string, string> = { inviteCode: 'invite' };

export interface LoginOptions {
  manifest: AvatarManifest;
  fallbackPreview: (figure: string, dir: number) => Promise<string>;
  notice?: string;
}

type Mode = 'login' | 'register';

/**
 * Tela de entrada. **Entrar**: usuário e senha (qualquer aparelho). **Criar conta**: código
 * de convite, nome exibido, usuário, senha e visual. Resolve com a sessão do servidor.
 */
export function showLogin(opts: LoginOptions): Promise<SessionResponse> {
  const stored = loadSession();
  let gender: Gender = stored?.gender ?? 'M';
  let figure = stored?.figure ?? opts.manifest.defaults[gender];
  // Visual salvo de uma versão antiga do manifesto: volta para o padrão.
  if (!validateFigure(figure, gender, opts.manifest).ok) figure = opts.manifest.defaults[gender];
  let mode: Mode = stored ? 'login' : 'register';

  const backdrop = document.createElement('div');
  backdrop.className = 'login-backdrop';
  backdrop.innerHTML = `
    <form class="login-card" novalidate>
      <h1>Escritório Virtual</h1>
      <p class="login-sub">O escritório do pessoal em pixel art: ande pela sala, sente na sua mesa e converse com quem estiver por perto.</p>
      <div class="login-tabs" role="tablist">
        <button type="button" role="tab" data-mode="login">Entrar</button>
        <button type="button" role="tab" data-mode="register">Criar conta</button>
      </div>
      <div class="login-avatar"><img alt="Prévia do seu avatar" width="64" height="110" /></div>
      <button type="button" class="register-only btn-secondary login-edit">Editar visual</button>
      <label class="field register-only">
        <span>Código de convite</span>
        <input name="invite" autocomplete="off" />
      </label>
      <label class="field register-only">
        <span>Seu nome (aparece para todos)</span>
        <input name="name" autocomplete="nickname" maxlength="${NAME_MAX}" />
      </label>
      <label class="field">
        <span>Usuário</span>
        <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="${USERNAME_MAX}" />
        <small class="field-hint register-only">Para entrar. Letras sem acento, números, ponto, hífen ou _.</small>
      </label>
      <label class="field">
        <span>Senha</span>
        <input name="password" type="password" maxlength="128" />
        <small class="field-hint register-only">Pelo menos ${PASSWORD_MIN} caracteres.</small>
      </label>
      <p class="login-error" role="alert" hidden></p>
      <button type="submit" class="btn-primary">Entrar</button>
    </form>`;
  document.body.append(backdrop);

  const form = backdrop.querySelector('form')!;
  const input = (name: string) => form.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  const [inviteInput, nameInput, userInput, passInput] = [
    input('invite'),
    input('name'),
    input('username'),
    input('password'),
  ];
  const errorBox = form.querySelector<HTMLElement>('.login-error')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const img = form.querySelector('img')!;
  const tabs = [...form.querySelectorAll<HTMLButtonElement>('[role=tab]')];

  function setMode(next: Mode): void {
    mode = next;
    form.dataset.mode = mode;
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    for (const el of form.querySelectorAll<HTMLElement>('.register-only')) {
      el.hidden = mode !== 'register';
    }
    submit.textContent = mode === 'login' ? 'Entrar' : 'Criar conta e entrar';
    passInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    errorBox.hidden = true;
    clearFieldErrors(form);
    (mode === 'login' ? (userInput.value ? passInput : userInput) : inviteInput).focus();
  }
  for (const t of tabs) t.addEventListener('click', () => setMode(t.dataset.mode as Mode));

  // Avatar girando (parado com "reduzir movimento"); no Entrar só se o navegador lembra dele.
  let spinDir = 3;
  const renderPreview = () => setAvatarPreview(img, figure, opts.fallbackPreview, spinDir);
  renderPreview();
  img.closest<HTMLElement>('.login-avatar')!.dataset.known = String(Boolean(stored));
  const spin = motionReduced()
    ? 0
    : window.setInterval(() => {
        if (!backdrop.isConnected) return clearInterval(spin);
        spinDir = (spinDir + 7) % 8;
        renderPreview();
      }, 900);
  for (const el of [inviteInput, nameInput, userInput, passInput]) {
    el.addEventListener('input', () => clearFieldError(el));
  }
  form.querySelector('.login-edit')!.addEventListener('click', async () => {
    const choice = await openAvatarEditor({
      manifest: opts.manifest,
      figure,
      gender,
      fallbackPreview: opts.fallbackPreview,
      thumbnails: !OFFLINE_ASSETS,
      saveLabel: 'Usar este visual',
    });
    if (!choice) return;
    ({ figure, gender } = choice);
    saveSession({ ...(loadSession() ?? { name: nameInput.value }), figure, gender });
    renderPreview();
  });

  nameInput.value = stored?.name ?? '';
  userInput.value = stored?.username ?? '';
  setMode(mode);
  if (opts.notice) showError(errorBox, opts.notice);

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      clearFieldErrors(form);
      let invalid = false;
      if (mode === 'register' && !inviteInput.value.trim()) {
        invalid =
          fieldError(inviteInput, 'Digite o código de convite que você recebeu.') || invalid;
      }
      if (mode === 'register' && nameInput.value.trim().length < 2) {
        invalid = fieldError(nameInput, 'Digite seu nome (pelo menos 2 letras).') || invalid;
      }
      if (!userInput.value.trim())
        invalid = fieldError(userInput, 'Digite seu usuário.') || invalid;
      if (!passInput.value) invalid = fieldError(passInput, 'Digite sua senha.') || invalid;
      if (invalid) {
        form.querySelector<HTMLInputElement>('[aria-invalid=true]')?.focus();
        return;
      }
      submit.disabled = true;
      const label = submit.textContent;
      submit.textContent = 'Entrando…';
      try {
        const session =
          mode === 'login'
            ? await api.login({ username: userInput.value, password: passInput.value })
            : await api.register({
                inviteCode: inviteInput.value,
                name: nameInput.value,
                username: userInput.value,
                password: passInput.value,
                figure,
                gender,
              });
        rememberSession(session);
        // Conta nova: o tour guiado começa ao chegar na sala.
        if (mode === 'register') markTourPending();
        clearInterval(spin);
        backdrop.remove();
        resolve(session);
      } catch (err) {
        const body = err instanceof ApiRequestError ? err.body : {};
        const fieldName =
          (body.error && ERROR_FIELDS[body.error]) ||
          (body.field && (PAYLOAD_FIELDS[body.field] ?? body.field));
        const field = fieldName
          ? form.querySelector<HTMLInputElement>(`input[name=${fieldName}]`)
          : null;
        if (field && !field.closest<HTMLElement>('[hidden]')) {
          fieldError(field, (err as Error).message, body.suggestion, (s) => {
            nameInput.value = s;
            form.requestSubmit();
          });
          field.focus();
          field.select();
        } else {
          showError(errorBox, (err as Error).message, body.suggestion, (s) => {
            nameInput.value = s;
            form.requestSubmit();
          });
        }
      } finally {
        submit.disabled = false;
        submit.textContent = label;
      }
    });
  });
}

/**
 * Conta antiga (entrava só pelo token deste navegador): escolhe usuário e senha uma vez,
 * para poder entrar de outros aparelhos.
 */
export function showClaim(session: SessionResponse): Promise<SessionResponse> {
  const backdrop = document.createElement('div');
  backdrop.className = 'login-backdrop';
  backdrop.innerHTML = `
    <form class="login-card" novalidate>
      <h1>Crie seu acesso</h1>
      <p class="login-sub"></p>
      <label class="field">
        <span>Usuário</span>
        <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="${USERNAME_MAX}" />
        <small class="field-hint">Letras sem acento, números, ponto, hífen ou _.</small>
      </label>
      <label class="field">
        <span>Senha</span>
        <input name="password" type="password" autocomplete="new-password" maxlength="128" />
        <small class="field-hint">Pelo menos ${PASSWORD_MIN} caracteres.</small>
      </label>
      <p class="login-error" role="alert" hidden></p>
      <button type="submit" class="btn-primary">Salvar e entrar</button>
    </form>`;
  backdrop.querySelector('.login-sub')!.textContent =
    `Oi, ${session.name}! Agora o escritório tem contas: escolha um usuário e uma senha para entrar de qualquer aparelho.`;
  document.body.append(backdrop);
  const form = backdrop.querySelector('form')!;
  const userInput = form.querySelector<HTMLInputElement>('input[name=username]')!;
  const passInput = form.querySelector<HTMLInputElement>('input[name=password]')!;
  const errorBox = form.querySelector<HTMLElement>('.login-error')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  userInput.value = session.name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.');
  userInput.focus();
  userInput.select();

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      submit.disabled = true;
      try {
        const updated = await api.claim(session.token, {
          username: userInput.value,
          password: passInput.value,
        });
        rememberSession(updated);
        backdrop.remove();
        resolve(updated);
      } catch (err) {
        showError(errorBox, (err as Error).message);
      } finally {
        submit.disabled = false;
      }
    });
  });
}

/** Prévia: proxy do servidor → imager direto → avatar provisório gerado por código. */
export function setAvatarPreview(
  img: HTMLImageElement,
  figure: string,
  fallback?: (figure: string, dir: number) => Promise<string>,
  direction = 3,
): void {
  const sources = [
    avatarImageUrl(figure, { direction }, '/hh'),
    avatarImageUrl(figure, { direction }),
  ];
  img.onerror = () => {
    const next = sources.shift();
    if (next) img.src = next;
    else {
      img.onerror = null;
      if (fallback) void fallback(figure, direction).then((url) => (img.src = url));
      else img.hidden = true;
    }
  };
  img.src = sources.shift()!;
}

function showError(
  box: HTMLElement,
  message: string,
  suggestion?: string,
  useSuggestion?: (s: string) => void,
): void {
  box.hidden = false;
  box.textContent = message;
  if (suggestion && useSuggestion) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-link';
    btn.textContent = `Usar “${suggestion}”`;
    btn.addEventListener('click', () => useSuggestion(suggestion));
    box.append(' ', btn);
  }
}

/** Erro embaixo do campo (com `aria-invalid`); some quando a pessoa digita. Devolve `true`. */
function fieldError(
  input: HTMLInputElement,
  message: string,
  suggestion?: string,
  useSuggestion?: (s: string) => void,
): boolean {
  clearFieldError(input);
  const box = Object.assign(document.createElement('small'), {
    className: 'field-error',
    id: `erro-${input.name}`,
    textContent: message,
  });
  if (suggestion && useSuggestion) {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-link',
      textContent: `Usar “${suggestion}”`,
    });
    b.addEventListener('click', () => useSuggestion(suggestion));
    box.append(' ', b);
  }
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', box.id);
  input.closest('.field')!.append(box);
  return true;
}

function clearFieldError(input: HTMLInputElement): void {
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
  input.closest('.field')?.querySelector('.field-error')?.remove();
}

function clearFieldErrors(form: HTMLElement): void {
  for (const i of form.querySelectorAll<HTMLInputElement>('input[aria-invalid]'))
    clearFieldError(i);
}
