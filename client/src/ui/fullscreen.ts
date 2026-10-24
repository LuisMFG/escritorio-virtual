/**
 * Tela cheia de um elemento (a chamada inteira ou um vídeo). Onde o navegador não deixa (o
 * Safari do iPhone só põe um `<video>` em tela cheia), o vídeo vai pelo player do sistema; sem
 * nada disso, o elemento cobre a janela (`.pseudo-full`) até sair.
 */
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

const PSEUDO = 'pseudo-full';
const listeners = new Set<() => void>();

/** Avisa quando entra ou sai da tela cheia (de verdade ou pela janela). */
export function onFullscreenChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const notify = () => {
  for (const fn of listeners) fn();
};
document.addEventListener('fullscreenchange', notify);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const el = document.querySelector(`.${PSEUDO}`);
  if (!el) return;
  el.classList.remove(PSEUDO);
  notify();
});

/** O elemento em tela cheia agora (de verdade ou cobrindo a janela). */
export function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? document.querySelector(`.${PSEUDO}`);
}

export function isFullscreen(el: Element): boolean {
  return fullscreenElement() === el;
}

export async function enterFullscreen(el: HTMLElement, video?: HTMLVideoElement): Promise<void> {
  await exitFullscreen();
  if (typeof el.requestFullscreen === 'function') {
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
      return;
    } catch {
      // recusado (iframe, celular): tenta os outros jeitos
    }
  }
  const v = video as WebkitVideo | undefined;
  if (v?.webkitEnterFullscreen) {
    v.webkitEnterFullscreen();
    return;
  }
  el.classList.add(PSEUDO);
  notify();
}

export async function exitFullscreen(): Promise<void> {
  const pseudo = document.querySelector(`.${PSEUDO}`);
  if (pseudo) {
    pseudo.classList.remove(PSEUDO);
    notify();
  }
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
}

export async function toggleFullscreen(el: HTMLElement, video?: HTMLVideoElement): Promise<void> {
  if (isFullscreen(el)) await exitFullscreen();
  else await enterFullscreen(el, video);
}
