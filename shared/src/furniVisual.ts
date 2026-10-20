/**
 * Móveis desenhados por camadas, como o cliente do Habbo (Fase 37): o servidor converte o SWF do
 * móvel numa folha de sprites + estes dados (camadas, deslocamentos por direção, animações por
 * estado e cores), e o navegador monta o desenho a cada quadro. É o que faz o ventilador girar, a
 * lareira crepitar e a luz da luminária somar brilho (ink ADD) em vez de virar um disco escuro.
 */

/** Uma camada do móvel (as letras `a`, `b`, `c`… dos nomes dos assets). */
export interface FurniVisualLayer {
  /** 33 = soma (ADD), como nos efeitos; 0 = normal. */
  ink?: number;
  /** Transparência de 0 a 255. */
  alpha?: number;
  /** Não pega clique (brilhos, sombras de luz). */
  ignoreMouse?: 1;
  /** Ordem de desenho dentro do móvel (maior = mais na frente). */
  z?: number;
  /** Etiqueta do Habbo (pets: `body`, `head`, `tail`, `emoticon`). */
  tag?: string;
}

/** Quadro de uma camada animada. */
export interface FurniVisualFrame {
  id: number;
  x?: number;
  y?: number;
  /** Deslocamento por direção (pets: a cabeça anda junto com o corpo). */
  off?: Record<string, [number, number]>;
}

export interface FurniVisualAnimLayer {
  frames: FurniVisualFrame[];
  /** Quantos tiques cada quadro fica (padrão 1). */
  frameRepeat?: number;
  /** Quantas voltas antes de parar no último quadro (0/ausente = para sempre). */
  loopCount?: number;
  /** Quadros sorteados em vez de em ordem. */
  random?: 1;
}

/** Posição de um asset na folha (`frames`) e o deslocamento do Habbo (`assets`). */
export interface FurniVisualAsset {
  /** Deslocamento do Habbo: o pixel da imagem que fica sobre a origem do móvel. */
  x: number;
  y: number;
  /** Apelido: usa a imagem de outro asset (espelhada, se `flip`). */
  source?: string;
  flip?: 1;
  /** Pinta com a paleta (pets): a cor vem da paleta escolhida. */
  palette?: 1;
}

export interface FurniVisual {
  /** Classname do SWF (sem a cor). */
  classname: string;
  layerCount: number;
  layers: Record<string, FurniVisualLayer>;
  /** Ajustes por direção e camada. */
  directions: Record<string, Record<string, { x?: number; y?: number; z?: number }>>;
  /** Animação por estado (chave = id da animação, que no Habbo é o estado). */
  animations: Record<string, Record<string, FurniVisualAnimLayer>>;
  /** Cores das variações (`classname*N`): camada → RGB. */
  colors: Record<string, Record<string, number>>;
  assets: Record<string, FurniVisualAsset>;
  /** Retângulo de cada imagem na folha PNG. */
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Pets: postura (`std`, `sit`, `lay`, `mv`…) → animação. */
  postures?: Record<string, number>;
  /** Pets: gesto (`sml`, `joy`, `sad`…) → animação (vale para a cabeça). */
  gestures?: Record<string, number>;
}

/** Um sprite a desenhar, já resolvido. */
export interface FurniSprite {
  /** Imagem na folha. */
  image: string;
  /** Canto superior esquerdo, relativo à origem do Habbo (vértice de cima do tile do móvel). */
  x: number;
  y: number;
  flip: boolean;
  ink: number;
  alpha: number;
  tint: number | null;
  ignoreMouse: boolean;
  /** Camada (-1 = sombra), para ordenar. */
  layer: number;
  /** Usa a paleta (pets): recebe a cor do pet. */
  palette: boolean;
  /**
   * Profundidade extra da camada (`z` da visualização; 1000 = um tile para a frente). As
   * positivas ficam na frente de quem senta no móvel (encosto de costas, braços do sofá).
   */
  z: number;
}

/** Tiques de animação por segundo (o Habbo anima os móveis a 24 quadros por segundo). */
export const FURNI_FPS = 24;

/** Letra da camada nos nomes dos assets: 0 → `a`, 1 → `b`… */
export function layerLetter(i: number): string {
  return String.fromCharCode(97 + i);
}

