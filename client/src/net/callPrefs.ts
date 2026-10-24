/** Qualidade do vídeo: automática, alta (conexão boa) ou economia (4G, rede fraca). */
export type CallQuality = 'auto' | 'alta' | 'economia';
export const CALL_QUALITIES: readonly CallQuality[] = ['auto', 'alta', 'economia'];
/** Tela compartilhada: nitidez (texto e código) ou fluidez (vídeo, rolagem). */
export type ScreenMode = 'nitidez' | 'fluidez';

/**
 * Escolhas da chamada que valem para as próximas: efeitos (desfoque de fundo e supressão de
 * ruído), qualidade do vídeo, o jeito de compartilhar a tela e os dispositivos (microfone,
 * câmera e saída de áudio). Ficam no navegador.
 */
export interface CallPrefs {
  /** Desfoque de fundo (modo retrato) na câmera. */
  blur: boolean;
  /** Supressão de ruído do navegador no microfone. */
  noise: boolean;
  quality: CallQuality;
  screenMode: ScreenMode;
  mic?: string;
  cam?: string;
  /** Saída de áudio (alto-falante ou fone). */
  speaker?: string;
}

export const CALL_PREFS_KEY = 'ev-call-prefs';
/** Chaves antigas (Fase 50), só com os dispositivos. */
const OLD_MIC_KEY = 'ev-call-mic';
const OLD_CAM_KEY = 'ev-call-cam';

export const DEFAULT_CALL_PREFS: CallPrefs = {
  blur: false,
  noise: true,
  quality: 'auto',
  screenMode: 'nitidez',
};

const id = (v: unknown) =>
  typeof v === 'string' && v.length > 0 && v.length < 300 ? v : undefined;

/** Lê o que ficou salvo; qualquer coisa estranha vira o padrão. */
export function parseCallPrefs(
  raw: string | null,
  old: { mic?: string | null; cam?: string | null } = {},
): CallPrefs {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // salvo corrompido: começa do padrão
  }
  const prefs: CallPrefs = {
    blur: typeof data.blur === 'boolean' ? data.blur : DEFAULT_CALL_PREFS.blur,
    noise: typeof data.noise === 'boolean' ? data.noise : DEFAULT_CALL_PREFS.noise,
    quality: CALL_QUALITIES.includes(data.quality as CallQuality)
      ? (data.quality as CallQuality)
      : DEFAULT_CALL_PREFS.quality,
    screenMode: data.screenMode === 'fluidez' ? 'fluidez' : 'nitidez',
  };
  const mic = id(data.mic) ?? id(old.mic);
  const cam = id(data.cam) ?? id(old.cam);
  const speaker = id(data.speaker);
  if (mic) prefs.mic = mic;
  if (cam) prefs.cam = cam;
  if (speaker) prefs.speaker = speaker;
  return prefs;
}

export function loadCallPrefs(): CallPrefs {
  try {
    return parseCallPrefs(localStorage.getItem(CALL_PREFS_KEY), {
      mic: localStorage.getItem(OLD_MIC_KEY),
      cam: localStorage.getItem(OLD_CAM_KEY),
    });
  } catch {
    return { ...DEFAULT_CALL_PREFS };
  }
}

export function saveCallPrefs(prefs: CallPrefs): void {
  try {
    localStorage.setItem(CALL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // sem armazenamento: vale só para esta visita
  }
}
