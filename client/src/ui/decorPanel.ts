import {
  baseClassname,
  CATALOG_CATEGORIES,
  catalogMatches,
  catalogTerms,
  furniImageUrl,
  renderDirection,
  type CatalogItem,
  type FurniCatalog,
  type FurniManifestEntry,
} from '@office/shared';
import { ThumbQueue } from './thumbQueue.js';

export interface DecorPanelHandlers {
  pick(defId: string | null): void;
  rotate(): void;
  remove(): void;
  /** Outra cor do móvel selecionado. */
  color(defId: string): void;
  close(): void;
  /** Prepara um móvel do catálogo completo (o servidor mede na primeira vez). */
  prepare(defId: string): Promise<boolean>;
  /** O catálogo completo e as categorias escondidas pelo admin. */
  loadCatalog(): Promise<{ catalog: FurniCatalog; hidden: string[] }>;
}

/** Aba "Escritório": os móveis curados do manifesto (os de sempre). */
const OFFICE = '__escritorio__';
/** Aba "Parede": quadros, janelas, prateleiras… de qualquer categoria. */
const WALL = '__parede__';
/** Itens por página da grade ("Mostrar mais" carrega a próxima). */
export const DECOR_PAGE = 60;

/** Um item mostrado na grade (curado ou do catálogo completo). */
interface GridItem {
  id: string;
  name: string;
  /** Miniatura do imager (direção e revisão conhecidas, quando houver). */
  thumb: { classname: string; direction?: number; revision?: number } | null;
  local?: string;
  colors?: string[];
}

/**
 * Painel do modo decorar (Fase 36): os móveis do escritório e o catálogo completo do Habbo,
 * com busca, categorias, aba de parede e as cores de cada móvel. O item escolhido, o móvel
 * selecionado (Girar/Remover/Cor) e as dicas de teclado ficam embaixo.
 */
export class DecorPanel {
  private readonly root = document.createElement('aside');
  private readonly search = document.createElement('input');
  private readonly select = document.createElement('select');
  private readonly grid = document.createElement('div');
  private readonly more = document.createElement('button');
  private readonly status = document.createElement('div');
  private category = OFFICE;
  private query = '';
  private shown = DECOR_PAGE;
  private picked: string | null = null;
  private selected: { id: string; name: string; defId: string } | null = null;
  private preparing: string | null = null;
  private catalog: CatalogItem[] = [];
  private hidden = new Set<string>();
  /** Classname (com ou sem cor) → item do catálogo. */
  private byId = new Map<string, CatalogItem>();
  private loading: Promise<void> | null = null;
  private readonly thumbs = new ThumbQueue();

