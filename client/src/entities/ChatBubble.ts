import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';

/** Quanto tempo o balão fica na tela e quanto dura o fade final (ms). */
export const BUBBLE_LIFETIME_MS = 7000;
const FADE_MS = 600;
const MAX_WIDTH = 220;
const PAD_X = 7;
const PAD_Y = 4;
const TAIL = 5;
/** Velocidade com que o balão sobe até a nova posição quando outro aparece (px/ms). */
const RISE_SPEED = 0.25;

const base: TextStyleOptions = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 11,
  fill: 0x1b1d24,
  lineHeight: 14,
};

/**
 * Balão de fala no estilo Habbo: "Nome: mensagem" num retângulo claro com rabicho.
 * Fica parado no x onde a pessoa falou e é empurrado para cima quando chegam outros.
 * O texto é desenhado pelo Pixi (`Text`), então HTML nunca é interpretado.
 */
export class ChatBubble extends Container {
  /** y para onde o balão está subindo (a base do balão, onde fica o rabicho). */
  targetY: number;
  private age = 0;

  constructor(name: string, message: string, isLocal: boolean) {
    super();
    const nameText = new Text({
      text: `${name}:`,
      resolution: 2,
      style: { ...base, fontWeight: '700', fill: isLocal ? 0x1d4ed8 : 0x1b1d24 },
    });
    const single = new Text({ text: message, resolution: 2, style: base });
    const inline = nameText.width + 4 + single.width <= MAX_WIDTH;

    let msgText: Text;
    if (inline) {
      msgText = single;
      msgText.position.set(PAD_X + nameText.width + 4, PAD_Y);
    } else {
      single.destroy();
      msgText = new Text({
        text: message,
        resolution: 2,
        style: { ...base, wordWrap: true, wordWrapWidth: MAX_WIDTH, breakWords: true },
      });
      msgText.position.set(PAD_X, PAD_Y + nameText.height);
    }
    nameText.position.set(PAD_X, PAD_Y);

    const contentW = inline
      ? nameText.width + 4 + msgText.width
      : Math.max(nameText.width, msgText.width);
    const contentH = inline
      ? Math.max(nameText.height, msgText.height)
      : nameText.height + msgText.height;
    const w = Math.ceil(contentW + PAD_X * 2);
    const h = Math.ceil(contentH + PAD_Y * 2);

    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 5).fill(0xfdfdf7).stroke({ width: 1, color: 0x2a2d36 });
    bg.poly([w / 2 - TAIL, h - 0.5, w / 2 + TAIL, h - 0.5, w / 2, h + TAIL]).fill(0xfdfdf7);
    bg.moveTo(w / 2 - TAIL, h)
      .lineTo(w / 2, h + TAIL)
      .lineTo(w / 2 + TAIL, h)
      .stroke({ width: 1, color: 0x2a2d36 });

    this.addChild(bg, nameText, msgText);
    // Origem no ponto do rabicho: posicionar = apontar para a cabeça de quem falou.
    this.pivot.set(Math.round(w / 2), h + TAIL);
    this.targetY = 0;
  }

  /** Altura total, incluindo o rabicho (usada para empilhar). */
  get stackHeight(): number {
    return this.pivot.y;
  }

  get expired(): boolean {
    return this.age >= BUBBLE_LIFETIME_MS;
  }

  update(dtMs: number): void {
    this.age += dtMs;
    if (this.y > this.targetY) this.y = Math.max(this.targetY, this.y - RISE_SPEED * dtMs);
    const left = BUBBLE_LIFETIME_MS - this.age;
    this.alpha = left < FADE_MS ? Math.max(0, left / FADE_MS) : 1;
  }
}
