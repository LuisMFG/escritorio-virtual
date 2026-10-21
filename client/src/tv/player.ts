import { TV_PLAYLIST_MAX } from '@office/shared';

/**
 * Player da TV (Fase 51). O de verdade é o do YouTube (API do iframe, sem os controles dele: a
 * TV tem os seus, iguais para todo mundo). Nos testes de ponta a ponta entra um player de
 * mentira que só conta o tempo, para não depender da internet.
 */
export interface TvPlayer {
  /** Carrega um vídeo neste ponto (s), tocando ou parado. */
  load(videoId: string, at: number, playing: boolean): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** Ponto atual (s). */
  time(): number;
  /** Duração (s), quando já se sabe. */
  duration(): number | null;
  isPlaying(): boolean;
  /** Volume de 0 a 100 (só neste navegador). */
  setVolume(volume: number): void;
  destroy(): void;
}

export interface TvPlayerEvents {
  ended(): void;
  /** O navegador não deixou tocar sozinho: precisa de um clique. */
  blocked(blocked: boolean): void;
  error(message: string): void;
}

export type TvPlayerFactory = (host: HTMLElement, on: TvPlayerEvents) => TvPlayer;

// ---------- YouTube ----------

/* Só o pedaço da API do iframe que a TV usa. */
interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  cuePlaylist(o: { listType: 'playlist'; list: string }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaylist(): string[] | null;
  setVolume(v: number): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      host?: string;
      width?: string;
      height?: string;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const CUED = 5;

let api: Promise<YTNamespace> | null = null;

/** Carrega a API do player do YouTube uma vez só. */
function loadYouTubeApi(): Promise<YTNamespace> {
  const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      api = null;
      reject(new Error('Não deu para carregar o player do YouTube.'));
    };
    document.head.append(s);
  });
  return api;
}

const PLAYER_VARS = {
  controls: 0,
  disablekb: 1,
  modestbranding: 1,
  rel: 0,
  playsinline: 1,
  iv_load_policy: 3,
  fs: 0,
};

/** Erros do player do YouTube, em português. */
const YT_ERRORS: Record<number, string> = {
  2: 'Link de vídeo inválido.',
  5: 'Esse vídeo não toca neste navegador.',
  100: 'Vídeo removido ou privado.',
  101: 'O dono do vídeo não deixa assistir fora do YouTube.',
  150: 'O dono do vídeo não deixa assistir fora do YouTube.',
};

export const youTubePlayer: TvPlayerFactory = (host, on) => {
  const mount = document.createElement('div');
  host.append(mount);
  let yt: YTPlayer | null = null;
  let ready = false;
  /** O que pediram antes do player ficar pronto. */
  let pending: { videoId: string; at: number; playing: boolean } | null = null;
  let current = '';
  let wantPlaying = false;
  let volume = 100;
  let blockTimer = 0;

  const apply = (videoId: string, at: number, playing: boolean) => {
    if (!yt) return;
    current = videoId;
    wantPlaying = playing;
    if (playing) yt.loadVideoById({ videoId, startSeconds: at });
    else yt.cueVideoById({ videoId, startSeconds: at });
    watchAutoplay();
  };

  /** Pediu para tocar e não começou em 2,5 s: o navegador bloqueou o som automático. */
  const watchAutoplay = () => {
    clearTimeout(blockTimer);
    if (!wantPlaying) return on.blocked(false);
    blockTimer = window.setTimeout(() => {
      const st = yt?.getPlayerState();
      if (wantPlaying && st !== PLAYING && st !== BUFFERING) on.blocked(true);
    }, 2500);
  };

  void loadYouTubeApi()
    .then((YT) => {
      yt = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: { ...PLAYER_VARS, origin: location.origin },
        events: {
          onReady: () => {
            ready = true;
            yt!.setVolume(volume);
            if (pending) apply(pending.videoId, pending.at, pending.playing);
            pending = null;
          },
          onStateChange: (e) => {
            if (e.data === PLAYING) on.blocked(false);
            if (e.data === ENDED) on.ended();
          },
          onError: (e) =>
            on.error(YT_ERRORS[e.data] ?? 'O YouTube não conseguiu tocar esse vídeo.'),
        },
      });
    })
    .catch((err: Error) => on.error(err.message));

  return {
    load(videoId, at, playing) {
      if (!ready) pending = { videoId, at, playing };
      else apply(videoId, at, playing);
    },
    play() {
      wantPlaying = true;
      yt?.playVideo();
      watchAutoplay();
    },
    pause() {
      wantPlaying = false;
      yt?.pauseVideo();
      on.blocked(false);
    },
    seek(s) {
      yt?.seekTo(s, true);
    },
    time: () => (ready && current ? (yt?.getCurrentTime() ?? 0) : 0),
    duration: () => {
      const d = ready && current ? (yt?.getDuration() ?? 0) : 0;
      return d > 0 ? d : null;
    },
    isPlaying: () => {
      const st = ready ? yt?.getPlayerState() : undefined;
      return st === PLAYING || st === BUFFERING;
    },
    setVolume(v) {
      volume = v;
      if (ready) yt?.setVolume(v);
    },
    destroy() {
      clearTimeout(blockTimer);
      yt?.destroy();
      mount.remove();
    },
  };
};