  constructor(
    private readonly items: readonly FurniManifestEntry[],
    private readonly on: DecorPanelHandlers,
    /** Miniaturas do imager (desligadas no modo sem internet, `?offline=1`). */
    private readonly thumbnails = true,
  ) {
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

    Object.assign(this.search, {
      type: 'search',
      placeholder: 'Buscar móvel (ex.: sofá, quadro, luminária)',
      className: 'decor-search',
    });
    this.search.setAttribute('aria-label', 'Buscar móvel');
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.shown = DECOR_PAGE;
      if (this.query.trim()) void this.ensureCatalog();
      this.render();
    });
    this.select.className = 'decor-category';
    this.select.setAttribute('aria-label', 'Categoria');
    this.select.addEventListener('change', () => {
      this.category = this.select.value;
      this.shown = DECOR_PAGE;
      this.render();
    });
    this.grid.className = 'decor-grid';
    Object.assign(this.more, {
      type: 'button',
      className: 'btn-secondary decor-more',
      textContent: 'Mostrar mais',
      hidden: true,
    });
    this.more.addEventListener('click', () => {
      this.shown += DECOR_PAGE;
      this.render();
    });
    this.status.className = 'decor-status';
    const help = Object.assign(document.createElement('p'), {
      className: 'muted decor-help',
      textContent:
        'Escolha um item e clique no piso (ou na parede) para colocar. Clique num móvel para selecionar, arraste para mover. R gira · Delete remove · Esc cancela.',
    });
    this.root.append(head, this.search, this.select, this.grid, this.more, this.status, help);
    document.body.append(this.root);
    this.fillCategories();
    this.render();
    this.setSelected(null);
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    document.body.classList.toggle('decorating', on);
    if (on) void this.ensureCatalog();
  }

  setPicked(defId: string | null): void {
    this.picked = defId;
    this.markPressed();
    if (defId) {
      this.status.replaceChildren(
        Object.assign(document.createElement('span'), {
          textContent: `Colocando: ${this.nameOf(defId)}`,
        }),
        this.swatches(defId, (id) => void this.pickItem(id)),
        this.button('Girar (R)', () => this.on.rotate()),
        this.button('Cancelar', () => this.on.pick(null)),
      );
    } else {
      this.renderSelected();
    }
  }

  setSelected(selected: { id: string; name: string; defId: string } | null): void {
    this.selected = selected;
    if (!this.picked) this.renderSelected();
  }

  /** O admin mudou as categorias escondidas. */
  setHidden(hidden: string[]): void {
    this.hidden = new Set(hidden);
    if (this.category !== OFFICE && this.category !== WALL && this.hidden.has(this.category)) {
      this.category = OFFICE;
    }
    this.fillCategories();
    this.render();
  }

  private renderSelected(): void {
    const sel = this.selected;
    if (!sel) {
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
        textContent: `Selecionado: ${this.nameOf(sel.defId, sel.name)}`,
      }),
      this.swatches(sel.defId, (id) => this.on.color(id)),
      this.button('Girar (R)', () => this.on.rotate()),
      this.button('Remover', () => this.on.remove()),
    );
  }

  /** Carrega o catálogo completo na primeira vez (o painel funciona sem ele). */
  private ensureCatalog(): Promise<void> {
    this.loading ??= this.on
      .loadCatalog()
      .then(({ catalog, hidden }) => {
        this.catalog = catalog.items;
        for (const item of catalog.items) {
          this.byId.set(item.id, item);
          for (const c of item.colors ?? []) this.byId.set(c, item);
        }
        this.hidden = new Set(hidden);
        this.fillCategories();
        this.render();
        // Os nomes e as cores do item escolhido/selecionado agora aparecem.
        this.setPicked(this.picked);
      })
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private fillCategories(): void {
    const counts = new Map<string, number>();
    let walls = 0;
    for (const item of this.catalog) {
      if (this.hidden.has(item.c)) continue;
      if (item.wall) walls++;
      else counts.set(item.c, (counts.get(item.c) ?? 0) + 1);
    }
    const option = (value: string, label: string) =>
      Object.assign(document.createElement('option'), { value, textContent: label });
    const options = [option(OFFICE, `Escritório (${this.items.length})`)];
    if (walls) options.push(option(WALL, `Parede (${walls})`));
    for (const [c, label] of Object.entries(CATALOG_CATEGORIES)) {
      const n = counts.get(c);
      if (n) options.push(option(c, `${label} (${n})`));
    }
    if (!this.catalog.length) options.push(option('', 'Carregando o catálogo completo…'));
    this.select.replaceChildren(...options);
    this.select.value = this.category;
    this.select.lastElementChild?.toggleAttribute('disabled', !this.catalog.length);
  }

  /** Itens da aba atual (ou da busca, que procura em tudo). */
  private visibleItems(): GridItem[] {
    const terms = catalogTerms(this.query);
    const curated = (): GridItem[] =>
      this.items
        .filter((i) => !terms.length || catalogMatches({ id: i.id, n: i.name }, terms))
        .map((i) => ({
          id: i.id,
          name: i.name,
          thumb:
            i.source === 'habboassets'
              ? {
                  classname: i.sprite ?? i.id,
                  direction: renderDirection(i, 2),
                  revision: i.revision,
                }
              : null,
          local:
            i.source === 'local'
              ? `/assets/local/furni/${i.id}_${renderDirection(i, 2)}.png`
              : undefined,
        }));
    const fromCatalog = (filter: (i: CatalogItem) => boolean): GridItem[] =>
      this.catalog
        .filter((i) => !this.hidden.has(i.c) && filter(i))
        .map((i) => ({
          id: i.id,
          name: i.n,
          thumb: { classname: i.id, revision: i.rev },
          colors: i.colors,
        }));
    if (terms.length) {
      const curatedIds = new Set(this.items.map((i) => i.id));
      return [
        ...curated(),
        ...fromCatalog((i) => !curatedIds.has(i.id) && catalogMatches(i, terms)),
      ];
    }
    if (this.category === OFFICE) return curated();
    if (this.category === WALL) return fromCatalog((i) => Boolean(i.wall));
    return fromCatalog((i) => i.c === this.category && !i.wall);
  }

  private render(): void {
    this.select.disabled = Boolean(this.query.trim());
    const all = this.visibleItems();
    const page = all.slice(0, this.shown);
    this.thumbs.clear();
    this.grid.replaceChildren(...page.map((item) => this.itemButton(item)));
    if (!all.length) {
      this.grid.append(
        Object.assign(document.createElement('p'), {
          className: 'muted',
          textContent:
            this.catalog.length || !this.query.trim() ? 'Nada encontrado.' : 'Carregando…',
        }),
      );
    }
    this.more.hidden = all.length <= this.shown;
    this.more.textContent = `Mostrar mais (${all.length - page.length})`;
  }

  private itemButton(item: GridItem): HTMLButtonElement {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      title: item.name,
    });
    b.dataset.id = item.id;
    b.setAttribute('aria-pressed', String(this.isPicked(item.id)));
    b.append(
      this.thumb(item),
      Object.assign(document.createElement('span'), { textContent: item.name }),
    );
    if (item.colors && item.colors.length > 1) {
      b.append(
        Object.assign(document.createElement('small'), {
          className: 'decor-colors',
          textContent: `${item.colors.length} cores`,
        }),
      );
    }
    b.addEventListener('click', () => {
      if (this.isPicked(item.id)) return this.on.pick(null);
      void this.pickItem(item.id);
    });
    return b;
  }

  private thumb(item: GridItem): HTMLElement {
    const img = Object.assign(document.createElement('img'), { alt: '' });
    const sources: string[] = [];
    if (item.local) sources.push(item.local);
    if (item.thumb && this.thumbnails) {
      // Sempre o tamanho normal: o pequeno (size=32) falha em muitos móveis no imager.
      const opts = { direction: item.thumb.direction, revision: item.thumb.revision };
      sources.push(
        furniImageUrl(item.thumb.classname, opts, '/hh'),
        furniImageUrl(item.thumb.classname, opts),
      );
    }
    const none = () =>
      img.replaceWith(
        Object.assign(document.createElement('span'), {
          className: 'decor-nothumb',
          textContent: '🪑',
        }),
      );
    if (!sources.length) {
      queueMicrotask(none);
      return img;
    }
    this.thumbs.load(img, sources, none);
    return img;
  }

  /** Escolhe um item: os do catálogo completo são preparados antes (medidos no servidor). */
  private async pickItem(id: string): Promise<void> {
    if (this.items.some((i) => i.id === id)) return this.on.pick(id);
    this.preparing = id;
    this.status.replaceChildren(
      Object.assign(document.createElement('span'), {
        className: 'muted',
        textContent: `Preparando ${this.nameOf(id)}…`,
      }),
    );
    const ok = await this.on.prepare(id);
    if (this.preparing !== id) return;
    this.preparing = null;
    if (ok) this.on.pick(id);
    else {
      this.status.replaceChildren(
        Object.assign(document.createElement('span'), {
          className: 'decor-error',
          textContent: 'Não consegui preparar esse móvel agora. Tente de novo.',
        }),
      );
    }
  }

  /** Bolinhas de cor (miniatura de cada variação) do móvel, quando ele tem mais de uma. */
  private swatches(defId: string, choose: (id: string) => void): HTMLElement {
    const box = document.createElement('div');
    box.className = 'decor-swatches';
    const item = this.byId.get(defId) ?? this.byId.get(baseClassname(defId));
    const colors = item?.colors ?? [];
    if (colors.length < 2) {
      box.hidden = true;
      return box;
    }
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Cores');
    colors.forEach((c, i) => {
      const b = Object.assign(document.createElement('button'), {
        type: 'button',
        title: `Cor ${i + 1}`,
      });
      b.dataset.color = c;
      b.setAttribute('aria-pressed', String(c === defId));
      // Cada cor pode ter outra revisão: sem fixar, o imager redireciona para a certa.
      const revision = c === item!.id ? item!.rev : undefined;
      b.append(this.thumb({ id: c, name: '', thumb: { classname: c, revision } }));
      b.addEventListener('click', () => choose(c));
      box.append(b);
    });
    return box;
  }

  private nameOf(id: string, fallback?: string): string {
    return this.items.find((i) => i.id === id)?.name ?? this.byId.get(id)?.n ?? fallback ?? id;
  }

  /** O item da grade conta como escolhido também quando a cor escolhida é outra variação. */
  private isPicked(id: string): boolean {
    if (!this.picked) return false;
    return this.picked === id || (this.byId.get(this.picked)?.id === id && this.byId.has(id));
  }

  private markPressed(): void {
    for (const b of this.grid.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
      b.setAttribute('aria-pressed', String(this.isPicked(b.dataset.id!)));
    }
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
