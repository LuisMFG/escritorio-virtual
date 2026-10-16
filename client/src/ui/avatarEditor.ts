import {
  avatarImageUrl,
  clothingSetImageUrl,
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

export interface AvatarChoice {
  figure: string;
  gender: Gender;
}

export interface AvatarEditorOptions extends AvatarChoice {
  manifest: AvatarManifest;
  /** Prévia gerada por código quando o imager não responde (data URL). */
  fallbackPreview: (figure: string, dir: number) => Promise<string>;
  saveLabel?: string;
}

const PREVIEW_DEBOUNCE_MS = 250;

/** Imagem que tenta várias URLs em ordem e chama `onFail` se todas falharem. */
function loadWithFallback(img: HTMLImageElement, urls: string[], onFail: () => void): void {
  const queue = [...urls];
  img.onerror = () => {
    const next = queue.shift();
    if (next) img.src = next;
    else {
      img.onerror = null;
      onFail();
    }
  };
  img.src = queue.shift()!;
}

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
  const opener = document.activeElement as HTMLElement | null;

  // ---------- Estrutura ----------
  const previewImg = el('img', { alt: 'Prévia do seu avatar', width: 128, height: 220 });
  const previewStage = el('div', { className: 'preview-stage' }, [previewImg]);
  const rotateLeft = el('button', {
    type: 'button',
    className: 'icon-btn',
    textContent: '⟲',
    title: 'Girar',
  });
  const rotateRight = el('button', {
    type: 'button',
    className: 'icon-btn',
    textContent: '⟳',
    title: 'Girar',
  });
  rotateLeft.setAttribute('aria-label', 'Girar para a esquerda');
  rotateRight.setAttribute('aria-label', 'Girar para a direita');

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
  const closeBtn = el('button', { type: 'button', className: 'icon-btn', textContent: '×' });
  closeBtn.setAttribute('aria-label', 'Fechar editor');

  const title = el('h2', { id: 'editor-title', textContent: 'Seu visual' });
  const dialog = el('div', { className: 'editor' }, [
    el('header', { className: 'editor-head' }, [title, closeBtn]),
    el('div', { className: 'editor-body' }, [
      el('section', { className: 'editor-preview' }, [
        previewStage,
        el('div', { className: 'editor-rotate' }, [rotateLeft, rotateRight]),
        genderGroup,
        randomBtn,
      ]),
      el('section', { className: 'editor-pick' }, [tabs, setsGrid, colorsBox]),
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
          renderAll();
        });
        return tab;
      }),
    );
  }

  function renderSets(): void {
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
    for (const set of cat.sets.filter((s) => setFitsGender(s, gender))) {
      const img = el('img', { alt: '', loading: 'lazy', width: 34, height: 84 });
      const btn = el('button', { type: 'button', className: 'set-item' }, [img]);
      btn.title = `${cat.label} #${set.id}`;
      btn.setAttribute('aria-label', `${cat.label} ${set.id}`);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(set.id === selected));
      loadWithFallback(
        img,
        [
          clothingSetImageUrl(set.id, { direction: 2 }, '/hh'),
          clothingSetImageUrl(set.id, { direction: 2 }),
        ],
        () =>
          btn.replaceChildren(el('span', { className: 'set-fallback', textContent: `#${set.id}` })),
      );
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
    const palette = manifest.palettes[cat.palette] ?? [];
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
  rotateLeft.addEventListener('click', () => {
    dir = (dir + 1) % 8;
    schedulePreview();
  });
  rotateRight.addEventListener('click', () => {
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
