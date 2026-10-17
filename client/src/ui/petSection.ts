import {
  PET_COLOR_COUNT,
  PET_NAME_MAX,
  PET_SPECIES,
  PET_SPECIES_LABELS,
  type PetInfo,
  type PetSpecies,
} from '@office/shared';
import { petPreview, PET_SWATCH } from '../assets/petArt.js';
import { petApi } from '../net/api.js';
import { confirmDialog } from './confirm.js';

/**
 * Seção "Meu pet" do perfil: adotar (nome, espécie e pelagem), editar ou soltar. O pet
 * aparece na sala na hora (o servidor avisa as salas abertas).
 */
export function mountPetSection(box: HTMLElement, token: string): void {
  let pet: PetInfo | null = null;
  let editing = false;

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, unknown> = {},
  ): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

  const render = () => {
    box.replaceChildren(el('h3', { textContent: '🐾 Meu pet' }));
    if (pet && !editing) return renderPet(pet);
    renderForm(pet ?? { name: '', species: 'dog', color: 0 });
  };

  const renderPet = (p: PetInfo) => {
    const row = el('div', { className: 'pet-card' });
    const info = el('div');
    info.append(
      el('strong', { textContent: p.name }),
      el('p', { className: 'muted', textContent: PET_SPECIES_LABELS[p.species] }),
      el('p', { className: 'muted pet-hint', textContent: 'No chat: /senta, /deita e /vem.' }),
    );
    row.append(petPreview(p.species, p.color, 2), info);
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
    release.addEventListener('click', async () => {
      const yes = await confirmDialog(`Soltar ${p.name}? Ele some da sala.`, {
        confirmLabel: 'Soltar',
        danger: true,
      });
      if (!yes) return;
      await petApi.release(token);
      pet = null;
      render();
    });
    actions.append(edit, release);
    box.append(row, actions);
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
    const speciesRow = el('div', { className: 'pet-species', role: 'radiogroup' });
    speciesRow.setAttribute('aria-label', 'Espécie');
    const colorRow = el('div', { className: 'pet-colors', role: 'radiogroup' });
    colorRow.setAttribute('aria-label', 'Pelagem');
    const error = el('p', { className: 'login-error', hidden: true });
    error.setAttribute('role', 'alert');

    const draw = () => {
      preview.replaceChildren(petPreview(draft.species, draft.color, 2));
      speciesRow.replaceChildren(
        ...PET_SPECIES.map((sp: PetSpecies) => {
          const b = el('button', {
            type: 'button',
            className: 'pet-option',
            title: PET_SPECIES_LABELS[sp],
          });
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(sp === draft.species));
          b.append(
            petPreview(sp, sp === draft.species ? draft.color : 0, 1),
            el('span', { textContent: PET_SPECIES_LABELS[sp] }),
          );
          b.addEventListener('click', () => {
            draft.species = sp;
            draw();
          });
          return b;
        }),
      );
      colorRow.replaceChildren(
        ...Array.from({ length: PET_COLOR_COUNT }, (_, c) => {
          const b = el('button', {
            type: 'button',
            className: 'pet-swatch',
            title: `Pelagem ${c + 1}`,
          });
          b.style.background = PET_SWATCH(draft.species, c);
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-label', `Pelagem ${c + 1}`);
          b.setAttribute('aria-checked', String(c === draft.color));
          b.addEventListener('click', () => {
            draft.color = c;
            draw();
          });
          return b;
        }),
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
    fields.append(name, speciesRow, colorRow);
    const top = el('div', { className: 'pet-form-top' });
    top.append(preview, fields);
    form.append(top, error, buttons);
    box.append(form);
  };

  box.replaceChildren(
    el('h3', { textContent: '🐾 Meu pet' }),
    el('p', { className: 'muted', textContent: 'Carregando…' }),
  );
  petApi
    .get(token)
    .then((r) => {
      pet = r.pet;
      render();
    })
    .catch(() => {
      box.replaceChildren(
        el('p', { className: 'muted', textContent: 'Não foi possível carregar o pet.' }),
      );
    });
}
