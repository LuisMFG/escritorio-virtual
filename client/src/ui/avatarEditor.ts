import {
  applyCostume,
  avatarImageUrl,
  costumeThemes,
  wearsCostume,
  clothingPreviewUrl,
  clothingSearchText,
  clothingSetImageUrl,
  LOOK_SLOTS,
  matchesSearch,
  nameKey,
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

/** Categorias da cabeça: a miniatura "vestida" mostra a parte de cima do avatar. */
const HEAD_TYPES = new Set(['hd', 'hr', 'ha', 'he', 'ea', 'fa']);

/** Aba das fantasias (não é uma categoria do manifesto). */
const COSTUMES_TAB = 'fantasias';

/** Editor aberto agora (abrir de novo foca este em vez de empilhar outro). */
let current: { promise: Promise<AvatarChoice | null>; dialog: HTMLElement } | null = null;

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
  if (current?.dialog.isConnected) {
    current.dialog.querySelector<HTMLElement>('[aria-selected=true]')?.focus();
    return current.promise;
  }
  const promise = openEditor(opts);
  return promise;
}

function openEditor(opts: AvatarEditorOptions): Promise<AvatarChoice | null> {
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
  // Desfazer a última troca (botão e Ctrl+Z).
  const undoBtn = el('button', {
    type: 'button',
    className: 'btn-secondary',
    innerHTML: `${iconHtml('undo', 16)} Desfazer`,
    disabled: true,
  });
  const history: { figure: string; gender: Gender }[] = [];
  const looksStatus = el('small', { className: 'muted look-status' });
  looksStatus.setAttribute('role', 'status');

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
        el('div', { className: 'editor-actions-row' }, [randomBtn, undoBtn]),
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

  // Abas: as categorias do manifesto e, no fim, as fantasias.
  const tabList = [
    ...manifest.categories.map((c) => ({ type: c.type, label: c.label })),
    { type: COSTUMES_TAB, label: 'Fantasias' },
  ];

  // ---------- Renderização ----------
  function category(): AvatarCategory {
    return findCategory(manifest, activeType)!;
  }

  function currentPart(type: string) {
    return parseFigure(figure).find((p) => p.type === type);
  }

  /** Prévia grande; `tryOn` mostra uma peça "no provador" (ao passar o mouse) sem escolher. */
  function schedulePreview(tryOn?: string): void {
    clearTimeout(previewTimer);
    previewStage.classList.add('loading');
    previewStage.classList.toggle('trying', Boolean(tryOn));
    previewTimer = window.setTimeout(() => {
      const f = tryOn ?? figure;
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
            if (f === (tryOn ?? figure) && d === dir) previewImg.src = url;
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
      ...tabList.map((c) => {
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
    // Nas fantasias a busca filtra pelo nome (sem o filtro do clube).
    const costumes = activeType === COSTUMES_TAB;
    clubSelect.hidden = costumes;
    search.placeholder = costumes
      ? 'Buscar fantasia (ex.: goku, pokémon)'
      : 'Buscar (ex.: terno, boné, asas)';
    if (costumes) return renderCostumes();
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
      // Sem largura/altura fixas: cada prévia tem a sua proporção (o CSS encaixa sem esticar).
      const img = el('img', { alt: '', loading: 'lazy', className: 'set-thumb' });
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
      // Catálogo completo: prévia estática da CDN; peças básicas: o imager; sem nenhuma das
      // duas, o seu avatar vestindo a peça (o imager monta qualquer peça).
      const tryOn = withPart(figure, manifest, cat.type, set.id);
      const wearing = avatarImageUrl(tryOn, { direction: 2, headDirection: 2 }, '/hh');
      const thumbs = [
        ...(set.rev && set.library ? [clothingPreviewUrl(set.library, set.id, set.rev)] : []),
        clothingSetImageUrl(set.id, { direction: 2 }, '/hh'),
        clothingSetImageUrl(set.id, { direction: 2 }),
        wearing,
      ];
      img.addEventListener('load', () => {
        if (img.src === wearing)
          img.classList.add('worn', HEAD_TYPES.has(cat.type) ? 'head' : 'body');
      });
      const noThumb = () =>
        btn.replaceChildren(el('span', { className: 'set-fallback', textContent: `#${set.id}` }));
      if (opts.thumbnails === false) noThumb();
      else thumbQueue.load(img, thumbs, noThumb);
      btn.addEventListener('click', () => update(withPart(figure, manifest, cat.type, set.id)));
      // Provador: passar o mouse mostra a peça na prévia grande.
      btn.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') schedulePreview(tryOn);
      });
      btn.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') schedulePreview();
      });
      items.push(btn);
    }
    setsGrid.setAttribute('role', 'listbox');
    setsGrid.setAttribute('aria-label', cat.label);
    setsGrid.replaceChildren(...items);
  }

  /**
   * Fantasias: cada versão aparece vestida no seu próprio avatar. Escolher troca só a roupa e os
   * acessórios (rosto, pele, cabelo, óculos e máscara ficam).
   */
  function renderCostumes(): void {
    moreBtn.hidden = true;
    const themes = costumeThemes()
      .map(({ theme, costumes }) => ({
        theme,
        costumes: costumes.filter(
          (c) => !query || matchesSearch(nameKey(`${theme} ${c.label}`), query),
        ),
      }))
      .filter((g) => g.costumes.length);
    const total = themes.reduce((n, g) => n + g.costumes.length, 0);
    countInfo.textContent = `${total} ${total === 1 ? 'fantasia' : 'fantasias'}`;
    const groups = themes.map(({ theme, costumes }) => {
      const items = costumes.map((c) => {
        const tryOn = applyCostume(figure, c, gender);
        const img = el('img', { alt: '', loading: 'lazy', className: 'set-thumb worn body' });
        const btn = el('button', { type: 'button', className: 'set-item costume-item' }, [
          img,
          el('span', { className: 'costume-label', textContent: c.label }),
        ]);
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-label', `${theme}: ${c.label}`);
        btn.setAttribute('aria-selected', String(wearsCostume(figure, c, gender)));
        const thumbs = [
          avatarImageUrl(tryOn, { direction: 2, headDirection: 2 }, '/hh'),
          avatarImageUrl(tryOn, { direction: 2, headDirection: 2 }),
        ];
        // Sem o imager: o avatar montado aqui mesmo (como a prévia grande).
        const local = () =>
          void opts
            .fallbackPreview(tryOn, 2)
            .then((url) => (img.src = url))
            .catch(() => img.remove());
        if (opts.thumbnails === false) local();
        else thumbQueue.load(img, thumbs, local);
        btn.addEventListener('click', () => update(applyCostume(figure, c, gender)));
        btn.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'mouse') schedulePreview(tryOn);
        });
        btn.addEventListener('pointerleave', (e) => {
          if (e.pointerType === 'mouse') schedulePreview();
        });
        return btn;
      });
      const list = el('div', { className: 'costume-list' }, items);
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', theme);
      return el('div', { className: 'costume-group' }, [
        el('strong', { className: 'costume-theme', textContent: theme }),
        list,
      ]);
    });
    setsGrid.removeAttribute('role');
    setsGrid.setAttribute('aria-label', 'Fantasias');
    setsGrid.replaceChildren(
      el('p', {
        className: 'muted costume-hint',
        textContent: 'Veste só a roupa e os acessórios: seu rosto e cabelo ficam como estão.',
      }),
      ...groups,
    );
  }

  function renderColors(): void {
    if (activeType === COSTUMES_TAB) {
      colorsBox.replaceChildren();
      return;
    }
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

  /** Guarda o visual atual num slot (com aviso de sucesso ou erro embaixo dos looks). */
  async function saveLook(slot: number): Promise<void> {
    const res = validateFigure(figure, gender, manifest);
    if (!res.ok) {
      looksStatus.textContent = res.error;
      return;
    }
    looksVersion++;
    looksStatus.textContent = 'Guardando…';
    try {
      looks = await opts.looks!.save(slot, { figure: res.figure, gender });
      renderLooks();
      looksStatus.textContent = `Look ${slot + 1} guardado ✓`;
    } catch (err) {
      looksStatus.textContent = `Não deu para guardar: ${(err as Error).message}`;
    }
  }

  /**
   * Looks salvos (redesenho de 20/10/2026): o espaço vazio guarda o visual atual com um clique;
   * o cheio mostra o look e veste ao clicar, com "Trocar" (guardar o atual por cima) e apagar.
   */
  function renderLooks(): void {
    if (!opts.looks) return;
    const slots = Array.from({ length: LOOK_SLOTS }, (_, slot) => {
      const look = looks.find((l) => l.slot === slot);
      const box = el('div', { className: `look-slot${look ? '' : ' empty'}` });
      if (!look) {
        const add = el('button', { type: 'button', className: 'look-add' });
        add.innerHTML = `${iconHtml('plus', 18)}<span>Guardar</span>`;
        add.title = 'Guardar o visual atual neste espaço';
        add.setAttribute('aria-label', `Guardar o visual atual no look ${slot + 1}`);
        add.addEventListener('click', () => void saveLook(slot));
        box.append(add);
        return box;
      }
      const apply = el('button', { type: 'button', className: 'look-apply' });
      apply.title = `Vestir o look ${slot + 1}`;
      apply.setAttribute('aria-label', `Usar look ${slot + 1}`);
      const img = el('img', { alt: '', loading: 'lazy', className: 'look-thumb' });
      loadWithFallback(
        img,
        [
          avatarImageUrl(look.figure, { direction: 2, headDirection: 2 }, '/hh'),
          avatarImageUrl(look.figure, { direction: 2, headDirection: 2 }),
        ],
        () => {
          void opts.fallbackPreview(look.figure, 2).then((url) => (img.src = url));
        },
      );
      apply.append(img, el('span', { className: 'look-num', textContent: String(slot + 1) }));
      apply.addEventListener('click', () => {
        if (look.gender !== gender) {
          history.push({ figure, gender });
          gender = look.gender;
          renderGender();
        }
        update(look.figure);
        looksStatus.textContent = `Vestindo o look ${slot + 1}. Salve o visual para usar na sala.`;
      });
      const replace = el('button', { type: 'button', className: 'look-replace' });
      replace.innerHTML = iconHtml('rotate-cw', 13);
      replace.title = 'Trocar pelo visual atual';
      replace.setAttribute('aria-label', `Guardar o visual atual no look ${slot + 1}`);
      replace.addEventListener('click', () => void saveLook(slot));
      const del = el('button', {
        type: 'button',
        className: 'look-del',
        innerHTML: iconHtml('x', 13),
      });
      del.title = 'Apagar este look';
      del.setAttribute('aria-label', `Apagar look ${slot + 1}`);
      del.addEventListener('click', async () => {
        looksVersion++;
        looks = await opts.looks!.remove(slot);
        renderLooks();
        looksStatus.textContent = `Look ${slot + 1} apagado.`;
      });
      box.append(apply, el('div', { className: 'look-tools' }, [replace, del]));
      return box;
    });
    looksBox.replaceChildren(
      el('strong', { textContent: 'Looks salvos' }),
      el('div', { className: 'look-row' }, slots),
      looksStatus,
    );
  }

  function renderAll(): void {
    renderGender();
    renderTabs();
    renderSets();
    renderColors();
  }

  function update(next: string, record = true): void {
    if (record && next !== figure) {
      history.push({ figure, gender });
      if (history.length > 40) history.shift();
      undoBtn.disabled = false;
    }
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
      history.push({ figure, gender });
      undoBtn.disabled = false;
      gender = g;
      figure = switchGender(figure, g, manifest);
      renderAll();
      schedulePreview();
    });
  }
  randomBtn.addEventListener('click', () => update(randomFigure(manifest, gender)));
  const undo = () => {
    const prev = history.pop();
    if (!prev) return;
    undoBtn.disabled = history.length === 0;
    if (prev.gender !== gender) {
      gender = prev.gender;
      renderAll();
    }
    update(prev.figure, false);
  };
  undoBtn.addEventListener('click', undo);
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
    const i = tabList.findIndex((c) => c.type === activeType);
    const n = tabList.length;
    activeType = tabList[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n]!.type;
    renderAll();
    tabs.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
  });

  renderAll();
  schedulePreview();
  tabs.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();

  const promise = new Promise<AvatarChoice | null>((resolve) => {
    const close = (result: AvatarChoice | null) => {
      clearTimeout(previewTimer);
      clearInterval(spinTimer);
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      opener?.focus();
      current = null;
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
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
  current = { promise, dialog };
  return promise;
}
