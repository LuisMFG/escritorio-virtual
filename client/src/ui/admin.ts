import {
  AUDIT_LABELS,
  formatLastSeen,
  RECEPTION,
  type AdminOverview,
  type AdminUser,
  type AuditEntry,
  type BackupList,
} from '@office/shared';
import { adminApi } from '../net/api.js';
import { confirmDialog } from './confirm.js';
import { setAvatarPreview } from './login.js';
import { cargoPill } from './profile.js';

export interface AdminOptions {
  token: string;
  userId: string;
  roomName(roomId: string): string;
}

type Tab = 'people' | 'cargos' | 'settings' | 'backups' | 'audit';
const TABS: [Tab, string][] = [
  ['people', 'Pessoas'],
  ['cargos', 'Cargos'],
  ['settings', 'Convite e salas'],
  ['backups', 'Backups'],
  ['audit', 'Registro'],
];

const timeFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** Painel Admin: pessoas, cargos, convite, travas de decoração e registro de ações. */
export function openAdmin(opts: AdminOptions): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="sheet sheet-wide admin" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <header class="sheet-head">
        <h2 id="admin-title">Admin</h2>
        <div class="admin-tabs" role="tablist"></div>
        <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
      </header>
      <p class="admin-flash" role="status" hidden></p>
      <div class="sheet-body admin-body"><p class="muted">Carregando…</p></div>
    </section>`;
  document.body.append(backdrop);
  const body = backdrop.querySelector<HTMLElement>('.admin-body')!;
  const flashBox = backdrop.querySelector<HTMLElement>('.admin-flash')!;
  const tabBar = backdrop.querySelector<HTMLElement>('.admin-tabs')!;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    // Esc com um diálogo de confirmação aberto fecha só o diálogo.
    if (e.key === 'Escape' && !document.querySelector('.confirm-backdrop')) close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('.sheet-close')!.addEventListener('click', close);

  let tab: Tab = 'people';
  let data: AdminOverview | null = null;
  let audit: AuditEntry[] = [];
  let backups: BackupList | null = null;
  let flashTimer = 0;
  /** Caixa da senha temporária: fica no topo até o admin fechar (sobrevive a recarregar). */
  let tempBox: HTMLElement | null = null;

  const flash = (message: string, error = false) => {
    flashBox.hidden = false;
    flashBox.textContent = message;
    flashBox.classList.toggle('error', error);
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (flashBox.hidden = true), error ? 6000 : 3000);
  };

  /** Faz a ação, mostra o resultado e recarrega o painel. */
  const act = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) flash(success);
    } catch (err) {
      flash((err as Error).message, true);
    }
    await load();
  };

  async function load(): Promise<void> {
    try {
      data = await adminApi.overview(opts.token);
      if (tab === 'audit') audit = await adminApi.audit(opts.token);
      if (tab === 'backups') backups = await adminApi.backups(opts.token);
      render();
    } catch (err) {
      body.replaceChildren(el('p', 'login-error', (err as Error).message));
    }
  }

  for (const [id, label] of TABS) {
    const b = el('button', '', label) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.tab = id;
    b.addEventListener('click', () => {
      tab = id;
      void load();
    });
    tabBar.append(b);
  }

  function render(): void {
    if (!data) return;
    for (const b of tabBar.querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    const views: Record<Tab, () => HTMLElement[]> = {
      people: () => renderPeople(data!),
      cargos: () => renderCargos(data!),
      settings: () => renderSettings(data!),
      backups: () => renderBackups(),
      audit: () => renderAudit(),
    };
    body.replaceChildren(...(tempBox ? [tempBox] : []), ...views[tab]());
  }

  // ---------- Pessoas ----------

  function renderPeople(d: AdminOverview): HTMLElement[] {
    const ul = el('ul', 'team-list');
    const people = [...d.users].sort(
      (a, b) =>
        Number(a.disabled) - Number(b.disabled) ||
        Number(Boolean(b.roomId)) - Number(Boolean(a.roomId)) ||
        a.name.localeCompare(b.name, 'pt-BR'),
    );
    for (const u of people) ul.append(personRow(u, d));
    return [
      el('p', 'muted', 'Papel, cargo, senha temporária, desativar a conta ou tirar alguém online.'),
      ul,
    ];
  }

  function personRow(u: AdminUser, d: AdminOverview): HTMLLIElement {
    const li = el('li', 'team-member admin-person') as HTMLLIElement;
    li.dataset.online = String(Boolean(u.roomId));
    if (u.disabled) li.classList.add('disabled');
    const self = u.userId === opts.userId;

    const face = el('div', 'team-face');
    const img = Object.assign(document.createElement('img'), { alt: '', width: 64, height: 110 });
    setAvatarPreview(img, u.figure);
    face.append(img);

    const info = el('div', 'team-info');
    const title = el('p', 'team-name', u.name);
    if (self) title.append(tag('você'));
    if (u.disabled) title.append(tag('desativada'));
    const where = u.roomId
      ? `● online · ${opts.roomName(u.roomId)}`
      : `visto ${formatLastSeen(u.lastSeenAt)}`;
    info.append(
      title,
      el(
        'p',
        'muted team-meta',
        [u.username ? `@${u.username}` : 'sem usuário', where].join(' · '),
      ),
    );

    const controls = el('div', 'admin-controls');
    const role = document.createElement('select');
    role.setAttribute('aria-label', `Papel de ${u.name}`);
    role.append(new Option('Membro', 'member'), new Option('Admin', 'admin'));
    role.value = u.role;
    role.disabled = u.fixedAdmin || !u.username;
    if (u.fixedAdmin) role.title = 'Admin fixo pelo ADMIN_USERNAMES do servidor.';
    role.addEventListener('change', () =>
      act(
        () => adminApi.updateUser(opts.token, u.userId, { role: role.value as AdminUser['role'] }),
        `${u.name} agora é ${role.value === 'admin' ? 'admin' : 'membro'}.`,
      ),
    );

    const cargo = document.createElement('select');
    cargo.setAttribute('aria-label', `Cargo de ${u.name}`);
    cargo.append(new Option('Sem cargo', ''));
    for (const c of d.cargos) cargo.append(new Option(c.name, String(c.id)));
    cargo.value = u.cargo ? String(u.cargo.id) : '';
    cargo.addEventListener('change', () =>
      act(() =>
        adminApi.updateUser(opts.token, u.userId, {
          cargoId: cargo.value ? Number(cargo.value) : null,
        }),
      ),
    );
    const rooms = document.createElement('label');
    rooms.className = 'admin-check';
    const roomsBox = Object.assign(document.createElement('input'), {
      type: 'checkbox',
      checked: u.role === 'admin' || u.canEditRooms,
      disabled: u.role === 'admin' || !u.username,
    });
    if (u.role === 'admin') rooms.title = 'Admins sempre podem editar salas.';
    roomsBox.addEventListener('change', () =>
      act(
        () => adminApi.updateUser(opts.token, u.userId, { canEditRooms: roomsBox.checked }),
        roomsBox.checked
          ? `${u.name} agora pode criar e editar salas.`
          : `${u.name} não edita mais salas.`,
      ),
    );
    rooms.append(roomsBox, ' Edita salas');
    controls.append(role, cargo, rooms);

    const buttons = el('div', 'admin-buttons');
    if (u.username) {
      buttons.append(
        button('Senha temporária', async () => {
          const yes = await confirmDialog(
            `Gerar uma senha temporária para ${u.name}? A senha atual deixa de valer e os aparelhos dessa pessoa saem da conta.`,
            { confirmLabel: 'Gerar senha' },
          );
          if (!yes) return;
          try {
            const res = await adminApi.resetPassword(opts.token, u.userId);
            showTempPassword(u, res.password);
          } catch (err) {
            flash((err as Error).message, true);
          }
        }),
      );
    }
    if (!self && u.roomId) {
      if (u.roomId !== RECEPTION.id) {
        buttons.append(
          button('Tirar da sala', () =>
            act(
              () => adminApi.kick(opts.token, u.userId, 'room'),
              `${u.name} foi para a Recepção.`,
            ),
          ),
        );
      }
      buttons.append(
        button('Tirar do escritório', async () => {
          const yes = await confirmDialog(
            `Tirar ${u.name} do escritório? A pessoa precisará entrar de novo com usuário e senha.`,
            { confirmLabel: 'Tirar', danger: true },
          );
          if (yes)
            await act(() => adminApi.kick(opts.token, u.userId, 'office'), `${u.name} saiu.`);
        }),
      );
    }
    if (!self) {
      buttons.append(
        button(u.disabled ? 'Reativar' : 'Desativar', async () => {
          if (!u.disabled) {
            const yes = await confirmDialog(
              `Desativar a conta de ${u.name}? A pessoa sai na hora e não consegue mais entrar até ser reativada.`,
              { confirmLabel: 'Desativar', danger: true },
            );
            if (!yes) return;
          }
          await act(
            () => adminApi.updateUser(opts.token, u.userId, { disabled: !u.disabled }),
            u.disabled ? `Conta de ${u.name} reativada.` : `Conta de ${u.name} desativada.`,
          );
        }),
      );
    }
    controls.append(buttons);
    li.append(face, info, controls);
    return li;
  }

  function showTempPassword(u: AdminUser, password: string): void {
    const box = el('div', 'temp-password');
    box.append(
      el('p', '', `Senha temporária de ${u.name} (@${u.username}):`),
      el('code', '', password),
      el(
        'p',
        'muted',
        'Anote e passe para a pessoa: ela não aparece de novo. Depois, ela pode trocar em Perfil.',
      ),
    );
    const copy = button('Copiar', () => {
      void navigator.clipboard?.writeText(password).then(() => (copy.textContent = 'Copiada ✓'));
    });
    const dismiss = button('Já anotei', () => {
      tempBox = null;
      box.remove();
    });
    const row = el('div', 'admin-buttons');
    row.append(copy, dismiss);
    box.append(row);
    tempBox = box;
    render();
  }

  // ---------- Cargos ----------

  function renderCargos(d: AdminOverview): HTMLElement[] {
    const holders = (id: number) => d.users.filter((u) => u.cargo?.id === id).length;
    const ul = el('ul', 'cargo-list');
    d.cargos.forEach((c, i) => {
      const li = el('li', 'cargo-row');
      const color = Object.assign(document.createElement('input'), {
        type: 'color',
        value: c.color,
      });
      color.setAttribute('aria-label', `Cor de ${c.name}`);
      color.addEventListener('change', () =>
        act(() => adminApi.updateCargo(opts.token, c.id, { color: color.value })),
      );
      const name = Object.assign(document.createElement('input'), { value: c.name, maxLength: 40 });
      name.setAttribute('aria-label', 'Nome do cargo');
      name.addEventListener('change', () =>
        act(() => adminApi.updateCargo(opts.token, c.id, { name: name.value }), 'Cargo renomeado.'),
      );
      const move = (delta: number) => {
        const ids = d.cargos.map((x) => x.id);
        const j = i + delta;
        [ids[i], ids[j]] = [ids[j]!, ids[i]!];
        void act(() => adminApi.reorderCargos(opts.token, ids));
      };
      const up = button('↑', () => move(-1));
      up.disabled = i === 0;
      up.setAttribute('aria-label', `Subir ${c.name}`);
      const down = button('↓', () => move(1));
      down.disabled = i === d.cargos.length - 1;
      down.setAttribute('aria-label', `Descer ${c.name}`);
      const del = button('Apagar', async () => {
        const n = holders(c.id);
        const yes = await confirmDialog(
          n > 0
            ? `Apagar o cargo "${c.name}"? ${n} pessoa(s) ficarão sem cargo.`
            : `Apagar o cargo "${c.name}"?`,
          { confirmLabel: 'Apagar', danger: true },
        );
        if (yes) await act(() => adminApi.deleteCargo(opts.token, c.id), 'Cargo apagado.');
      });
      li.append(
        color,
        name,
        cargoPill(c.name, c.color),
        el('span', 'muted', `${holders(c.id)}`),
        up,
        down,
        del,
      );
      ul.append(li);
    });

    const form = document.createElement('form');
    form.className = 'cargo-new';
    const newColor = Object.assign(document.createElement('input'), {
      type: 'color',
      value: '#94a3b8',
    });
    newColor.setAttribute('aria-label', 'Cor do novo cargo');
    const newName = Object.assign(document.createElement('input'), {
      placeholder: 'Novo cargo (ex.: Analista)',
      maxLength: 40,
    });
    newName.setAttribute('aria-label', 'Nome do novo cargo');
    const add = Object.assign(document.createElement('button'), {
      type: 'submit',
      className: 'btn-primary',
      textContent: 'Adicionar',
    });
    form.append(newColor, newName, add);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void act(
        () => adminApi.createCargo(opts.token, newName.value, newColor.value),
        'Cargo criado.',
      );
    });
    return [
      el(
        'p',
        'muted',
        'A ordem aqui é a ordem dos grupos na Equipe. O número é quantas pessoas têm o cargo.',
      ),
      ul,
      form,
    ];
  }

  // ---------- Convite e salas ----------

  function renderSettings(d: AdminOverview): HTMLElement[] {
    const inviteForm = document.createElement('form');
    inviteForm.className = 'invite-form';
    const input = Object.assign(document.createElement('input'), {
      value: d.inviteCode,
      maxLength: 100,
      spellcheck: false,
    });
    input.setAttribute('aria-label', 'Código de convite');
    const random = button('Gerar outro', () => {
      const words = ['sala', 'cafe', 'mesa', 'porta', 'janela', 'planta', 'quadro', 'agenda'];
      const w = () => words[Math.floor(Math.random() * words.length)];
      input.value = `${w()}-${w()}-${Math.floor(100 + Math.random() * 900)}`;
      input.focus();
    });
    const save = Object.assign(document.createElement('button'), {
      type: 'submit',
      className: 'btn-primary',
      textContent: 'Salvar convite',
    });
    inviteForm.append(input, random, save);
    inviteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void act(
        () => adminApi.setInvite(opts.token, input.value),
        'Código de convite trocado. O antigo não cria mais contas.',
      );
    });

    const rooms = el('ul', 'room-locks');
    for (const r of d.rooms) {
      const li = el('li', '');
      const label = document.createElement('label');
      const box = Object.assign(document.createElement('input'), {
        type: 'checkbox',
        checked: r.decorLocked,
      });
      box.addEventListener('change', () =>
        act(
          () => adminApi.setRoom(opts.token, r.id, box.checked),
          box.checked ? `${r.name}: só admins decoram.` : `${r.name}: todos decoram.`,
        ),
      );
      label.append(box, ` ${r.name} — só admins decoram`);
      li.append(label);
      rooms.append(li);
    }

    // Jira Cloud: endereço do site (cada pessoa conecta a própria conta no Perfil).
    const jiraForm = document.createElement('form');
    jiraForm.className = 'invite-form';
    const jiraInput = Object.assign(document.createElement('input'), {
      value: d.jiraSite?.replace(/^https:\/\//, '') ?? '',
      maxLength: 200,
      spellcheck: false,
      placeholder: 'suaempresa.atlassian.net',
      disabled: d.jiraSiteLocked,
    });
    jiraInput.setAttribute('aria-label', 'Endereço do Jira');
    const jiraSave = Object.assign(document.createElement('button'), {
      type: 'submit',
      className: 'btn-primary',
      textContent: 'Salvar Jira',
      disabled: d.jiraSiteLocked,
    });
    jiraForm.append(jiraInput, jiraSave);
    jiraForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void act(
        () => adminApi.setJiraSite(opts.token, jiraInput.value),
        jiraInput.value.trim()
          ? 'Endereço do Jira salvo. Cada pessoa conecta a própria conta no Perfil.'
          : 'Integração com o Jira desligada.',
      );
    });

    return [
      el('h3', 'admin-section', 'Código de convite'),
      el(
        'p',
        'muted',
        'Pedido só para criar conta. Quem já tem conta continua entrando normalmente.',
      ),
      inviteForm,
      el('h3', 'admin-section', 'Decoração por sala'),
      rooms,
      el('h3', 'admin-section', 'Jira Cloud'),
      el(
        'p',
        'muted',
        d.jiraSiteLocked
          ? 'Definido no servidor (JIRA_SITE). Para mudar, altere o .env.'
          : 'Endereço do Jira da empresa. Vazio desliga. Cada pessoa conecta a própria conta no Perfil (e-mail + token de API).',
      ),
      jiraForm,
    ];
  }

  // ---------- Registro ----------

  // ---------- Backups ----------

  function renderBackups(): HTMLElement[] {
    if (!backups) return [el('p', 'muted', 'Carregando…')];
    const intro = el(
      'p',
      'muted backup-intro',
      `Backup automático do banco todo dia às ${backups.dailyHour}h (horário de Brasília), guardando os últimos ${backups.keep}. Para restaurar, veja o README (seção Backups).`,
    );
    const now = button('Fazer backup agora', () =>
      act(() => adminApi.createBackup(opts.token), 'Backup feito.'),
    );
    now.className = 'btn-primary btn-small backup-now';
    if (backups.backups.length === 0) {
      return [intro, now, el('p', 'muted', 'Nenhum backup ainda.')];
    }
    const ul = el('ul', 'backup-list');
    for (const b of backups.backups) {
      const li = el('li', '');
      const kb =
        b.size >= 1024 * 1024
          ? `${(b.size / 1024 / 1024).toFixed(1)} MB`
          : `${Math.ceil(b.size / 1024)} KB`;
      const download = button('Baixar', async () => {
        try {
          await adminApi.downloadBackup(opts.token, b.name);
        } catch (err) {
          flash((err as Error).message, true);
        }
      });
      li.append(
        el('span', 'backup-name', b.name),
        el('time', 'muted', timeFormat.format(b.createdAt)),
        el('span', 'muted', kb),
        download,
      );
      ul.append(li);
    }
    return [intro, now, ul];
  }

  function renderAudit(): HTMLElement[] {
    if (audit.length === 0) return [el('p', 'muted', 'Nenhuma ação registrada ainda.')];
    const ul = el('ul', 'audit-list');
    for (const a of audit) {
      const li = el('li', '');
      const what = [a.actorName, AUDIT_LABELS[a.action] ?? a.action, a.targetName]
        .filter(Boolean)
        .join(' ');
      li.append(el('time', 'muted', timeFormat.format(a.at)), ' ', el('span', '', what));
      if (a.details) li.append(el('span', 'muted', ` · ${a.details}`));
      ul.append(li);
    }
    return [ul];
  }

  render();
  void load();
}

function el(tagName: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tag(text: string): HTMLElement {
  return el('span', 'tag', text);
}

function button(text: string, onClick: () => unknown): HTMLButtonElement {
  const b = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'btn-secondary btn-small',
    textContent: text,
  });
  b.addEventListener('click', () => void onClick());
  return b;
}