/**
 * Ids dos vídeos de uma playlist (até `TV_PLAYLIST_MAX`), começando pelo `fromVideo` se ele
 * estiver nela. Usa um player escondido: sem chave de API, é o jeito de ler a lista.
 */
export async function youTubePlaylist(
  listId: string,
  fromVideo?: string | null,
): Promise<string[]> {
  const YT = await loadYouTubeApi();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:120px';
  document.body.append(host);
  const mount = document.createElement('div');
  host.append(mount);
  return new Promise<string[]>((resolve) => {
    let done = false;
    let player: YTPlayer | null = null;
    const finish = (ids: string[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      player?.destroy();
      host.remove();
      const start = fromVideo ? Math.max(0, ids.indexOf(fromVideo)) : 0;
      resolve(ids.slice(start, start + TV_PLAYLIST_MAX));
    };
    const timer = window.setTimeout(() => finish(player?.getPlaylist() ?? []), 8000);
    player = new YT.Player(mount, {
      host: 'https://www.youtube-nocookie.com',
      playerVars: { ...PLAYER_VARS, listType: 'playlist', list: listId },
      events: {
        onStateChange: (e) => {
          const ids = player?.getPlaylist();
          if (ids?.length && (e.data === CUED || e.data === PAUSED || e.data === -1)) finish(ids);
        },
        onReady: () => {
          const ids = player?.getPlaylist();
          if (ids?.length) finish(ids);
        },
        onError: () => finish([]),
      },
    });
  });
}

// ---------- Player de mentira (testes) ----------

/** Duração dos vídeos de mentira (s). */
export const FAKE_DURATION_S = 120;

/** Conta o tempo como um vídeo de verdade; mostra o id na tela. */
export const fakePlayer: TvPlayerFactory = (host, on) => {
  const screen = document.createElement('div');
  screen.className = 'tv-fake-screen';
  host.append(screen);
  let video = '';
  let base = 0;
  let since: number | null = null;
  let endTimer = 0;
  const now = () => performance.now() / 1000;
  const time = () => Math.min(FAKE_DURATION_S, base + (since === null ? 0 : now() - since));
  const schedule = () => {
    clearTimeout(endTimer);
    if (since === null) return;
    endTimer = window.setTimeout(
      () => {
        base = FAKE_DURATION_S;
        since = null;
        on.ended();
      },
      (FAKE_DURATION_S - time()) * 1000,
    );
  };
  const render = () => {
    screen.textContent = video ? `▶ ${video}` : '';
    screen.dataset.video = video;
    screen.dataset.playing = String(since !== null);
  };
  return {
    load(videoId, at, playing) {
      video = videoId;
      base = at;
      since = playing ? now() : null;
      schedule();
      render();
    },
    play() {
      if (since === null) since = now();
      schedule();
      render();
    },
    pause() {
      base = time();
      since = null;
      schedule();
      render();
    },
    seek(s) {
      base = s;
      if (since !== null) since = now();
      schedule();
    },
    time,
    duration: () => (video ? FAKE_DURATION_S : null),
    isPlaying: () => since !== null,
    setVolume: () => undefined,
    destroy() {
      clearTimeout(endTimer);
      screen.remove();
    },
  };
};
