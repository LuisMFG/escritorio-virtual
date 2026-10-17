import { WB_HEIGHT, WB_PAPER, WB_WIDTH, type WbStrokeInput } from '@office/shared';

/** Traço em desenho (meu, ainda sem id, ou rascunho de outra pessoa). */
export interface WbLive {
  tool: 'pen' | 'eraser';
  color: string;
  width: number;
  points: number[];
}

/** Desenha traços num canvas 2D cujo tamanho é `scale` × o espaço do quadro. */
export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly (WbStrokeInput | WbLive)[],
  scale: number,
): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (s.tool === 'text') {
      ctx.fillStyle = s.color;
      ctx.font = `600 ${s.width}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(s.text, s.x, s.y);
      continue;
    }
    const p = s.points;
    ctx.strokeStyle = s.tool === 'eraser' ? WB_PAPER : s.color;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(p[0]!, p[1]!);
    if (p.length === 2) ctx.lineTo(p[0]! + 0.1, p[1]!); // um clique vira um ponto
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
    ctx.stroke();
  }
  ctx.restore();
}

/** Limpa o canvas com a cor do papel. */
export function paper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = WB_PAPER;
  ctx.fillRect(0, 0, w, h);
}

/** Miniatura do quadro (para o móvel na sala). */
export function renderThumbnail(strokes: readonly WbStrokeInput[], canvas?: HTMLCanvasElement) {
  const c = canvas ?? document.createElement('canvas');
  c.width = 240;
  c.height = 180;
  const ctx = c.getContext('2d')!;
  paper(ctx, c.width, c.height);
  drawStrokes(ctx, strokes, c.width / WB_WIDTH);
  return c;
}

export { WB_HEIGHT, WB_WIDTH };
