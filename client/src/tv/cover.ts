/** Tamanho da capa desenhada na tela da TV (16:9; o móvel encolhe). */
const W = 192;
const H = 108;

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** Capa do vídeo pela própria origem (o servidor busca no YouTube e guarda). */
function loadThumb(videoId: string): Promise<HTMLImageElement | null> {
  let hit = images.get(videoId);
  if (!hit) {
    hit = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `/api/tv/thumb/${videoId}.jpg`;
    });
    images.set(videoId, hit);
  }
  return hit;
}

/** Botão vermelho de "play", no meio ou no canto. */
function playBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number): void {
  const h = w * 0.7;
  ctx.fillStyle = '#ff0033';
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h * 0.28);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.14, cy - h * 0.26);
  ctx.lineTo(cx + w * 0.2, cy);
  ctx.lineTo(cx - w * 0.14, cy + h * 0.26);
  ctx.closePath();
  ctx.fill();
}

/**
 * Desenha a capa do vídeo que está passando (Fase 51) para a tela da TV na sala. Sem a capa
 * (sem internet), uma tela escura com o "play" do YouTube.
 */
export async function drawTvCover(canvas: HTMLCanvasElement, videoId: string): Promise<void> {
  const img = await loadThumb(videoId);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (img) {
    // Preenche a tela cortando as bordas (as capas do YouTube são 16:9, às vezes com tarja).
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    playBadge(ctx, W - 22, H - 16, 26);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1f2937');
    g.addColorStop(1, '#0b0f17');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    playBadge(ctx, W / 2, H / 2, 56);
  }
}
