import { BIO_MAX, NAME_MAX, PASSWORD_MIN, type SessionResponse } from '@office/shared';
import { api, ApiRequestError } from '../net/api.js';
import { setAvatarPreview } from './login.js';
import { mountPetSection } from './petSection.js';
import { mountCodeSection } from './codeSection.js';
import { mountSpotifySection } from './spotifySection.js';
import { mountJiraSection } from './jiraSection.js';
import { mountEffectsSection } from './effectsSection.js';
import { mountAchievements } from './achievementsSection.js';
import { iconHtml } from './icons.js';
import { createTabs } from './tabs.js';

/** Abas do Perfil (Fase 43). */
export type ProfileTab = 'perfil' | 'pet' | 'conquistas' | 'efeitos' | 'integracoes' | 'conta';
const TAB_KEY = 'ev-profile-tab';

export interface ProfileHandlers {
  /** O servidor aceitou as mudanças (nome, bio, aniversário). */
  saved(session: SessionResponse): void;
  editAvatar(): void;
  logout(all: boolean): void;
  /** Abre já numa aba (ex.: conquistas, vindo do aviso de conquista nova). */
  tab?: ProfileTab;
}

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Janela "Meu perfil". Fecha com Esc, clique fora ou no ✕. */
export function openProfile(session: SessionResponse, on: ProfileHandlers): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="sheet profile-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <header class="sheet-head">
        <h2 id="profile-title">Meu perfil</h2>
        <button type="button" class="sheet-close" aria-label="Fechar">${iconHtml('x')}</button>
      </header>
      <div class="sheet-body profile-body">
        <div class="profile-top">
          <img class="profile-avatar" alt="" width="64" height="110" />
          <div>
            <p class="profile-name"></p>
            <p class="muted profile-user"></p>
            <p class="profile-cargo"></p>
            <button type="button" class="btn-secondary profile-visual">Meu visual</button>
          </div>
        </div>
        <div class="profile-tabs"></div>
        <div class="profile-panel" data-tab="perfil">
        <form class="profile-form" novalidate>
          <label class="field"><span>Nome exibido</span>
            <input name="name" maxlength="${NAME_MAX}" /></label>
          <label class="field"><span>Bio <small class="muted bio-count"></small></span>
            <textarea name="bio" rows="2" maxlength="${BIO_MAX}" placeholder="Ex.: cuido dos bancos de dados e do café"></textarea></label>
          <div class="field"><span>Aniversário</span>
            <div class="birthday-row">
              <select name="day" aria-label="Dia"><option value="">Dia</option></select>
              <select name="month" aria-label="Mês"><option value="">Mês</option></select>
            </div></div>
          <p class="login-error" role="alert" hidden></p>
          <button type="submit" class="btn-primary">Salvar perfil</button>
        </form>
        </div>
        <div class="profile-panel" data-tab="pet">
          <section class="profile-pet" aria-label="Meu pet"></section>
        </div>
        <div class="profile-panel" data-tab="conquistas">
          <section class="profile-achievements" aria-label="Conquistas"></section>
        </div>
        <div class="profile-panel" data-tab="efeitos">
          <section class="profile-effects" aria-label="Efeitos"></section>
        </div>
        <div class="profile-panel" data-tab="integracoes">
          <section class="profile-code" aria-label="Editores de código"></section>
          <section class="profile-spotify" aria-label="Spotify"></section>
          <section class="profile-jira" aria-label="Jira"></section>
        </div>
        <div class="profile-panel" data-tab="conta">
        <section class="profile-password" aria-label="Trocar senha">
          <h3>Trocar senha</h3>
          <form novalidate>
            <label class="field"><span>Senha atual</span>
              <input name="current" type="password" autocomplete="current-password" /></label>
            <label class="field"><span>Nova senha</span>
              <input name="next" type="password" autocomplete="new-password" />
              <small class="field-hint">Pelo menos ${PASSWORD_MIN} caracteres. Os outros aparelhos saem da conta.</small></label>
            <p class="login-error" role="alert" hidden></p>
            <button type="submit" class="btn-secondary">Trocar senha</button>
          </form>
        </section>
        <div class="profile-exit">
          <button type="button" class="btn-secondary" data-logout="one">Sair</button>
          <button type="button" class="btn-link" data-logout="all">Sair de todos os aparelhos</button>
        </div>
        </div>
      </div>
    </section>`;
  document.body.append(backdrop);
  const $ = <T extends Element>(sel: string) => backdrop.querySelector<T>(sel)!;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  $('.sheet-close').addEventListener('click', close);

  // Abas: a última usada volta aberta (a não ser que peçam uma).
  const panel = (id: ProfileTab) => $<HTMLElement>(`.profile-panel[data-tab="${id}"]`);
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(TAB_KEY);
  } catch {
    // sem armazenamento
  }
  const tabs = createTabs(
    'Seções do perfil',
    [
      { id: 'perfil', label: 'Perfil', panel: panel('perfil') },
      { id: 'pet', label: 'Pet', panel: panel('pet') },
      { id: 'conquistas', label: 'Conquistas', panel: panel('conquistas') },
      { id: 'efeitos', label: 'Efeitos', panel: panel('efeitos') },
      { id: 'integracoes', label: 'Integrações', panel: panel('integracoes') },
      { id: 'conta', label: 'Conta', panel: panel('conta') },
    ],
    on.tab ?? saved ?? 'perfil',
    (id) => {
      try {
        sessionStorage.setItem(TAB_KEY, id);
      } catch {
        // sem armazenamento
      }
    },
  );
  $('.profile-tabs').append(tabs.el);

  // Cabeçalho: visual, nome, usuário e cargo (só leitura).
  const renderTop = (s: SessionResponse) => {
    setAvatarPreview($<HTMLImageElement>('.profile-avatar'), s.figure);
    $('.profile-name').textContent = s.name;
    $('.profile-user').textContent = `@${s.username ?? ''}${s.role === 'admin' ? ' · admin' : ''}`;
    const cargo = $<HTMLElement>('.profile-cargo');
    cargo.replaceChildren(cargoPill(s.cargo?.name ?? 'Sem cargo', s.cargo?.color));
    cargo.title = 'O cargo é definido por um administrador.';
  };
  renderTop(session);
  $('.profile-visual').addEventListener('click', () => {
    close();
    on.editAvatar();
  });

  // Formulário do perfil.
  const form = $<HTMLFormElement>('.profile-form');
  const nameInput = $<HTMLInputElement>('input[name=name]');
  const bioInput = $<HTMLTextAreaElement>('textarea[name=bio]');
  const daySel = $<HTMLSelectElement>('select[name=day]');
  const monthSel = $<HTMLSelectElement>('select[name=month]');
  for (let d = 1; d <= 31; d++) daySel.append(new Option(String(d), String(d).padStart(2, '0')));
  MONTHS.forEach((m, i) => monthSel.append(new Option(m, String(i + 1).padStart(2, '0'))));
  nameInput.value = session.name;
  bioInput.value = session.bio;
  if (session.birthday)
    [monthSel.value, daySel.value] = session.birthday.split('-') as [string, string];
  const count = $<HTMLElement>('.bio-count');
  const updateCount = () => (count.textContent = `${bioInput.value.length}/${BIO_MAX}`);
  bioInput.addEventListener('input', updateCount);
  updateCount();
  if (tabs.current === 'perfil') nameInput.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector<HTMLElement>('.login-error')!;
    err.hidden = true;
    if (Boolean(daySel.value) !== Boolean(monthSel.value)) {
      return showError(err, 'Escolha o dia e o mês (ou deixe os dois em branco).');
    }
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    button.disabled = true;
    try {
      const updated = await api.updateProfile(session.token, {
        name: nameInput.value,
        bio: bioInput.value,
        birthday: daySel.value ? `${monthSel.value}-${daySel.value}` : null,
      });
      session = updated;
      renderTop(updated);
      on.saved(updated);
      button.textContent = 'Salvo ✓';
      setTimeout(() => (button.textContent = 'Salvar perfil'), 1500);
    } catch (error) {
      const body = error instanceof ApiRequestError ? error.body : {};
      showError(
        err,
        body.suggestion ? `${body.message} Sugestão: ${body.suggestion}` : (error as Error).message,
      );
    } finally {
      button.disabled = false;
    }
  });

  mountPetSection($<HTMLElement>('.profile-pet'), session.token);
  mountCodeSection($<HTMLElement>('.profile-code'), session.token);
  mountSpotifySection($<HTMLElement>('.profile-spotify'), session.token);
  mountJiraSection($<HTMLElement>('.profile-jira'), session.token);
  mountEffectsSection($<HTMLElement>('.profile-effects'), session.token);
  void mountAchievements($<HTMLElement>('.profile-achievements'), session.token);

  // Troca de senha.
  const pwForm = $<HTMLFormElement>('.profile-password form');
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = pwForm.querySelector<HTMLElement>('.login-error')!;
    err.hidden = true;
    const current = pwForm.querySelector<HTMLInputElement>('input[name=current]')!;
    const next = pwForm.querySelector<HTMLInputElement>('input[name=next]')!;
    try {
      await api.changePassword(session.token, { current: current.value, next: next.value });
      current.value = next.value = '';
      err.hidden = false;
      err.classList.add('ok');
      err.textContent = 'Senha trocada. Os outros aparelhos precisarão entrar de novo.';
    } catch (error) {
      err.classList.remove('ok');
      showError(err, (error as Error).message);
    }
  });

  for (const b of backdrop.querySelectorAll<HTMLButtonElement>('[data-logout]')) {
    b.addEventListener('click', () => {
      close();
      on.logout(b.dataset.logout === 'all');
    });
  }
}

/** Etiqueta colorida do cargo (texto puro). */
export function cargoPill(name: string, color?: string): HTMLSpanElement {
  const pill = Object.assign(document.createElement('span'), {
    className: 'cargo-pill',
    textContent: name,
    title: name,
  });
  if (color) pill.style.setProperty('--cargo', color);
  else pill.classList.add('none');
  return pill;
}

function showError(box: HTMLElement, message: string): void {
  box.hidden = false;
  box.textContent = message;
}
