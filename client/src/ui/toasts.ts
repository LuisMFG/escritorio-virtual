import { iconHtml } from './icons.js';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** Quanto tempo fica (ms); com ação, o padrão é mais longo. */
  durationMs?: number;
  /** Botão no aviso (ex.: "Desfazer"); clicar fecha o aviso. */
  action?: { label: string; run: () => void };
  /** Chamado quando o aviso some sem a ação ter sido usada. */
  onExpire?: () => void;
}

/** No máximo tantos avisos ao mesmo tempo (os mais velhos saem). */
const MAX_TOASTS = 4;

/**
 * Avisos empilhados (Fase 45): sucesso, erro e informação, com ação opcional ("Desfazer").
 * Ficam acima da barra de baixo; os novos entram embaixo.
 */
export class Toaster {
  private readonly box = document.createElement('div');

  constructor() {
    this.box.className = 'toasts';
    this.box.setAttribute('role', 'status');
    this.box.setAttribute('aria-live', 'polite');
    document.body.append(this.box);
  }

  show(text: string, opts: ToastOptions = {}): () => void {
    const kind = opts.kind ?? 'info';
    const item = document.createElement('div');
    item.className = `toast-item ${kind}`;
    if (kind === 'error') item.setAttribute('role', 'alert');
    const icon = kind === 'success' ? 'check' : kind === 'error' ? 'x' : null;
    if (icon) {
      const i = document.createElement('span');
      i.className = 'toast-icon';
      i.innerHTML = iconHtml(icon, 14);
      item.append(i);
    }
    item.append(
      Object.assign(document.createElement('span'), { className: 'toast-text', textContent: text }),
    );
    let used = false;
    let timer = 0;
    let pipClose: (() => void) | null = null;
    const close = () => {
      clearTimeout(timer);
      if (pipClose) pipClose();
      if (!item.isConnected) return;
      item.classList.add('leaving');
      window.setTimeout(() => item.remove(), 180);
      if (!used) opts.onExpire?.();
    };
    if (opts.action) {
      const b = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'toast-action',
        textContent: opts.action.label,
      });
      b.addEventListener('click', () => {
        used = true;
        opts.action!.run();
        close();
      });
      item.append(b);
    }
    const x = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'toast-close',
      innerHTML: iconHtml('x', 12),
    });
    x.setAttribute('aria-label', 'Fechar aviso');
    x.addEventListener('click', close);
    item.append(x);
    this.box.append(item);
    if (pipToasterBox && pipToasterBox.isConnected) {
      const pDoc = pipToasterBox.ownerDocument;
      const pItem = pDoc.createElement('div');
      pItem.className = `toast-item ${kind}`;
      if (kind === 'error') pItem.setAttribute('role', 'alert');
      if (icon) {
        const i = pDoc.createElement('span');
        i.className = 'toast-icon';
        i.innerHTML = iconHtml(icon, 14);
        pItem.append(i);
      }
      pItem.append(
        Object.assign(pDoc.createElement('span'), { className: 'toast-text', textContent: text }),
      );
      pipClose = () => {
        if (!pItem.isConnected) return;
        pItem.classList.add('leaving');
        window.setTimeout(() => pItem.remove(), 180);
      };
      if (opts.action) {
        const b = Object.assign(pDoc.createElement('button'), {
          type: 'button',
          className: 'toast-action',
          textContent: opts.action.label,
        });
        b.addEventListener('click', () => {
          used = true;
          opts.action!.run();
          close();
        });
        pItem.append(b);
      }
      const px = Object.assign(pDoc.createElement('button'), {
        type: 'button',
        className: 'toast-close',
        innerHTML: iconHtml('x', 12),
      });
      px.setAttribute('aria-label', 'Fechar aviso');
      px.addEventListener('click', close);
      pItem.append(px);
      pipToasterBox.append(pItem);
      while (pipToasterBox.children.length > MAX_TOASTS) {
        (pipToasterBox.firstElementChild as HTMLElement)
          .querySelector<HTMLButtonElement>('.toast-close')
          ?.click();
        break;
      }
    }
    while (this.box.children.length > MAX_TOASTS) {
      (this.box.firstElementChild as HTMLElement)
        .querySelector<HTMLButtonElement>('.toast-close')!
        .click();
      break;
    }
    timer = window.setTimeout(close, opts.durationMs ?? (opts.action ? 6000 : 3500));
    return close;
  }
}

let shared: Toaster | null = null;
let pipToasterBox: HTMLElement | null = null;

/** Anexa um container de avisos (toasts) à janela flutuante se ela estiver ativa. */
export function attachToasterToPip(doc: Document): () => void {
  const box = doc.createElement('div');
  box.className = 'toasts pip-toasts';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  doc.body.append(box);
  pipToasterBox = box;
  return () => {
    box.remove();
    if (pipToasterBox === box) pipToasterBox = null;
  };
}

/** Cria a pilha de avisos da página (se ainda não existe). */
export function mountToasts(): Toaster {
  shared ??= new Toaster();
  return shared;
}

/** Aviso na pilha única da página. */
export function toast(text: string, opts: ToastOptions = {}): () => void {
  return mountToasts().show(text, opts);
}

/**
 * Ação com "Desfazer": `commit` só roda quando o aviso some sem desfazer (ou ao sair da página);
 * `undo` volta o que já foi mostrado.
 */
export function undoable(text: string, commit: () => void, undo: () => void): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    window.removeEventListener('pagehide', once);
    commit();
  };
  window.addEventListener('pagehide', once);
  toast(text, {
    action: {
      label: 'Desfazer',
      run: () => {
        done = true;
        window.removeEventListener('pagehide', once);
        undo();
      },
    },
    onExpire: once,
  });
}
