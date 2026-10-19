import { badgeImageUrl, findAchievement, parseShowcase, type AchievementDef } from '@office/shared';
import { OFFLINE_ASSETS } from '../config.js';

/**
 * Emblema de conquista: o emblema do Habbo escolhido para ela (Fase 39). Sem internet, ou se a
 * imagem não carregar, a medalha redonda com o emoji sobre a cor da conquista (arte própria, em
 * CSS). Bloqueado = cinza.
 */
export function badgeEl(def: AchievementDef, opts: { locked?: boolean; size?: number } = {}) {
  const el = Object.assign(document.createElement('span'), {
    className: `badge${opts.locked ? ' locked' : ''}`,
    title: `${def.name}: ${def.description}`,
  });
  el.style.setProperty('--badge', def.color);
  if (opts.size) el.style.setProperty('--size', `${opts.size}px`);
  el.setAttribute('aria-label', def.name);
  el.setAttribute('role', 'img');
  if (OFFLINE_ASSETS) {
    el.textContent = def.emoji;
    return el;
  }
  el.classList.add('badge-habbo');
  const img = Object.assign(document.createElement('img'), {
    alt: '',
    src: badgeImageUrl(def.badge),
  });
  img.dataset.badge = def.badge;
  img.addEventListener('error', () => {
    el.classList.remove('badge-habbo');
    el.textContent = def.emoji;
  });
  el.append(img);
  return el;
}

/** Linha com os emblemas exibidos por alguém (`badges` do estado). */
export function showcaseRow(badges: string, size = 32): HTMLElement | null {
  const ids = parseShowcase(badges);
  if (ids.length === 0) return null;
  const row = Object.assign(document.createElement('p'), { className: 'badge-row' });
  for (const id of ids) row.append(badgeEl(findAchievement(id)!, { size }));
  return row;
}

/** Aviso dourado no topo: "Conquista desbloqueada!". Some sozinho. */
export function showAchievementToast(def: AchievementDef, onOpen: () => void): void {
  const box = document.createElement('div');
  box.className = 'achievement-toast';
  box.setAttribute('role', 'status');
  const text = document.createElement('div');
  text.append(
    Object.assign(document.createElement('small'), { textContent: 'Conquista desbloqueada!' }),
    Object.assign(document.createElement('strong'), { textContent: def.name }),
    Object.assign(document.createElement('span'), { textContent: def.description }),
  );
  const open = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'btn-secondary btn-small',
    textContent: 'Ver conquistas',
  });
  open.addEventListener('click', () => {
    box.remove();
    onOpen();
  });
  box.append(badgeEl(def, { size: 44 }), text, open);
  // Vários de uma vez: empilha.
  const others = document.querySelectorAll('.achievement-toast').length;
  box.style.setProperty('--stack', String(others));
  document.body.append(box);
  setTimeout(() => box.remove(), 7000);
}
