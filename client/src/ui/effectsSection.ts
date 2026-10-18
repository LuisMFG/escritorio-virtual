import { EFFECTS, unlockHint, type EffectId, type EffectsResponse } from '@office/shared';
import { effectsApi } from '../net/api.js';

/**
 * Seção "Efeitos" do perfil: os efeitos do Habbo liberados por conquistas e elogios. O escolhido
 * aparece sempre sobre o avatar (as comemorações passam por cima por alguns segundos).
 */
export function mountEffectsSection(box: HTMLElement, token: string): void {
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, unknown> = {},
  ): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);
  const title = el('h3', { textContent: '✨ Efeitos' });
  const error = el('p', { className: 'login-error', hidden: true });

  const render = (r: EffectsResponse) => {
    error.hidden = true;
    const list = el('div', { className: 'effects-grid' });
    const choose = async (id: EffectId | null) => {
      try {
        render(await effectsApi.set(token, id));
      } catch (err) {
        error.hidden = false;
        error.textContent = (err as Error).message;
      }
    };
    for (const { id, unlocked } of r.effects) {
      if (EFFECTS[id].unlock.kind === 'achievements' && EFFECTS[id].unlock.count > 100) continue;
      const def = EFFECTS[id];
      const using = r.current === id;
      const item = el('button', {
        type: 'button',
        className: `effect-item${using ? ' using' : ''}${unlocked ? '' : ' locked'}`,
        disabled: !unlocked,
      });
      item.setAttribute('aria-pressed', String(using));
      item.setAttribute('aria-label', `${def.name}${unlocked ? '' : ` (${unlockHint(id)})`}`);
      item.append(
        el('span', { className: 'effect-emoji', textContent: unlocked ? def.emoji : '🔒' }),
        el('strong', { textContent: def.name }),
        el('small', {
          className: 'muted',
          textContent: using ? 'Em uso' : unlocked ? 'Usar' : unlockHint(id),
        }),
      );
      item.addEventListener('click', () => void choose(using ? null : id));
      list.append(item);
    }
    const intro = el('p', {
      className: 'muted spotify-intro',
      textContent:
        'Liberados com conquistas e elogios. Clique para usar (de novo para tirar). Em comemorações (conquista, elogio, fim do foco, aniversário) aparece um efeito especial por alguns segundos.',
    });
    box.replaceChildren(title, intro, list, error);
  };

  box.replaceChildren(title, el('p', { className: 'muted', textContent: 'Carregando…' }));
  effectsApi
    .list(token)
    .then(render)
    .catch(() =>
      box.replaceChildren(
        title,
        el('p', { className: 'muted', textContent: 'Não foi possível carregar.' }),
      ),
    );
}
