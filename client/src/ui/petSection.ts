import {
  furniSprites,
  habboPetType,
  HABBO_PET_NAMES,
  HABBO_PET_PREFIX,
  HABBO_PET_TINTS,
  PET_COLOR_COUNT,
  PET_NAME_MAX,
  PET_SPECIES,
  PET_SPECIES_LABELS,
  type HabboPetCatalog,
  type PetInfo,
  type PetSpecies,
} from '@office/shared';
import { petPreview, PET_SWATCH } from '../assets/petArt.js';
import { FurniVisualLibrary, type LoadedFurniVisual } from '../assets/FurniVisualLibrary.js';
import { OFFLINE_ASSETS } from '../config.js';
import { petApi } from '../net/api.js';
import { undoable } from './toasts.js';
import { skeleton } from './skeleton.js';

/** Pets do Habbo (Fase 38): catálogo e desenhos, compartilhados entre aberturas do Perfil. */
const visuals = new FurniVisualLibrary(!OFFLINE_ASSETS);

/** Nome da espécie (do Habbo ou desenhada). */
export function petSpeciesLabel(species: string): string {
  const type = habboPetType(species);
  if (type) return HABBO_PET_NAMES[type] ?? type;
  return PET_SPECIES_LABELS[species as PetSpecies] ?? species;
}

/**
 * Pet do Habbo em pé, de frente (direção 2), num canvas: as camadas da folha, a paleta já
 * aplicada pelo servidor e a cor escolhida multiplicando as partes pintáveis.
 */
function drawHabboPet(lib: LoadedFurniVisual, tint: string, scale = 2): HTMLCanvasElement {
  const v = lib.visual;
  const sprites = furniSprites(v, 2, v.postures?.std ?? 0, 0).filter(
    (s) => lib.textures.has(s.image) && v.frames[s.image],
  );
  // Recorta no desenho (cada pet tem um tamanho).
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of sprites) {
    const f = v.frames[s.image]!;
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x + f.w);
    y1 = Math.max(y1, s.y + f.h);
  }
  const out = document.createElement('canvas');
  out.width = Math.max(1, (x1 - x0) * scale);
  out.height = Math.max(1, (y1 - y0) * scale);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  for (const s of sprites) {
    const tex = lib.textures.get(s.image)!;
    const f = v.frames[s.image]!;
    const img = tex.source.resource as CanvasImageSource;
    const tmp = document.createElement('canvas');
    tmp.width = f.w;
    tmp.height = f.h;
    const t = tmp.getContext('2d')!;
    t.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    if (s.palette && tint !== 'ffffff') {
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = `#${tint}`;
      t.fillRect(0, 0, f.w, f.h);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    }
    ctx.save();
    ctx.globalAlpha = s.alpha / 255;
    if (s.ink === 33) ctx.globalCompositeOperation = 'lighter';
    const x = s.x - x0;
    const y = s.y - y0;
    if (s.flip) {
      ctx.translate(x + f.w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.drawImage(tmp, x, y);
    }
    ctx.restore();
  }
  return out;
}

/** Prévia de qualquer pet (o do Habbo carrega; enquanto isso, um espaço vazio). */
function petPicture(p: PetInfo, scale: number): HTMLElement {
  const type = habboPetType(p.species);
  if (!type) return petPreview(p.species as PetSpecies, p.color, scale);
  const box = document.createElement('div');
  box.className = 'pet-habbo-preview';
  void visuals.loadPet(type, p.color).then((lib) => {
    if (lib) box.replaceChildren(drawHabboPet(lib, p.tint, scale));
    else box.textContent = '🐾';
  });
  return box;
}

/**
 * Seção "Meu pet" do perfil: adotar (nome, espécie e pelagem), editar ou soltar. Além dos
 * desenhados, os pets do Habbo (Fase 38) com padrão de pelagem e cor. O pet aparece na sala na
 * hora (o servidor avisa as salas abertas).
 */
