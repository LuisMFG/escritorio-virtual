import {
  NOTE_COLORS,
  NOTE_MAX,
  NOTES_PER_BOARD,
  formatLastSeen,
  type BoardNote,
  type NoteColor,
} from '@office/shared';
import { confirmDialog } from './confirm.js';

export interface BoardOptions {
  furniId: string;
  title: string;
  myUserId: string;
  isAdmin: boolean;
  load(): Promise<BoardNote[]>;
  add(text: string, color: NoteColor): void;
  remove(noteId: number): void;
}

const COLOR_LABELS: Record<NoteColor, string> = {
  yellow: 'Amarelo',
  pink: 'Rosa',
  blue: 'Azul',
  green: 'Verde',
};

/** Janela do mural de recados. Devolve `refresh` (chamar quando o mural mudar) e `close`. */
export function openBoard(opts: BoardOptions): { furniId: string; refresh(): void; close(): void } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="sheet sheet-wide board" role="dialog" aria-modal="true" aria-labelledby="board-title">
      <header class="sheet-head">
        <h2 id="board-title"></h2>
        <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
      </header>
      <div class="sheet-body">
        <ul class="board-notes" aria-live="polite"></ul>
        <form class="board-form">
          <textarea name="text" rows="2" maxlength="${NOTE_MAX}" placeholder="Escreva um recado para o pessoal…" aria-label="Recado"></textarea>
          <div class="board-form-row">
            <div class="board-colors" role="radiogroup" aria-label="Cor do papel"></div>
            <small class="muted board-count"></small>
            <button type="submit" class="btn-primary">Pregar recado</button>
          </div>
        </form>
      </div>
    </section>`;
  document.body.append(backdrop);
  const $ = <T extends Element>(sel: string) => backdrop.querySelector<T>(sel)!;
  $('#board-title').textContent = `📌 ${opts.title}`;
  const list = $<HTMLUListElement>('.board-notes');
  const form = $<HTMLFormElement>('.board-form');
  const text = $<HTMLTextAreaElement>('textarea');
  const count = $<HTMLElement>('.board-count');

  let color: NoteColor = 'yellow';
  const colors = $<HTMLElement>('.board-colors');
  for (const c of NOTE_COLORS) {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: `board-swatch note-${c}`,
      title: COLOR_LABELS[c],
    });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', COLOR_LABELS[c]);
    b.addEventListener('click', () => {
      color = c;
      drawColors();
    });
    colors.append(b);
  }
  const drawColors = () => {
    colors.querySelectorAll('button').forEach((b, i) => {
      b.setAttribute('aria-checked', String(NOTE_COLORS[i] === color));
    });
  };
  drawColors();
  const updateCount = () => (count.textContent = `${text.value.length}/${NOTE_MAX}`);
  text.addEventListener('input', updateCount);
  updateCount();
  // Enter no recado não abre o chat da sala.
  text.addEventListener('keydown', (e) => e.stopPropagation());

  let notes: BoardNote[] = [];
  const render = () => {
    if (notes.length === 0) {
      list.replaceChildren(
        Object.assign(document.createElement('li'), {
          className: 'muted board-empty',
          textContent: 'Nenhum recado ainda. Seja o primeiro!',
        }),
      );
    } else {
      list.replaceChildren(
        ...notes.map((n) => {
          const li = document.createElement('li');
          li.className = `board-note note-${n.color}`;
          li.append(
            Object.assign(document.createElement('p'), { textContent: n.text }),
            Object.assign(document.createElement('small'), {
              textContent: `${n.name} · ${formatLastSeen(n.ts)}`,
            }),
          );
          if (n.userId === opts.myUserId || opts.isAdmin) {
            const del = Object.assign(document.createElement('button'), {
              type: 'button',
              className: 'board-del',
              textContent: '✕',
              title: 'Tirar recado',
            });
            del.setAttribute('aria-label', `Tirar o recado de ${n.name}`);
            del.addEventListener('click', async () => {
              if (await confirmDialog('Tirar este recado do mural?', { confirmLabel: 'Tirar' })) {
                opts.remove(n.id);
              }
            });
            li.append(del);
          }
          return li;
        }),
      );
    }
    const full = notes.length >= NOTES_PER_BOARD;
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = full;
    text.placeholder = full
      ? 'O mural está cheio: tire um recado antes.'
      : 'Escreva um recado para o pessoal…';
  };

  const refresh = async () => {
    notes = await opts.load();
    render();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = text.value.trim();
    if (!value) return;
    opts.add(value, color);
    text.value = '';
    updateCount();
  });

  let closed = false;
  const close = () => {
    closed = true;
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
  $('.sheet-close').addEventListener('click', close);

  void refresh();
  text.focus();
  return {
    furniId: opts.furniId,
    refresh: () => {
      if (!closed) void refresh();
    },
    close,
  };
}
