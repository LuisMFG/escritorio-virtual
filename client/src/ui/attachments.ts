import {
  findUrls,
  formatBytes,
  SEARCH_MIN,
  UPLOAD_MAX_BYTES,
  type Attachment,
  type SearchHit,
} from '@office/shared';
import { uploadApi } from '../net/api.js';

/**
 * Anexos (Fase 29): botão 📎 / colar / arrastar, miniaturas das imagens (baixadas com o token e
 * mostradas da memória), links clicáveis com prévia e a busca nas conversas.
 */

let token = '';
/** Sessão atual (os anexos só baixam com login). */
export function setUploadToken(t: string): void {
  token = t;
  for (const url of blobs.values()) void url.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  blobs.clear();
}

const blobs = new Map<string, Promise<string>>();
function blobUrl(id: string): Promise<string> {
  let url = blobs.get(id);
  if (!url) {
    url = uploadApi.blob(token, id).then((b) => URL.createObjectURL(b));
    url.catch(() => blobs.delete(id));
    blobs.set(id, url);
  }
  return url;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

const ICONS: [RegExp, string][] = [
  [/pdf/, '📕'],
  [/sheet|excel|csv/, '📊'],
  [/presentation|powerpoint/, '📽️'],
  [/zip/, '🗜️'],
  [/word|opendocument\.text/, '📝'],
];
const iconOf = (mime: string) => ICONS.find(([re]) => re.test(mime))?.[1] ?? '📄';

// ---------- Anexo pronto para mandar ----------

/** Arquivo escolhido (já enviado ao servidor) esperando a mensagem ser mandada. */
export class AttachmentDraft {
  readonly button = el('button', {
    type: 'button',
    className: 'chat-attach-btn',
    textContent: '📎',
    title: 'Anexar arquivo (ou cole/arraste uma imagem)',
  });
  readonly chip = el('div', { className: 'attach-draft', hidden: true });
  private readonly file = el('input', { type: 'file', hidden: true });
  current: Attachment | null = null;
  private busy = false;

  constructor(
    private readonly onError: (message: string) => void,
    private readonly onReady: () => void = () => {},
  ) {
    this.button.setAttribute('aria-label', 'Anexar arquivo');
    this.file.setAttribute('aria-label', 'Escolher arquivo para anexar');
    this.button.addEventListener('click', () => this.file.click());
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      this.file.value = '';
      if (f) void this.attach(f);
    });
  }

  /** O `<input type=file>` (vai junto do botão no formulário). */
  get input(): HTMLInputElement {
    return this.file;
  }

  get uploading(): boolean {
    return this.busy;
  }

  async attach(f: File): Promise<void> {
    if (this.busy) return;
    if (f.size > UPLOAD_MAX_BYTES) return this.onError('O arquivo passa de 10 MB.');
    this.busy = true;
    this.renderChip(`Enviando ${f.name}…`);
    try {
      this.current = await uploadApi.upload(token, f);
      this.renderChip();
      this.onReady();
    } catch (err) {
      this.clear();
      this.onError((err as Error).message);
    } finally {
      this.busy = false;
    }
  }

  clear(): void {
    this.current = null;
    this.chip.hidden = true;
    this.chip.replaceChildren();
  }

  /** Colar imagem e arrastar arquivo para `area`. */
  bind(area: HTMLElement, pasteTarget: HTMLElement): void {
    pasteTarget.addEventListener('paste', (e) => {
      const f = [...(e.clipboardData?.files ?? [])][0];
      if (!f) return;
      e.preventDefault();
      void this.attach(f);
    });
    area.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      area.classList.add('drop-over');
    });
    area.addEventListener('dragleave', () => area.classList.remove('drop-over'));
    area.addEventListener('drop', (e) => {
      area.classList.remove('drop-over');
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      e.preventDefault();
      void this.attach(f);
    });
  }

  private renderChip(status?: string): void {
    this.chip.hidden = false;
    if (status || !this.current) {
      this.chip.replaceChildren(el('span', { className: 'muted', textContent: status ?? '' }));
      return;
    }
    const a = this.current;
    const remove = el('button', { type: 'button', className: 'reply-cancel', textContent: '✕' });
    remove.setAttribute('aria-label', 'Tirar anexo');
    remove.addEventListener('click', () => this.clear());
    this.chip.replaceChildren(
      el('span', { textContent: `${a.image ? '🖼️' : iconOf(a.mime)} ${a.name}` }),
      el('small', { className: 'muted', textContent: formatBytes(a.size) }),
      remove,
    );
  }
}

// ---------- Anexo numa mensagem ----------

/** Miniatura (imagem) ou cartão do arquivo com botão de baixar. */
export function attachmentView(a: Attachment): HTMLElement {
  if (a.image) {
    const btn = el('button', { type: 'button', className: 'attach-thumb', title: a.name });
    btn.setAttribute('aria-label', `Ver imagem ${a.name}`);
    const img = el('img', { alt: a.name, loading: 'lazy' });
    btn.append(img);
    blobUrl(a.id)
      .then((u) => (img.src = u))
      .catch(() => btn.replaceWith(fileCard(a)));
    btn.addEventListener('click', () => void blobUrl(a.id).then((u) => openLightbox(u, a.name)));
    return btn;
  }
  return fileCard(a);
}

function fileCard(a: Attachment): HTMLElement {
  const btn = el('button', { type: 'button', className: 'attach-file' });
  btn.setAttribute('aria-label', `Baixar ${a.name}`);
  btn.append(
    el('span', { className: 'attach-icon', textContent: iconOf(a.mime) }),
    el('span', { className: 'attach-name', textContent: a.name }),
    el('small', { className: 'muted', textContent: `${formatBytes(a.size)} · baixar` }),
  );
  btn.addEventListener('click', async () => {
    try {
      const link = el('a', { href: await blobUrl(a.id), download: a.name });
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      btn.classList.add('attach-gone');
    }
  });
  return btn;
}

