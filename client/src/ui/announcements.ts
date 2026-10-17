import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, type Announcement } from '@office/shared';
import { announcementApi } from '../net/api.js';
import { confirmDialog } from './confirm.js';

const when = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

/**
 * Faixa no topo com os avisos que a pessoa ainda não leu, um de cada vez. "Li" marca como lido
 * (no servidor) e mostra o próximo.
 */
export class AnnouncementBanner {
  private queue: Announcement[] = [];
  private box: HTMLElement | null = null;

  constructor(
    private readonly token: () => string,
    private readonly openHistory: () => void,
    private readonly unreadChanged: (n: number) => void,
  ) {}

  /** Lista inicial (não lidos do servidor). */
  set(list: Announcement[]): void {
    this.queue = [...list];
    this.render();
  }

  add(a: Announcement): void {
    if (this.queue.some((x) => x.id === a.id)) return;
    // Urgente passa na frente.
    if (a.urgent) this.queue.unshift(a);
    else this.queue.push(a);
    this.render();
  }

  remove(id: number): void {
    this.queue = this.queue.filter((a) => a.id !== id);
    this.render();
  }

  /** Marcado como lido em outro lugar (painel de avisos). */
  markedRead(id: number): void {
    this.remove(id);
  }

  get unread(): number {
    return this.queue.length;
  }

  private render(): void {
    this.unreadChanged(this.queue.length);
    this.box?.remove();
    this.box = null;
    const a = this.queue[0];
    if (!a) return;
    const box = el('section', {
      className: `announcement-banner${a.urgent ? ' urgent' : ''}`,
    });
    box.setAttribute('role', a.urgent ? 'alert' : 'status');
    box.setAttribute('aria-label', `Aviso da diretoria: ${a.title}`);
    const text = el('div', { className: 'announcement-text' });
    text.append(
      el('small', {
        textContent: `${a.urgent ? '🚨 Aviso urgente' : '📢 Aviso da diretoria'} · ${a.createdByName} · ${when.format(a.createdAt)}`,
      }),
      el('strong', { textContent: a.title }),
      el('p', { textContent: a.body }),
    );
    const actions = el('div', { className: 'announcement-actions' });
    const read = el('button', {
      type: 'button',
      className: 'btn-primary btn-small',
      textContent: 'Li',
    });
    read.addEventListener('click', async () => {
      read.disabled = true;
      try {
        await announcementApi.read(this.token(), a.id);
      } catch {
        // marca localmente mesmo assim; volta na próxima entrada se não gravou
      }
      this.remove(a.id);
    });
    actions.append(read);
    if (this.queue.length > 1) {
      const more = el('button', {
        type: 'button',
        className: 'btn-link',
        textContent: `Ver todos (${this.queue.length})`,
      });
      more.addEventListener('click', () => this.openHistory());
      actions.append(more);
    }
    box.append(text, actions);
    document.body.append(box);
    this.box = box;
  }
}

export interface AnnouncementsPanelOptions {
  token: string;
  isAdmin: boolean;
  /** Avisa a faixa que um aviso foi lido aqui. */
  onRead(id: number): void;
}

