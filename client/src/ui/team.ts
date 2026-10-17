import {
  formatBirthday,
  formatLastSeen,
  isBirthdayToday,
  nameKey,
  type CargoInfo,
  type TeamMember,
  type TeamResponse,
} from '@office/shared';
import { api } from '../net/api.js';
import { setAvatarPreview } from './login.js';
import { cargoPill } from './profile.js';

export interface TeamOptions {
  token: string;
  userId: string;
  isAdmin: boolean;
  /** roomId → nome da sala. */
  roomName(roomId: string): string;
  /** Recebeu a lista (para o cartão do avatar reaproveitar bio e aniversário). */
  loaded(team: TeamResponse): void;
}

/** Aba "Equipe": todas as pessoas, por cargo, online ou não. */
export function openTeam(opts: TeamOptions): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="sheet sheet-wide" role="dialog" aria-modal="true" aria-labelledby="team-title">
      <header class="sheet-head">
        <h2 id="team-title">Equipe</h2>
        <input class="team-search" type="search" placeholder="Buscar por nome, usuário ou cargo" aria-label="Buscar na equipe" />
        <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
      </header>
      <div class="sheet-body team-body"><p class="muted">Carregando…</p></div>
    </section>`;
  document.body.append(backdrop);
  const body = backdrop.querySelector<HTMLElement>('.team-body')!;
  const search = backdrop.querySelector<HTMLInputElement>('.team-search')!;

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
  backdrop.querySelector('.sheet-close')!.addEventListener('click', close);

  let team: TeamResponse | null = null;
  const load = async () => {
    try {
      team = await api.team(opts.token);
      opts.loaded(team);
      render();
    } catch (err) {
      body.replaceChildren(
        Object.assign(document.createElement('p'), {
          className: 'login-error',
          textContent: (err as Error).message,
        }),
      );
    }
  };

  function render(): void {
    if (!team) return;
    const q = nameKey(search.value);
    const match = (m: TeamMember) =>
      !q || [m.name, m.username ?? '', m.cargo?.name ?? ''].some((t) => nameKey(t).includes(q));
    const groups: { title: string; color?: string; members: TeamMember[] }[] = [
      ...team.cargos.map((c) => ({
        title: c.name,
        color: c.color,
        members: team!.members.filter((m) => m.cargo?.id === c.id),
      })),
      { title: 'Sem cargo', members: team.members.filter((m) => !m.cargo) },
    ];
    const online = team.members.filter((m) => m.roomId).length;
    const nodes: HTMLElement[] = [
      Object.assign(document.createElement('p'), {
        className: 'muted team-summary',
        textContent: `${team.members.length} pessoas · ${online} online agora`,
      }),
    ];
    for (const g of groups) {
      const members = g.members.filter(match).sort(byPresenceThenName);
      if (members.length === 0) continue;
      const h = document.createElement('h3');
      h.className = 'team-group';
      h.append(cargoPill(g.title, g.color), ` ${members.length}`);
      const ul = Object.assign(document.createElement('ul'), { className: 'team-list' });
      ul.append(...members.map((m) => row(m, team!.cargos)));
      nodes.push(h, ul);
    }
    if (nodes.length === 1) {
      nodes.push(
        Object.assign(document.createElement('p'), { textContent: 'Ninguém encontrado.' }),
      );
    }
    body.replaceChildren(...nodes);
  }

  function row(m: TeamMember, cargos: CargoInfo[]): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'team-member';
    li.dataset.online = String(Boolean(m.roomId));

    const face = Object.assign(document.createElement('div'), { className: 'team-face' });
    const img = Object.assign(document.createElement('img'), { alt: '', width: 64, height: 110 });
    setAvatarPreview(img, m.figure);
    face.append(img);

    const info = Object.assign(document.createElement('div'), { className: 'team-info' });
    const title = document.createElement('p');
    title.className = 'team-name';
    title.append(m.name);
    if (m.userId === opts.userId) title.append(tag('você'));
    if (m.role === 'admin') title.append(tag('admin'));
    const meta = Object.assign(document.createElement('p'), { className: 'muted team-meta' });
    const where = m.roomId
      ? `● online · ${opts.roomName(m.roomId)}`
      : `visto ${formatLastSeen(m.lastSeenAt)}`;
    meta.textContent = [m.username ? `@${m.username}` : null, where].filter(Boolean).join(' · ');
    info.append(title, meta);
    if (m.bio) {
      info.append(
        Object.assign(document.createElement('p'), { className: 'team-bio', textContent: m.bio }),
      );
    }
    if (m.birthday) {
      const today = isBirthdayToday(m.birthday);
      info.append(
        Object.assign(document.createElement('p'), {
          className: today ? 'team-birthday today' : 'team-birthday muted',
          textContent: today ? '🎂 Aniversário hoje!' : `🎂 ${formatBirthday(m.birthday)}`,
        }),
      );
    }
    li.append(face, info);

    if (opts.isAdmin) {
      const select = document.createElement('select');
      select.className = 'team-cargo';
      select.setAttribute('aria-label', `Cargo de ${m.name}`);
      select.append(new Option('Sem cargo', ''));
      for (const c of cargos) select.append(new Option(c.name, String(c.id)));
      select.value = m.cargo ? String(m.cargo.id) : '';
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await api.assignCargo(opts.token, m.userId, select.value ? Number(select.value) : null);
          await load();
        } catch (err) {
          select.value = m.cargo ? String(m.cargo.id) : '';
          alert((err as Error).message);
        } finally {
          select.disabled = false;
        }
      });
      li.append(select);
    }
    return li;
  }

  search.addEventListener('input', render);
  search.focus();
  void load();
}

function byPresenceThenName(a: TeamMember, b: TeamMember): number {
  return (
    Number(Boolean(b.roomId)) - Number(Boolean(a.roomId)) || a.name.localeCompare(b.name, 'pt-BR')
  );
}

function tag(text: string): HTMLSpanElement {
  return Object.assign(document.createElement('span'), { className: 'tag', textContent: text });
}
