import {
  formatLastSeen,
  KUDOS_INFO,
  KUDOS_MESSAGE_MAX,
  KUDOS_TYPES,
  type Kudos,
  type KudosType,
  type TeamMember,
} from '@office/shared';
import { kudosApi } from '../net/api.js';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

/** Janela com fundo, fechada por Esc, clique fora ou ✕. */
function sheet(title: string, cls: string): { body: HTMLElement; close(): void } {
  const backdrop = el('div', { className: 'modal-backdrop' });
  backdrop.innerHTML = `
    <section class="sheet ${cls}" role="dialog" aria-modal="true">
      <header class="sheet-head"><h2></h2><button type="button" class="sheet-close" aria-label="Fechar">✕</button></header>
      <div class="sheet-body"></div>
    </section>`;
  backdrop.querySelector('h2')!.textContent = title;
  document.body.append(backdrop);
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
  return { body: backdrop.querySelector<HTMLElement>('.sheet-body')!, close };
}

/** "Elogiar Fulano": tipo do elogio + uma frase. */
export function openKudosForm(opts: {
  token: string;
  to: { userId: string; name: string };
  sent(k: Kudos): void;
}): void {
  const { body, close } = sheet(`🙌 Elogiar ${opts.to.name}`, 'kudos-form');
  let type: KudosType = 'help';
  const types = el('div', { className: 'kudos-types', role: 'radiogroup' });
  types.setAttribute('aria-label', 'Tipo de elogio');
  const draw = () => {
    types.replaceChildren(
      ...KUDOS_TYPES.map((t) => {
        const b = el('button', { type: 'button', className: 'kudos-type' });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(t === type));
        b.append(
          el('span', { className: 'emoji', textContent: KUDOS_INFO[t].emoji }),
          el('span', { textContent: KUDOS_INFO[t].label }),
        );
        b.addEventListener('click', () => {
          type = t;
          draw();
        });
        return b;
      }),
    );
  };
  draw();
  const text = el('textarea', {
    rows: 3,
    maxLength: KUDOS_MESSAGE_MAX,
    placeholder: `O que ${opts.to.name} fez? Ex.: me ajudou a resolver o problema do servidor.`,
  });
  text.setAttribute('aria-label', 'Mensagem do elogio');
  text.addEventListener('keydown', (e) => e.stopPropagation());
  const error = el('p', { className: 'login-error', hidden: true });
  const send = el('button', {
    type: 'button',
    className: 'btn-primary',
    textContent: 'Enviar elogio',
  });
  send.addEventListener('click', async () => {
    error.hidden = true;
    send.disabled = true;
    try {
      const k = await kudosApi.give(opts.token, {
        toUserId: opts.to.userId,
        type,
        message: text.value,
      });
      close();
      opts.sent(k);
    } catch (err) {
      error.hidden = false;
      error.textContent = (err as Error).message;
      send.disabled = false;
    }
  });
  body.append(types, text, error, send);
  text.focus();
}

/** Cartão de um elogio no mural. */
function kudosItem(k: Kudos): HTMLElement {
  const info = KUDOS_INFO[k.type];
  const art = el('article', { className: `kudos-item kudos-${k.type}` });
  const head = el('header');
  head.append(
    el('span', { className: 'kudos-emoji', textContent: info.emoji }),
    el('strong', { textContent: k.toName }),
    el('span', { className: 'tag', textContent: info.label }),
  );
  art.append(
    head,
    el('p', { textContent: `“${k.message}”` }),
    el('small', {
      className: 'muted',
      textContent: `de ${k.fromName} · ${formatLastSeen(k.createdAt)}`,
    }),
  );
  return art;
}

/** Mural de elogios (Quadro de Elogios da Recepção): todos ou só os seus; elogiar alguém. */
export function openKudosWall(opts: {
  token: string;
  myUserId: string;
  loadTeam(): Promise<TeamMember[]>;
  praise(to: { userId: string; name: string }): void;
}): { refresh(): void; close(): void } {
  const { body, close } = sheet('🖼️ Quadro de Elogios', 'sheet-wide kudos-wall');
  let mine = false;
  const tabs = el('div', { className: 'kudos-tabs', role: 'tablist' });
  const list = el('div', { className: 'kudos-list' });
  const picker = el('select', { className: 'kudos-picker' });
  picker.setAttribute('aria-label', 'Elogiar alguém');
  picker.append(new Option('🙌 Elogiar alguém…', ''));
  picker.addEventListener('change', () => {
    const opt = picker.selectedOptions[0];
    if (!picker.value || !opt) return;
    close();
    opts.praise({ userId: picker.value, name: opt.text });
  });
  void opts.loadTeam().then((team) => {
    for (const m of team.filter((t) => t.userId !== opts.myUserId))
      picker.append(new Option(m.name, m.userId));
  });
  for (const [label, value] of [
    ['Todos', false],
    ['Recebidos por mim', true],
  ] as const) {
    const b = el('button', { type: 'button', textContent: label });
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      mine = value;
      void load();
    });
    tabs.append(b);
  }
  const top = el('div', { className: 'kudos-top' });
  top.append(tabs, picker);
  body.append(top, list);

  const load = async () => {
    tabs
      .querySelectorAll('button')
      .forEach((b, i) => b.setAttribute('aria-selected', String((i === 1) === mine)));
    const items = await kudosApi.wall(opts.token, mine ? opts.myUserId : undefined);
    list.replaceChildren(
      ...(items.length
        ? items.map(kudosItem)
        : [
            el('p', {
              className: 'muted',
              textContent: mine
                ? 'Você ainda não recebeu elogios. Que tal começar elogiando alguém?'
                : 'Nenhum elogio ainda. Seja a primeira pessoa a reconhecer um colega!',
            }),
          ]),
    );
  };
  void load();
  return { refresh: () => void load(), close };
}
