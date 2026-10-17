import type { SpotifyStatus } from '@office/shared';
import { spotifyApi } from '../net/api.js';
import { confirmDialog } from './confirm.js';

/**
 * Seção "Spotify" do perfil: conectar a conta (vai para a página do Spotify e volta),
 * mostrar ou esconder a música e desconectar.
 */
export function mountSpotifySection(box: HTMLElement, token: string): void {
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, unknown> = {},
  ): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);
  const title = el('h3', { textContent: '🎵 Spotify' });
  const error = el('p', { className: 'login-error', hidden: true });

  const fail = (err: unknown) => {
    error.hidden = false;
    error.textContent = (err as Error).message;
  };

  const render = (s: SpotifyStatus) => {
    error.hidden = true;
    if (!s.configured) {
      box.replaceChildren(
        title,
        el('p', {
          className: 'muted spotify-intro',
          textContent:
            'O Spotify ainda não foi configurado neste escritório. Um administrador precisa criar o app no Spotify e definir SPOTIFY_CLIENT_ID no servidor.',
        }),
      );
      return;
    }
    if (!s.linked) {
      const connect = el('button', {
        type: 'button',
        className: 'btn-spotify',
        textContent: 'Conectar Spotify',
      });
      connect.addEventListener('click', async () => {
        connect.disabled = true;
        try {
          const { url } = await spotifyApi.connect(token);
          location.href = url;
        } catch (err) {
          connect.disabled = false;
          fail(err);
        }
      });
      box.replaceChildren(
        title,
        el('p', {
          className: 'muted spotify-intro',
          textContent:
            'Mostre no seu cartão a música que você está ouvindo. Você vai para a página do Spotify autorizar e volta para cá.',
        }),
        connect,
        error,
      );
      return;
    }
    const show = el('label', { className: 'spotify-toggle' });
    const check = el('input', { type: 'checkbox', checked: !s.hidden });
    check.addEventListener('change', async () => {
      try {
        render(await spotifyApi.setHidden(token, !check.checked));
      } catch (err) {
        fail(err);
      }
    });
    show.append(check, ' Mostrar o que estou ouvindo');
    const disconnect = el('button', {
      type: 'button',
      className: 'btn-link',
      textContent: 'Desconectar',
    });
    disconnect.addEventListener('click', async () => {
      const yes = await confirmDialog('Desconectar o Spotify? A música deixa de aparecer.', {
        confirmLabel: 'Desconectar',
      });
      if (!yes) return;
      try {
        render(await spotifyApi.disconnect(token));
      } catch (err) {
        fail(err);
      }
    });
    const who = el('p', {
      className: 'spotify-intro',
      textContent: `Conectado${s.displayName ? ` como ${s.displayName}` : ''}. Pausou ou parou, a linha some.`,
    });
    const actions = el('div', { className: 'pet-actions' });
    actions.append(show, disconnect);
    box.replaceChildren(title, who, actions, error);
  };

  box.replaceChildren(title, el('p', { className: 'muted', textContent: 'Carregando…' }));
  spotifyApi
    .status(token)
    .then(render)
    .catch(() =>
      box.replaceChildren(
        title,
        el('p', { className: 'muted', textContent: 'Não foi possível carregar.' }),
      ),
    );
}