/** Painel "Avisos": histórico para todos; publicar e apagar para admins. */
export function openAnnouncements(opts: AnnouncementsPanelOptions): {
  refresh(): void;
  close(): void;
} {
  const backdrop = el('div', { className: 'modal-backdrop' });
  backdrop.innerHTML = `
    <section class="sheet sheet-wide announcements" role="dialog" aria-modal="true" aria-labelledby="ann-title">
      <header class="sheet-head">
        <h2 id="ann-title">📢 Avisos da diretoria</h2>
        <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
      </header>
      <div class="sheet-body"></div>
    </section>`;
  document.body.append(backdrop);
  const body = backdrop.querySelector<HTMLElement>('.sheet-body')!;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !document.querySelector('.confirm-backdrop')) close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('.sheet-close')!.addEventListener('click', close);

  const form = (): HTMLElement => {
    const f = el('form', { className: 'announcement-form', noValidate: true });
    f.innerHTML = `
      <h3>Publicar aviso</h3>
      <label class="field"><span>Título</span><input name="title" maxlength="${ANNOUNCEMENT_TITLE_MAX}" placeholder="Ex.: Ponto facultativo na sexta" /></label>
      <label class="field"><span>Aviso</span><textarea name="body" rows="3" maxlength="${ANNOUNCEMENT_BODY_MAX}"></textarea></label>
      <label class="announcement-urgent"><input type="checkbox" name="urgent" /> Urgente (aparece primeiro e vira notificação do sistema)</label>
      <p class="login-error" role="alert" hidden></p>
      <button type="submit" class="btn-primary">Publicar para todos</button>`;
    f.addEventListener('keydown', (e) => e.stopPropagation());
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = f.querySelector<HTMLElement>('.login-error')!;
      err.hidden = true;
      const title = f.querySelector<HTMLInputElement>('input[name=title]')!;
      const text = f.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
      const urgent = f.querySelector<HTMLInputElement>('input[name=urgent]')!;
      try {
        await announcementApi.create(opts.token, {
          title: title.value,
          body: text.value,
          urgent: urgent.checked,
        });
        title.value = text.value = '';
        urgent.checked = false;
        await load();
      } catch (error) {
        err.hidden = false;
        err.textContent = (error as Error).message;
      }
    });
    return f;
  };

  const item = (a: Announcement): HTMLElement => {
    const art = el('article', {
      className: `announcement-item${a.urgent ? ' urgent' : ''}${a.read ? '' : ' unread'}`,
    });
    const head = el('header');
    head.append(el('strong', { textContent: `${a.urgent ? '🚨 ' : ''}${a.title}` }));
    if (!a.read) head.append(el('span', { className: 'tag', textContent: 'novo' }));
    art.append(
      head,
      el('p', { textContent: a.body }),
      el('small', {
        className: 'muted',
        textContent: `${a.createdByName} · ${when.format(a.createdAt)}${opts.isAdmin ? ` · lido por ${a.readCount}` : ''}`,
      }),
    );
    const actions = el('div', { className: 'announcement-actions' });
    if (!a.read) {
      const read = el('button', {
        type: 'button',
        className: 'btn-secondary btn-small',
        textContent: 'Li',
      });
      read.addEventListener('click', async () => {
        await announcementApi.read(opts.token, a.id);
        opts.onRead(a.id);
        await load();
      });
      actions.append(read);
    }
    if (opts.isAdmin) {
      const del = el('button', { type: 'button', className: 'btn-link', textContent: 'Apagar' });
      del.addEventListener('click', async () => {
        const yes = await confirmDialog(`Apagar o aviso “${a.title}” para todos?`, {
          confirmLabel: 'Apagar',
          danger: true,
        });
        if (!yes) return;
        await announcementApi.remove(opts.token, a.id);
        await load();
      });
      actions.append(del);
    }
    if (actions.children.length) art.append(actions);
    return art;
  };

  let formBox: HTMLElement | null = opts.isAdmin ? form() : null;
  const load = async () => {
    try {
      const list = await announcementApi.list(opts.token);
      const nodes: HTMLElement[] = formBox ? [formBox] : [];
      nodes.push(
        list.length
          ? el('div', { className: 'announcement-list' })
          : el('p', { className: 'muted', textContent: 'Nenhum aviso ainda.' }),
      );
      if (list.length) nodes.at(-1)!.append(...list.map(item));
      body.replaceChildren(...nodes);
    } catch (err) {
      body.replaceChildren(
        el('p', { className: 'login-error', textContent: (err as Error).message }),
      );
    }
  };
  void load();
  return {
    refresh: () => void load(),
    close: () => {
      formBox = null;
      close();
    },
  };
}