function openLightbox(src: string, name: string): void {
  const back = el('div', { className: 'modal-backdrop lightbox' });
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-label', name);
  const img = el('img', { src, alt: name });
  const close = el('button', { type: 'button', className: 'lightbox-close', textContent: '✕' });
  close.setAttribute('aria-label', 'Fechar imagem');
  const done = () => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    done();
  };
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target === close) done();
  });
  document.addEventListener('keydown', onKey, true);
  back.append(img, el('p', { className: 'lightbox-name', textContent: name }), close);
  document.body.append(back);
  close.focus();
}

// ---------- Links ----------

/** Põe `text` em `parent` com as URLs viradas links (abrem em outra aba). */
export function appendLinkified(parent: HTMLElement, text: string): void {
  let last = 0;
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi)) {
    parent.append(text.slice(last, m.index));
    parent.append(
      el('a', {
        href: m[0],
        textContent: m[0],
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'chat-link',
      }),
    );
    last = m.index + m[0].length;
  }
  parent.append(text.slice(last));
}

/** Cartão com título do primeiro link da mensagem (aparece quando o servidor achar). */
export function linkPreview(text: string): HTMLElement | null {
  const url = findUrls(text)[0];
  if (!url) return null;
  const card = el('a', {
    className: 'link-preview',
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    hidden: true,
  });
  void uploadApi
    .preview(token, url)
    .then((p) => {
      if (!p) return card.remove();
      const site = p.site === p.title ? new URL(p.url).hostname.replace(/^www\./, '') : p.site;
      card.append(
        el('small', { className: 'muted', textContent: site }),
        el('strong', { textContent: p.title }),
      );
      if (p.description) card.append(el('span', { textContent: p.description }));
      card.hidden = false;
    })
    .catch(() => card.remove());
  return card;
}

// ---------- Busca ----------

export interface SearchHandlers {
  /** Mensagem de uma sala (a atual ou outra). */
  openRoomHit(hit: SearchHit): void;
  openDmHit(hit: SearchHit): void;
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

let openSearchPanel: HTMLElement | null = null;

/** Painel "Buscar nas conversas": chat das salas e as suas DMs. */
export function openSearch(h: SearchHandlers): void {
  if (openSearchPanel) {
    openSearchPanel.querySelector('input')?.focus();
    return;
  }
  const panel = el('aside', { className: 'search-panel' });
  panel.setAttribute('aria-label', 'Buscar nas conversas');
  openSearchPanel = panel;
  const close = el('button', { type: 'button', className: 'dm-icon', textContent: '✕' });
  close.setAttribute('aria-label', 'Fechar busca');
  const head = el('header', { className: 'dm-head' });
  head.append(el('h2', { textContent: '🔎 Buscar nas conversas' }), close);
  const form = el('form', { className: 'search-form' });
  const input = el('input', {
    type: 'search',
    className: 'chat-input',
    placeholder: 'Palavra, frase ou nome de arquivo',
    maxLength: 100,
  });
  input.setAttribute('aria-label', 'Buscar');
  form.append(
    input,
    el('button', { type: 'submit', className: 'btn-primary', textContent: 'Buscar' }),
  );
  const status = el('p', {
    className: 'muted search-status',
    textContent: 'Chat das salas e as suas mensagens privadas.',
  });
  const list = el('ul', { className: 'search-results' });
  panel.append(head, form, status, list);
  document.body.append(panel);

  const done = () => {
    panel.remove();
    openSearchPanel = null;
  };
  close.addEventListener('click', done);
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') done();
  });
  let seq = 0;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < SEARCH_MIN) {
      status.textContent = `Digite pelo menos ${SEARCH_MIN} letras.`;
      return;
    }
    const mine = ++seq;
    status.textContent = 'Buscando…';
    try {
      const hits = await uploadApi.search(token, q);
      if (mine !== seq) return;
      status.textContent =
        hits.length === 0
          ? 'Nada encontrado.'
          : `${hits.length} resultado${hits.length > 1 ? 's' : ''}`;
      list.replaceChildren(...hits.map((hit) => resultItem(hit, q)));
    } catch (err) {
      status.textContent = (err as Error).message;
    }
  });
  const resultItem = (hit: SearchHit, q: string) => {
    const li = el('li');
    const btn = el('button', { type: 'button', className: 'search-hit' });
    const where = hit.kind === 'room' ? `🏢 ${hit.whereName}` : `✉️ ${hit.whereName}`;
    const top = el('span', { className: 'search-hit-top' });
    top.append(
      el('strong', { textContent: hit.name }),
      el('small', { className: 'muted', textContent: `${where} · ${dateFormat.format(hit.ts)}` }),
    );
    btn.append(top, highlighted(hit.text, q));
    btn.addEventListener('click', () =>
      hit.kind === 'room' ? h.openRoomHit(hit) : h.openDmHit(hit),
    );
    li.append(btn);
    return li;
  };
  input.focus();
}

/** Texto com o termo buscado marcado (sem HTML do usuário). */
function highlighted(text: string, q: string): HTMLElement {
  const span = el('span', { className: 'search-hit-text' });
  const lower = text.toLocaleLowerCase('pt-BR');
  const needle = q.toLocaleLowerCase('pt-BR');
  let last = 0;
  for (let i = lower.indexOf(needle); i >= 0 && needle; i = lower.indexOf(needle, last)) {
    span.append(text.slice(last, i), el('mark', { textContent: text.slice(i, i + q.length) }));
    last = i + q.length;
  }
  span.append(text.slice(last));
  return span;
}
