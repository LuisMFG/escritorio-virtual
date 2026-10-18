import { furniImageUrl, renderDirection, type FurniManifestEntry } from '@office/shared';

export interface DecorPanelHandlers {
  pick(defId: string | null): void;
  rotate(): void;
  remove(): void;
  close(): void;
}

/**
 * Painel do modo decorar: catálogo por categoria (miniaturas do imager), item escolhido,
 * móvel selecionado com Girar/Remover e as dicas de teclado.
 */
export class DecorPanel {
  private readonly root = document.createElement('aside');
  private readonly tabs = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly categories: string[];
  private category: string;
  private picked: string | null = null;

  constructor(
    private readonly items: readonly FurniManifestEntry[],
    private readonly on: DecorPanelHandlers,
  ) {
    this.categories = [...new Set(items.map((i) => i.category))];
    this.category = this.categories[0] ?? '';

    this.root.className = 'decor-panel';
    this.root.setAttribute('aria-label', 'Modo decorar');
    this.root.hidden = true;
    const head = document.createElement('header');
    const title = Object.assign(document.createElement('h2'), { textContent: 'Decorar sala' });
    const close = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-secondary',
      textContent: 'Concluir',
    });
    close.addEventListener('click', () => this.on.close());
    head.append(title, close);

    this.tabs.className = 'editor-tabs';
    this.tabs.setAttribute('role', 'tablist');
    this.grid.className = 'decor-grid';
    this.status.className = 'decor-status';
    const help = Object.assign(document.createElement('p'), {
      className: 'muted decor-help',
      textContent:
        'Escolha um item e clique no piso para colocar. Clique num móvel para selecionar, arraste para mover. R gira · Delete remove · Esc cancela.',
    });
    this.root.append(head, this.tabs, this.grid, this.status, help);
    document.body.append(this.root);
    this.render();
    this.setSelected(null);
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    document.body.classList.toggle('decorating', on);
  }

  setPicked(defId: string | null): void {
    this.picked = defId;
    for (const b of this.grid.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
      b.setAttribute('aria-pressed', String(b.dataset.id === defId));
    }
    if (defId) {
      const item = this.items.find((i) => i.id === defId);
      this.status.replaceChildren(
        Object.assign(document.createElement('span'), {
          textContent: `Colocando: ${item?.name ?? defId}`,
        }),
        this.button('Girar (R)', () => this.on.rotate()),
        this.button('Cancelar', () => this.on.pick(null)),
      );
    } else {
      this.setSelected(null);
    }
  }

  setSelected(selected: { id: string; name: string } | null): void {
    if (this.picked) return;
    if (!selected) {
      this.status.replaceChildren(
        Object.assign(document.createElement('span'), {
          className: 'muted',
          textContent: 'Nenhum móvel selecionado.',
        }),
      );
      return;
    }
    this.status.replaceChildren(
      Object.assign(document.createElement('span'), {
        textContent: `Selecionado: ${selected.name}`,
      }),
      this.button('Girar (R)', () => this.on.rotate()),
      this.button('Remover', () => this.on.remove()),
    );
  }

  private render(): void {
    this.tabs.replaceChildren(
      ...this.categories.map((c) => {
        const tab = Object.assign(document.createElement('button'), {
          type: 'button',
          textContent: c.charAt(0).toUpperCase() + c.slice(1),
        });
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(c === this.category));
        tab.addEventListener('click', () => {
          this.category = c;
          this.render();
        });
        return tab;
      }),
    );
    this.grid.replaceChildren(
      ...this.items
        .filter((i) => i.category === this.category)
        .map((item) => {
          const dir = renderDirection(item, 2);
          const opts = { direction: dir, revision: item.revision, size: 32 as const };
          const img = Object.assign(document.createElement('img'), {
            alt: '',
            loading: 'lazy' as const,
          });
          const sources =
            item.source === 'habboassets'
              ? [
                  furniImageUrl(item.sprite ?? item.id, opts, '/hh'),
                  furniImageUrl(item.sprite ?? item.id, opts),
                ]
              : [`/assets/local/furni/${item.id}_${dir}.png`];
          img.onerror = () => {
            const next = sources.shift();
            if (next) img.src = next;
            else
              img.replaceWith(Object.assign(document.createElement('span'), { textContent: '?' }));
          };
          img.src = sources.shift()!;
          const label = Object.assign(document.createElement('span'), { textContent: item.name });
          const b = Object.assign(document.createElement('button'), {
            type: 'button',
            title: item.name,
          });
          b.dataset.id = item.id;
          b.setAttribute('aria-pressed', String(item.id === this.picked));
          b.append(img, label);
          b.addEventListener('click', () => this.on.pick(this.picked === item.id ? null : item.id));
          return b;
        }),
    );
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn-secondary',
      textContent: text,
    });
    b.addEventListener('click', onClick);
    return b;
  }
}
