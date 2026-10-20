import {
  avatarImageUrl,
  clothingPreviewUrl,
  clothingSearchText,
  clothingSetImageUrl,
  LOOK_SLOTS,
  matchesSearch,
  type AvatarSet,
  type SavedLook,
  findCategory,
  findSet,
  parseFigure,
  randomFigure,
  setFitsGender,
  switchGender,
  validateFigure,
  withPart,
  type AvatarCategory,
  type AvatarManifest,
  type Gender,
} from '@office/shared';
import { loadWithFallback, ThumbQueue } from './thumbQueue.js';
import { iconHtml } from './icons.js';
import { motionReduced } from './prefs.js';

/** Prévia girando sozinha (Fase 43): um passo de direção a cada tanto (ms). */
const SPIN_MS = 1100;

export interface AvatarChoice {
  figure: string;
  gender: Gender;
}

export interface AvatarEditorOptions extends AvatarChoice {
  manifest: AvatarManifest;
  /** Prévia gerada por código quando o imager não responde (data URL). */
  fallbackPreview: (figure: string, dir: number) => Promise<string>;
  saveLabel?: string;
  /** Miniaturas das peças (desligadas no modo sem internet, `?offline=1`). */
  thumbnails?: boolean;
  /** Looks salvos (só com sessão; no cadastro não aparece). */
  looks?: {
    load(): Promise<SavedLook[]>;
    save(slot: number, choice: AvatarChoice): Promise<SavedLook[]>;
    remove(slot: number): Promise<SavedLook[]>;
  };
}

/** Peças por "página" (o resto aparece em "Mostrar mais"). */
const PAGE = 60;
type ClubFilter = 'all' | 'free' | 'club';

const PREVIEW_DEBOUNCE_MS = 250;

const thumbQueue = new ThumbQueue();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/**
 * Editor de avatar: prévia com rotação, gênero, abas por categoria, miniaturas das peças e
 * seletores de cor da paleta do manifesto. Resolve com o visual escolhido, ou `null` se cancelar.
 */