/** Quadro de uma camada animada no tique `tick`. */
export function animFrame(layer: FurniVisualAnimLayer, tick: number): FurniVisualFrame {
  const n = layer.frames.length;
  if (!n) return { id: 0 };
  const step = Math.floor(tick / Math.max(1, layer.frameRepeat ?? 1));
  if (layer.random) {
    // Sorteio estável por passo (todos os navegadores veem a mesma sequência).
    const h = Math.imul(step + 1, 2654435761) >>> 0;
    return layer.frames[h % n]!;
  }
  if (layer.loopCount && step >= n * layer.loopCount) return layer.frames[n - 1]!;
  return layer.frames[step % n]!;
}

/** A animação tem mais de um quadro em alguma camada (precisa redesenhar com o tempo)? */
export function isAnimated(v: FurniVisual, anim: number): boolean {
  const layers = v.animations[String(anim)];
  return Boolean(layers && Object.values(layers).some((l) => l.frames.length > 1));
}

/** Animação usada para um estado: a do próprio estado ou, sem ela, a 0. */
export function animationFor(v: FurniVisual, state: number): number {
  return v.animations[String(state)] ? state : 0;
}

/**
 * Sprites do móvel numa direção, animação e tique, de trás para frente. `color` é o número da
 * variação (`classname*N`), que pinta as camadas listadas em `colors`.
 */
export function furniSprites(
  v: FurniVisual,
  dir: number,
  anim: number,
  tick: number,
  color?: number,
  /** Pets: animação do gesto, que substitui a das camadas da cabeça. */
  gesture?: number,
): FurniSprite[] {
  const out: FurniSprite[] = [];
  const base = `${v.classname}_64`;
  const tints = color !== undefined ? v.colors[String(color)] : undefined;
  const push = (name: string, layer: number, dx: number, dy: number, z: number) => {
    const a = v.assets[name];
    if (!a) return false;
    const image = a.source ?? name;
    const f = v.frames[image];
    if (!f) return false;
    const props = layer >= 0 ? (v.layers[String(layer)] ?? {}) : {};
    const flip = Boolean(a.flip);
    out.push({
      image,
      // Espelhado, a imagem gira em volta da origem: o deslocamento conta do outro lado.
      x: (flip ? a.x - f.w : -a.x) + dx,
      y: -a.y + dy,
      flip,
      ink: props.ink ?? 0,
      alpha: props.alpha ?? 255,
      tint: layer >= 0 ? (tints?.[String(layer)] ?? null) : null,
      ignoreMouse: layer < 0 || Boolean(props.ignoreMouse),
      layer,
      palette: Boolean(a.palette),
      z,
    });
    return true;
  };
  push(`${base}_sd_${dir}_0`, -1, 0, 0, -Infinity);
  const anims = v.animations[String(anim)] ?? {};
  const gestureAnims = gesture !== undefined ? v.animations[String(gesture)] : undefined;
  for (let i = 0; i < v.layerCount; i++) {
    const tag = v.layers[String(i)]?.tag;
    const fromGesture =
      (tag === 'head' || tag === 'emoticon') && gestureAnims?.[String(i)]
        ? gestureAnims[String(i)]
        : undefined;
    const al = fromGesture ?? anims[String(i)];
    const frame = al ? animFrame(al, tick) : { id: 0 };
    const d = v.directions[String(dir)]?.[String(i)] ?? {};
    const z = (v.layers[String(i)]?.z ?? 0) + (d.z ?? 0);
    const off = frame.off?.[String(dir)];
    const dx = (d.x ?? 0) + (frame.x ?? 0) + (off?.[0] ?? 0);
    const dy = (d.y ?? 0) + (frame.y ?? 0) + (off?.[1] ?? 0);
    const letter = layerLetter(i);
    if (!push(`${base}_${letter}_${dir}_${frame.id}`, i, dx, dy, z) && frame.id !== 0) {
      push(`${base}_${letter}_${dir}_0`, i, dx, dy, z);
    }
  }
  return out.sort((a, b) => a.z - b.z || a.layer - b.layer);
}

/** Um teleporte colocado (para escolher o outro lado no Decorar). */
export interface TeleportInfo {
  id: string;
  roomId: string;
  roomName: string;
  name: string;
  x: number;
  y: number;
  /** Teleporte ligado a este (`null` = solto). */
  linkedTo: string | null;
}
