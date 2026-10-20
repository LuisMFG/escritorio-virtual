import { ACHIEVEMENTS, SHOWCASE_MAX, type AchievementsResponse } from '@office/shared';
import { achievementApi } from '../net/api.js';
import { badgeEl } from './badges.js';
import { skeleton } from './skeleton.js';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

/**
 * Seção "Conquistas" do perfil: todas as conquistas (as que faltam em cinza, com progresso)
 * e a escolha de até 3 emblemas para exibir no cartão.
 */
export async function mountAchievements(box: HTMLElement, token: string): Promise<void> {
  const title = Object.assign(document.createElement('h3'), { textContent: '🏅 Conquistas' });
  box.replaceChildren(title, skeleton(4));
  let data: AchievementsResponse;
  try {
    data = await achievementApi.me(token);
  } catch {
    box.replaceChildren(
      title,
      Object.assign(document.createElement('p'), {
        className: 'muted',
        textContent: 'Não foi possível carregar as conquistas.',
      }),
    );
    return;
  }
  const unlockedAt = new Map(data.unlocked.map((u) => [u.id, u.at]));
  let showcase = [...data.showcase];

  const hint = Object.assign(document.createElement('p'), { className: 'muted achievements-hint' });
  const grid = Object.assign(document.createElement('ul'), { className: 'achievements-grid' });
  const error = Object.assign(document.createElement('p'), {
    className: 'login-error',
    hidden: true,
  });

  const render = () => {
    title.textContent = `🏅 Conquistas (${unlockedAt.size}/${ACHIEVEMENTS.length})`;
    hint.textContent =
      unlockedAt.size === 0
        ? 'Converse, decore, jogue e participe das reuniões para ganhar emblemas.'
        : `Clique nas conquistas para exibir até ${SHOWCASE_MAX} emblemas no seu cartão (${showcase.length}/${SHOWCASE_MAX}).`;
    grid.replaceChildren(
      ...ACHIEVEMENTS.map((def) => {
        const at = unlockedAt.get(def.id);
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'achievement';
        const shown = showcase.includes(def.id);
        if (shown) b.classList.add('shown');
        b.disabled = at === undefined;
        b.setAttribute('aria-pressed', String(shown));
        const value = def.stat ? (data.stats[def.stat] ?? 0) : 0;
        const status =
          at !== undefined
            ? `Desde ${dateFormat.format(at)}${shown ? ' · no cartão' : ''}`
            : def.goal && def.goal > 1
              ? `${Math.min(value, def.goal)}/${def.goal}`
              : 'Bloqueada';
        const text = document.createElement('span');
        text.append(
          Object.assign(document.createElement('strong'), { textContent: def.name }),
          Object.assign(document.createElement('small'), { textContent: def.description }),
          Object.assign(document.createElement('small'), {
            className: 'muted',
            textContent: status,
          }),
        );
        b.append(badgeEl(def, { locked: at === undefined, size: 34 }), text);
        b.addEventListener('click', () => void toggle(def.id));
        li.append(b);
        return li;
      }),
    );
  };

  const toggle = async (id: string) => {
    error.hidden = true;
    const next = showcase.includes(id) ? showcase.filter((x) => x !== id) : [...showcase, id];
    if (next.length > SHOWCASE_MAX) {
      error.hidden = false;
      error.textContent = `No máximo ${SHOWCASE_MAX} emblemas. Tire um antes de escolher outro.`;
      return;
    }
    try {
      showcase = (await achievementApi.setShowcase(token, next)).showcase;
      render();
    } catch (err) {
      error.hidden = false;
      error.textContent = (err as Error).message;
    }
  };

  render();
  box.replaceChildren(title, hint, error, grid);

  // Conquista nova com o perfil aberto: busca de novo (para quando o perfil fecha).
  const onUnlocked = async () => {
    if (!box.isConnected) return window.removeEventListener('achievement-unlocked', onUnlocked);
    try {
      data = await achievementApi.me(token);
      unlockedAt.clear();
      for (const u of data.unlocked) unlockedAt.set(u.id, u.at);
      render();
    } catch {
      // fica a lista anterior
    }
  };
  window.addEventListener('achievement-unlocked', onUnlocked);
}