export function openAvatarEditor(opts: AvatarEditorOptions): Promise<AvatarChoice | null> {
  const { manifest } = opts;
  let gender: Gender = opts.gender;
  let figure = validateFigure(opts.figure, gender, manifest).ok
    ? opts.figure
    : manifest.defaults[gender];
  let dir = 3;
  let activeType = manifest.categories[0]!.type;
  let previewTimer = 0;
  let query = '';
  let club: ClubFilter = 'all';
  let shown = PAGE;
  let looks: SavedLook[] = [];
  let looksVersion = 0;
  const searchText = new Map<string, string>();
  const textOf = (cat: AvatarCategory, set: AvatarSet) => {
    const key = `${cat.type}:${set.id}`;
    let t = searchText.get(key);
    if (t === undefined) {
      t = clothingSearchText(set.library, cat.label, set.id);
      searchText.set(key, t);
    }
    return t;
  };
  const opener = document.activeElement as HTMLElement | null;

  // ---------- Estrutura ----------
  const previewImg = el('img', { alt: 'Prévia do seu avatar', width: 128, height: 220 });
  const previewStage = el('div', { className: 'preview-stage' }, [previewImg]);
  const rotateLeft = el('button', {
    type: 'button',
    className: 'icon-btn',
    innerHTML: iconHtml('rotate-ccw'),
    title: 'Girar',
  });
  const rotateRight = el('button', {
    type: 'button',
    className: 'icon-btn',
    innerHTML: iconHtml('rotate-cw'),
    title: 'Girar',
  });
  rotateLeft.setAttribute('aria-label', 'Girar para a esquerda');
  rotateRight.setAttribute('aria-label', 'Girar para a direita');
  // Prévia animada: gira sozinha (desligada com "reduzir movimento"); girar à mão para.
  const spinBtn = el('button', { type: 'button', className: 'icon-btn editor-spin' });
  spinBtn.setAttribute('aria-label', 'Girar sozinho');
  spinBtn.title = 'Girar sozinho';
  let spinTimer = 0;
  const setSpin = (on: boolean) => {
    clearInterval(spinTimer);
    spinTimer = on
      ? window.setInterval(() => {
          dir = (dir + 7) % 8;
          schedulePreview();
        }, SPIN_MS)
      : 0;
    spinBtn.setAttribute('aria-pressed', String(on));
    spinBtn.innerHTML = iconHtml(on ? 'pause' : 'play');
  };
  spinBtn.addEventListener('click', () => setSpin(!spinTimer));

  const genderButtons = (['M', 'F'] as const).map((g) => {
    const b = el('button', { type: 'button', textContent: g === 'M' ? 'Masculino' : 'Feminino' });
    b.setAttribute('role', 'radio');
    b.dataset.gender = g;
    return b;
  });
  const genderGroup = el('div', { className: 'segmented' }, genderButtons);
  genderGroup.setAttribute('role', 'radiogroup');
  genderGroup.setAttribute('aria-label', 'Gênero');
  const randomBtn = el('button', {
    type: 'button',
    className: 'btn-secondary',
    textContent: 'Aleatório',
  });

  const tabs = el('div', { className: 'editor-tabs' });
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Categorias');
  const setsGrid = el('div', { className: 'editor-sets' });
  setsGrid.setAttribute('role', 'listbox');
  const search = el('input', {
    type: 'search',
    className: 'editor-search',
    placeholder: 'Buscar (ex.: terno, boné, asas)',
  });
  search.setAttribute('aria-label', 'Buscar peças');
  const clubSelect = el('select', { className: 'editor-club' });
  clubSelect.setAttribute('aria-label', 'Filtrar peças');
  for (const [v, label] of [
    ['all', 'Todas'],
    ['free', 'Grátis'],
    ['club', 'Do clube (HC)'],
  ] as const)
    clubSelect.append(new Option(label, v));
  const countInfo = el('small', { className: 'muted editor-count' });
  const toolbar = el('div', { className: 'editor-toolbar' }, [search, clubSelect, countInfo]);
  const moreBtn = el('button', {
    type: 'button',
    className: 'btn-link editor-more',
    textContent: 'Mostrar mais',
  });
  const looksBox = el('div', { className: 'editor-looks' });
  const colorsBox = el('div', { className: 'editor-colors' });
  const errorBox = el('p', { className: 'editor-error', hidden: true });
  errorBox.setAttribute('role', 'alert');

  const cancelBtn = el('button', {
    type: 'button',
    className: 'btn-secondary',
    textContent: 'Cancelar',
  });
  const saveBtn = el('button', {
    type: 'button',
    className: 'btn-primary',
    textContent: opts.saveLabel ?? 'Salvar visual',
  });
  const closeBtn = el('button', {
    type: 'button',
    className: 'icon-btn',
    innerHTML: iconHtml('x', 16),
  });
  closeBtn.setAttribute('aria-label', 'Fechar editor');

  const title = el('h2', { id: 'editor-title', textContent: 'Seu visual' });
  const dialog = el('div', { className: 'editor' }, [
    el('header', { className: 'editor-head' }, [title, closeBtn]),
    el('div', { className: 'editor-body' }, [
      el('section', { className: 'editor-preview' }, [
        previewStage,
        el('div', { className: 'editor-rotate' }, [rotateLeft, spinBtn, rotateRight]),
        genderGroup,
        randomBtn,
        looksBox,
      ]),
      el('section', { className: 'editor-pick' }, [tabs, toolbar, setsGrid, moreBtn, colorsBox]),
    ]),
    errorBox,
    el('footer', { className: 'editor-foot' }, [cancelBtn, saveBtn]),
  ]);
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'editor-title');
  const backdrop = el('div', { className: 'modal-backdrop' }, [dialog]);
  document.body.append(backdrop);

  // ---------- Renderização ----------
  function category(): AvatarCategory {
    return findCategory(manifest, activeType)!;
  }

  function currentPart(type: string) {
    return parseFigure(figure).find((p) => p.type === type);
  }

  function schedulePreview(): void {
    clearTimeout(previewTimer);
    previewStage.classList.add('loading');
    previewTimer = window.setTimeout(() => {
      const f = figure;
      const d = dir;
      previewImg.onload = () => previewStage.classList.remove('loading');
      loadWithFallback(
        previewImg,
        [
          avatarImageUrl(f, { direction: d, size: 'l' }, '/hh'),
          avatarImageUrl(f, { direction: d, size: 'l' }),
        ],
        () => {
          void opts.fallbackPreview(f, d).then((url) => {
            if (f === figure && d === dir) previewImg.src = url;
          });
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
  }

  function renderGender(): void {
    for (const b of genderButtons)
      b.setAttribute('aria-checked', String(b.dataset.gender === gender));
  }

  function renderTabs(): void {
    tabs.replaceChildren(
      ...manifest.categories.map((c) => {
        const tab = el('button', { type: 'button', textContent: c.label });
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(c.type === activeType));
        tab.tabIndex = c.type === activeType ? 0 : -1;
        tab.addEventListener('click', () => {
          activeType = c.type;
          shown = PAGE;
          renderAll();
        });
        return tab;
      }),
    );
  }

  function renderSets(): void {
    // Miniaturas da lista anterior que ainda não começaram não interessam mais.
    thumbQueue.clear();
    const cat = category();
    const selected = currentPart(cat.type)?.setId ?? null;
    const items: HTMLButtonElement[] = [];
    if (!cat.required) {
      const none = el('button', {
        type: 'button',
        className: 'set-item set-none',
        textContent: 'Nenhum',
      });
      none.setAttribute('role', 'option');
      none.setAttribute('aria-selected', String(selected === null));
      none.addEventListener('click', () => update(withPart(figure, manifest, cat.type, null)));
      items.push(none);
    }
    const matching = cat.sets.filter(
      (s) =>
        setFitsGender(s, gender) &&
        (club === 'all' || (club === 'free' ? s.club === 0 : s.club > 0)) &&
        (!query || matchesSearch(textOf(cat, s), query)),
    );
    // A peça escolhida aparece sempre, mesmo fora da página.
    const page = matching.slice(0, shown);
    const chosen = matching.find((s) => s.id === selected);
    if (chosen && !page.includes(chosen)) page.unshift(chosen);
    countInfo.textContent = `${matching.length} ${matching.length === 1 ? 'peça' : 'peças'}`;
    moreBtn.hidden = matching.length <= shown;
    moreBtn.textContent = `Mostrar mais (${matching.length - shown})`;
    for (const set of page) {
      const img = el('img', { alt: '', loading: 'lazy', width: 34, height: 84 });
      const btn = el('button', { type: 'button', className: 'set-item' }, [img]);
      btn.title =
        set.library && !set.library.startsWith('hh_human_')
          ? `${set.library.replace(/^.*?_[MFU]_/, '').replace(/_/g, ' ')} (#${set.id})`
          : `${cat.label} #${set.id}`;
      btn.setAttribute('aria-label', `${cat.label} ${set.id}`);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(set.id === selected));
      if (set.club > 0) btn.classList.add('set-club');
      if (set.animated) btn.classList.add('set-animated');
      // Catálogo completo: prévia estática da CDN; peças básicas: o imager.
      const thumbs = [
        ...(set.rev && set.library ? [clothingPreviewUrl(set.library, set.id, set.rev)] : []),
        clothingSetImageUrl(set.id, { direction: 2 }, '/hh'),
        clothingSetImageUrl(set.id, { direction: 2 }),
      ];
      const noThumb = () =>
        btn.replaceChildren(el('span', { className: 'set-fallback', textContent: `#${set.id}` }));
      if (opts.thumbnails === false) noThumb();
      else thumbQueue.load(img, thumbs, noThumb);
      btn.addEventListener('click', () => update(withPart(figure, manifest, cat.type, set.id)));
      items.push(btn);
    }
    setsGrid.setAttribute('aria-label', cat.label);
    setsGrid.replaceChildren(...items);
  }

  function renderColors(): void {
    const cat = category();
    const part = currentPart(cat.type);
    const set = part && findSet(cat, part.setId);
    if (!part || !set) {
      colorsBox.replaceChildren();
      return;
    }
    if (set.colors === 0) {
      colorsBox.replaceChildren(
        el('p', { className: 'muted', textContent: 'Esta peça não muda de cor.' }),
      );
      return;
    }
    const palette = manifest.palettes[set.palette ?? cat.palette] ?? [];
    const rows = Array.from({ length: set.colors }, (_, i) => {
      const swatches = palette.map((c) => {
        const b = el('button', { type: 'button', className: 'swatch' });
        b.style.background = c.hex;
        b.title = c.hex;
        b.setAttribute('aria-label', `Cor ${c.hex}`);
        b.setAttribute('aria-pressed', String(part.colors[i] === c.id));
        b.addEventListener('click', () => {
          const colors = [...part.colors];
          colors[i] = c.id;
          update(withPart(figure, manifest, cat.type, set.id, colors));
        });
        return b;
      });
      const label = set.colors > 1 ? `Cor ${i + 1}` : 'Cor';
      return el('div', { className: 'swatch-row' }, [
        el('p', { className: 'swatch-label', textContent: label }),
        el('div', { className: 'swatches' }, swatches),
      ]);
    });
    colorsBox.replaceChildren(...rows);
  }

  function renderLooks(): void {
    if (!opts.looks) return;
    const slots = Array.from({ length: LOOK_SLOTS }, (_, slot) => {
      const look = looks.find((l) => l.slot === slot);
      const box = el('div', { className: `look-slot${look ? '' : ' empty'}` });
      const apply = el('button', { type: 'button', className: 'look-apply' });
      apply.setAttribute('aria-label', look ? `Usar look ${slot + 1}` : `Look ${slot + 1} vazio`);
      apply.disabled = !look;
      if (look) {
        const img = el('img', { alt: '', width: 32, height: 55, loading: 'lazy' });
        img.src = avatarImageUrl(look.figure, { direction: 2, headDirection: 2 }, '/hh');
        apply.append(img);
        apply.addEventListener('click', () => {
          if (look.gender !== gender) {
            gender = look.gender;
            renderGender();
          }
          update(look.figure);
        });
      } else apply.append(el('span', { textContent: String(slot + 1) }));
      const save = el('button', { type: 'button', className: 'look-save', textContent: '💾' });
      save.title = 'Guardar o visual atual aqui';
      save.setAttribute('aria-label', `Guardar no look ${slot + 1}`);
      save.addEventListener('click', async () => {
        const res = validateFigure(figure, gender, manifest);
        if (!res.ok) {
          errorBox.hidden = false;
          errorBox.textContent = res.error;
          return;
        }
        looksVersion++;
        try {
          looks = await opts.looks!.save(slot, { figure: res.figure, gender });
          renderLooks();
        } catch (err) {
          errorBox.hidden = false;
          errorBox.textContent = (err as Error).message;
        }
      });
      box.append(apply, save);
      if (look) {
        const del = el('button', {
          type: 'button',
          className: 'look-del',
          innerHTML: iconHtml('x', 16),
        });
        del.setAttribute('aria-label', `Apagar look ${slot + 1}`);
        del.addEventListener('click', async () => {
          looksVersion++;
          looks = await opts.looks!.remove(slot);
          renderLooks();
        });
        box.append(del);
      }
      return box;
    });
    looksBox.replaceChildren(
      el('strong', { textContent: 'Looks salvos' }),
      el('div', { className: 'look-row' }, slots),
    );
  }

  function renderAll(): void {
    renderGender();
    renderTabs();
    renderSets();
    renderColors();
  }

  function update(next: string): void {
    figure = next;
    errorBox.hidden = true;
    renderSets();
    renderColors();
    schedulePreview();
  }

  // ---------- Eventos ----------
  setSpin(!motionReduced());
  rotateLeft.addEventListener('click', () => {
    setSpin(false);
    dir = (dir + 1) % 8;
    schedulePreview();
  });
  rotateRight.addEventListener('click', () => {
    setSpin(false);
    dir = (dir + 7) % 8;
    schedulePreview();
  });
  for (const b of genderButtons) {
    b.addEventListener('click', () => {
      const g = b.dataset.gender as Gender;
      if (g === gender) return;
      gender = g;
      figure = switchGender(figure, g, manifest);
      renderAll();
      schedulePreview();
    });
  }
  randomBtn.addEventListener('click', () => update(randomFigure(manifest, gender)));
  let searchTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      query = search.value.trim();
      shown = PAGE;
      renderSets();
    }, 150);
  });
  search.addEventListener('keydown', (e) => e.stopPropagation());
  clubSelect.addEventListener('change', () => {
    club = clubSelect.value as ClubFilter;
    shown = PAGE;
    renderSets();
  });
  moreBtn.addEventListener('click', () => {
    shown += PAGE;
    renderSets();
  });
  if (opts.looks) {
    const version = looksVersion;
    void opts.looks
      .load()
      .then((l) => {
        // Se a pessoa já guardou ou apagou um look, esta resposta está velha.
        if (version !== looksVersion) return;
        looks = l;
        renderLooks();
      })
      .catch(() => undefined);
    renderLooks();
  }
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = manifest.categories.findIndex((c) => c.type === activeType);
    const n = manifest.categories.length;
    activeType = manifest.categories[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n]!.type;
    renderAll();
    tabs.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
  });

  renderAll();
  schedulePreview();
  tabs.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();

  return new Promise((resolve) => {
    const close = (result: AvatarChoice | null) => {
      clearTimeout(previewTimer);
      clearInterval(spinTimer);
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      opener?.focus();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);
    cancelBtn.addEventListener('click', () => close(null));
    closeBtn.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
    saveBtn.addEventListener('click', () => {
      const res = validateFigure(figure, gender, manifest);
      if (!res.ok) {
        errorBox.hidden = false;
        errorBox.textContent = res.error;
        return;
      }
      close({ figure: res.figure, gender });
    });
  });
}