export function mountPetSection(box: HTMLElement, token: string): void {
  let pet: PetInfo | null = null;
  let editing = false;
  let catalog: HabboPetCatalog | null = null;

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, unknown> = {},
  ): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

  const render = () => {
    box.replaceChildren(el('h3', { textContent: '🐾 Meu pet' }));
    if (pet && !editing) return renderPet(pet);
    renderForm(
      pet ? { ...pet } : { name: '', species: `${HABBO_PET_PREFIX}dog`, color: 0, tint: 'ffffff' },
    );
  };

  const renderPet = (p: PetInfo) => {
    const row = el('div', { className: 'pet-card' });
    const info = el('div');
    info.append(
      el('strong', { textContent: p.name }),
      el('p', { className: 'muted', textContent: petSpeciesLabel(p.species) }),
      el('p', { className: 'muted pet-hint', textContent: 'No chat: /senta, /deita e /vem.' }),
    );
    row.append(petPicture(p, 2), info);
    const actions = el('div', { className: 'pet-actions' });
    const edit = el('button', {
      type: 'button',
      className: 'btn-secondary',
      textContent: 'Editar',
    });
    edit.addEventListener('click', () => {
      editing = true;
      render();
    });
    const release = el('button', { type: 'button', className: 'btn-link', textContent: 'Soltar' });
    // Soltar com "Desfazer" (Fase 45): o pet só sai da sala quando o aviso some.
    release.addEventListener('click', () => {
      pet = null;
      render();
      undoable(
        `${p.name} foi solto.`,
        () => void petApi.release(token),
        () => {
          pet = p;
          render();
        },
      );
    });
    actions.append(edit, release);
    box.append(row, actions);
    if (!habboPetType(p.species) && catalog?.pets.length) {
      box.append(
        el('p', {
          className: 'muted pet-hint',
          textContent: 'Novidade: pets do Habbo de verdade. Clique em Editar para trocar.',
        }),
      );
    }
  };

  const renderForm = (draft: PetInfo) => {
    if (!pet) {
      box.append(
        el('p', {
          className: 'muted',
          textContent: 'Adote um bichinho: ele segue você pelo escritório.',
        }),
      );
    }
    const form = el('form', { className: 'pet-form', noValidate: true });
    const preview = el('div', { className: 'pet-preview' });
    const name = el('input', {
      name: 'petName',
      maxLength: PET_NAME_MAX,
      placeholder: 'Nome do pet',
      value: draft.name,
    });
    name.setAttribute('aria-label', 'Nome do pet');
    const species = el('select', { className: 'pet-species-select' });
    species.setAttribute('aria-label', 'Espécie');
    const habboGroup = el('optgroup', { label: 'Pets do Habbo' });
    for (const p of catalog?.pets ?? []) {
      habboGroup.append(
        el('option', { value: `${HABBO_PET_PREFIX}${p.type}`, textContent: p.name }),
      );
    }
    const drawnGroup = el('optgroup', { label: 'Desenhados' });
    for (const sp of PET_SPECIES) {
      drawnGroup.append(el('option', { value: sp, textContent: PET_SPECIES_LABELS[sp] }));
    }
    if (habboGroup.children.length) species.append(habboGroup);
    species.append(drawnGroup);
    if (![...species.options].some((o) => o.value === draft.species)) {
      draft.species = PET_SPECIES[0];
      draft.color = 0;
    }
    species.value = draft.species;
    species.addEventListener('change', () => {
      draft.species = species.value;
      draft.color = 0;
      draw();
    });
    const patternRow = el('div', { className: 'pet-patterns', role: 'radiogroup' });
    patternRow.setAttribute('aria-label', 'Padrão da pelagem');
    const colorRow = el('div', { className: 'pet-colors', role: 'radiogroup' });
    colorRow.setAttribute('aria-label', 'Pelagem');
    const error = el('p', { className: 'login-error', hidden: true });
    error.setAttribute('role', 'alert');

    const swatch = (label: string, pressed: boolean, bg: string, pick: () => void) => {
      const b = el('button', { type: 'button', className: 'pet-swatch', title: label });
      b.style.background = bg;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-checked', String(pressed));
      b.addEventListener('click', () => {
        pick();
        draw();
      });
      return b;
    };

    const draw = () => {
      preview.replaceChildren(petPicture(draft, 2));
      const type = habboPetType(draft.species);
      if (!type) {
        patternRow.replaceChildren();
        patternRow.hidden = true;
        colorRow.setAttribute('aria-label', 'Pelagem');
        colorRow.replaceChildren(
          ...Array.from({ length: PET_COLOR_COUNT }, (_, c) =>
            swatch(
              `Pelagem ${c + 1}`,
              c === draft.color,
              PET_SWATCH(draft.species as PetSpecies, c),
              () => {
                draft.color = c;
              },
            ),
          ),
        );
        return;
      }
      const palettes = catalog?.pets.find((p) => p.type === type)?.palettes.length ?? 0;
      patternRow.hidden = palettes < 2;
      patternRow.replaceChildren(
        ...Array.from({ length: palettes }, (_, i) => {
          const b = el('button', {
            type: 'button',
            className: 'pet-pattern',
            textContent: String(i + 1),
            title: `Padrão ${i + 1}`,
          });
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-label', `Padrão ${i + 1}`);
          b.setAttribute('aria-checked', String(i === draft.color));
          b.addEventListener('click', () => {
            draft.color = i;
            draw();
          });
          return b;
        }),
      );
      colorRow.setAttribute('aria-label', 'Cor');
      colorRow.replaceChildren(
        ...HABBO_PET_TINTS.map((t, i) =>
          swatch(i === 0 ? 'Cor original' : `Cor ${i}`, t === draft.tint, `#${t}`, () => {
            draft.tint = t;
          }),
        ),
      );
    };
    draw();

    const submit = el('button', {
      type: 'submit',
      className: 'btn-primary',
      textContent: pet ? 'Salvar pet' : 'Adotar',
    });
    const buttons = el('div', { className: 'pet-actions' });
    buttons.append(submit);
    if (pet) {
      const cancel = el('button', {
        type: 'button',
        className: 'btn-link',
        textContent: 'Cancelar',
      });
      cancel.addEventListener('click', () => {
        editing = false;
        render();
      });
      buttons.append(cancel);
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        pet = await petApi.save(token, { ...draft, name: name.value });
        editing = false;
        render();
      } catch (err) {
        error.hidden = false;
        error.textContent = (err as Error).message;
      } finally {
        submit.disabled = false;
      }
    });
    const fields = el('div', { className: 'pet-fields field' });
    fields.append(name, species, patternRow, colorRow);
    const top = el('div', { className: 'pet-form-top' });
    top.append(preview, fields);
    form.append(top, error, buttons);
    box.append(form);
  };

  box.replaceChildren(el('h3', { textContent: '🐾 Meu pet' }), skeleton());
  Promise.all([petApi.get(token), visuals.petCatalog()])
    .then(([r, c]) => {
      pet = r.pet;
      catalog = c;
      render();
    })
    .catch(() => {
      box.replaceChildren(
        el('p', { className: 'muted', textContent: 'Não foi possível carregar o pet.' }),
      );
    });
}
