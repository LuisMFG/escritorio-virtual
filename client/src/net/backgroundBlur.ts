import type { ImageSegmenter } from '@mediapipe/tasks-vision';

/** Onde o servidor serve o modelo de recorte e o WebAssembly (baixados só na primeira vez). */
const BASE = '/mediapipe';
/** Quadros por segundo do vídeo desfocado (a câmera manda até 24). */
const FPS = 24;
/** Quanto o fundo fica borrado (px, no tamanho do vídeo). */
const BLUR_PX = 14;

let segmenter: Promise<ImageSegmenter | null> | null = null;

/** O recorte de pessoa, carregado uma vez (GPU se der, senão CPU). `null` se não der. */
function loadSegmenter(): Promise<ImageSegmenter | null> {
  segmenter ??= (async () => {
    try {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const make = (delegate: 'GPU' | 'CPU') =>
        ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${BASE}/selfie_segmenter.tflite`, delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      return await make('GPU').catch(() => make('CPU'));
    } catch (err) {
      console.warn('[chamada] desfoque indisponível', err);
      segmenter = null;
      return null;
    }
  })();
  return segmenter;
}

/**
 * Desfoque de fundo (modo retrato): recebe a trilha da câmera e devolve outra, de um canvas,
 * com a pessoa nítida e o fundo borrado. A trilha original continua aberta (é a fonte) e é
 * parada junto com `stop()`.
 */
export class BackgroundBlur {
  private readonly video = document.createElement('video');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  /** A pessoa (alfa = confiança do recorte), no tamanho da máscara. */
  private readonly maskCanvas = document.createElement('canvas');
  private readonly maskCtx: CanvasRenderingContext2D;
  private maskData: ImageData | null = null;
  private timer = 0;
  private lastTs = 0;
  readonly track: MediaStreamTrack;

  private constructor(
    private readonly source: MediaStreamTrack,
    private readonly seg: ImageSegmenter,
  ) {
    this.ctx = this.canvas.getContext('2d')!;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })!;
    const { width = 640, height = 360 } = source.getSettings();
    this.canvas.width = width;
    this.canvas.height = height;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([source]);
    void this.video.play().catch(() => undefined);
    this.track = this.canvas.captureStream(FPS).getVideoTracks()[0]!;
    // Um temporizador, não requestAnimationFrame: segue mandando vídeo com a aba em segundo
    // plano (a chamada continua enquanto a pessoa usa outra janela).
    this.timer = window.setInterval(() => this.draw(), 1000 / FPS);
    // A câmera caiu (desconectada): o vídeo desfocado acaba junto.
    source.addEventListener('ended', () => this.stop());
  }

  /** Começa o desfoque sobre a câmera; `null` se o navegador não conseguir rodar o recorte. */
  static async start(source: MediaStreamTrack): Promise<BackgroundBlur | null> {
    const seg = await loadSegmenter();
    if (!seg || source.readyState !== 'live') return null;
    return new BackgroundBlur(source, seg);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.track.stop();
    this.source.stop();
    this.video.srcObject = null;
  }

  private draw(): void {
    const v = this.video;
    if (!this.timer || v.readyState < 2 || !v.videoWidth) return;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    // O relógio do recorte precisa sempre andar para a frente.
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    try {
      this.seg.segmentForVideo(v, ts, (result) => {
        const masks = result.confidenceMasks;
        // Modelo de selfie: uma máscara (pessoa) ou duas (fundo, pessoa): a pessoa é a última.
        const mask = masks?.[masks.length - 1];
        if (!mask) return;
        this.paintMask(mask.getAsFloat32Array(), mask.width, mask.height);
      });
    } catch {
      return; // um quadro ruim não derruba o vídeo
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    // A pessoa nítida: o quadro, recortado pela máscara…
    ctx.drawImage(this.maskCanvas, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(v, 0, 0, w, h);
    // …e o fundo borrado por trás.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.filter = `blur(${BLUR_PX}px)`;
    ctx.drawImage(v, 0, 0, w, h);
    ctx.restore();
  }

  /** Confiança (0–1) vira o alfa da máscara. */
  private paintMask(conf: Float32Array, w: number, h: number): void {
    if (this.maskCanvas.width !== w || this.maskCanvas.height !== h || !this.maskData) {
      this.maskCanvas.width = w;
      this.maskCanvas.height = h;
      this.maskData = this.maskCtx.createImageData(w, h);
    }
    const px = this.maskData.data;
    for (let i = 0; i < conf.length; i++) {
      const o = i * 4;
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      px[o + 3] = Math.round(Math.min(1, Math.max(0, conf[i]!)) * 255);
    }
    this.maskCtx.putImageData(this.maskData, 0, 0);
  }
}
