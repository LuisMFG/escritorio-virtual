import type { BodyGroup, FigureExpression, FigurePose, PartPose } from './figureRender.js';
import { STEP_MS } from './constants.js';
import type { EmoteId, EmotePosture } from './social.js';

/**
 * Animações do avatar montado (Fase 32): que pose cada coisa produz ao longo do tempo.
 * Puro, para a cena só perguntar "como está agora?" a cada quadro.
 */

/** Troca de quadro da boca enquanto fala. */
export const TALK_FRAME_MS = 140;
/** Quanto tempo a boca mexe por mensagem: proporcional ao texto, entre 0,8 s e 4 s. */
export function talkDurationMs(text: string): number {
  return Math.min(4000, Math.max(800, text.length * 70));
}
/** Piscar: olhos fechados por este tempo, a cada 2,5–6 s. */
export const BLINK_MS = 140;
export function nextBlinkDelay(random: () => number = Math.random): number {
  return 2500 + random() * 3500;
}

/** Quadro do andar (4 por passo, como no Habbo). */
export function walkFrame(walkTimeMs: number): number {
  return Math.floor((walkTimeMs / STEP_MS) * 4) % 4;
}

/** Um quadro de animação: pose de cada grupo do corpo, rosto e o corpo inteiro subindo. */
export interface AnimFrame {
  /** Quanto tempo o quadro fica (ms). */
  ms: number;
  parts?: Partial<Record<BodyGroup, PartPose>>;
  expression?: FigureExpression;
  /** Boca mexendo (rir, soluçar). */
  talk?: boolean;
  /** Corpo inteiro para cima (negativo) ou para baixo, em px: pulos. */
  bodyDy?: number;
  /** Corpo inteiro para os lados, em px, no desenho virado para a direita (o espelho inverte). */
  bodyDx?: number;
  /** Corpo inteiro girado, em direções (a virada da Macarena, o giro do moonwalk). */
  bodyDd?: number;
}

/** Animação descrita como dados (Fase 54): os quadros e o tempo de cada um. */
export interface Animation {
  frames: readonly AnimFrame[];
  /** Repete até o emote acabar; sem `loop`, fica no último quadro. */
  loop?: boolean;
}

/** Quadro da animação `elapsed` ms depois de começar. */
export function frameAt(anim: Animation, elapsedMs: number): AnimFrame {
  const total = anim.frames.reduce((n, f) => n + f.ms, 0);
  let t = anim.loop ? elapsedMs % total : Math.min(elapsedMs, total - 1);
  for (const f of anim.frames) {
    if (t < f.ms) return f;
    t -= f.ms;
  }
  return anim.frames.at(-1)!;
}

const both = (pose: PartPose): Partial<Record<BodyGroup, PartPose>> => ({
  leftArm: pose,
  rightArm: pose,
});

/**
 * Emotes da Fase 54, montados com os desenhos que existem (conferidos numa grade de poses nas 8
 * direções). O Habbo não desenha palmas, pulo nem reverência: cada um combina ação, quadro e
 * deslocamento por grupo do corpo, como as danças do próprio Habbo.
 */
export const EMOTE_ANIMS: Partial<Record<EmoteId, Animation>> = {
  // Antebraços para a frente (carregar), as mãos se juntando e se afastando.
  clap: {
    loop: true,
    frames: [
      {
        ms: 150,
        expression: 'sml',
        parts: { leftArm: { action: 'crr', dx: 2 }, rightArm: { action: 'crr', dx: -2 } },
      },
      {
        ms: 150,
        expression: 'sml',
        parts: {
          leftArm: { action: 'crr', dx: -2, dy: 1 },
          rightArm: { action: 'crr', dx: 2, dy: 1 },
        },
      },
    ],
  },
  // A mão no rosto (beber, sem o copo), cabeça baixa e olhos fechados.
  facepalm: {
    frames: [
      { ms: 220, parts: { rightArm: { action: 'drk', dy: 1 } } },
      {
        ms: 2000,
        expression: 'eyb',
        parts: { rightArm: { action: 'drk', dy: -1 }, head: { dy: 2 } },
      },
      { ms: 380 },
    ],
  },
  // Antebraço erguido para a frente, cutucando o ar.
  point: {
    loop: true,
    frames: [
      { ms: 420, parts: { leftArm: { action: 'crr', dy: -4 } } },
      { ms: 180, parts: { leftArm: { action: 'crr', dy: -4, dx: 1 } } },
    ],
  },
  // Cabeça e tronco descem e vão para a frente (o espelho acerta o lado), e voltam.
  bow: {
    frames: [
      { ms: 160, parts: { head: { dy: 2, dx: 1 }, torso: { dy: 1 }, ...both({ dy: 1 }) } },
      {
        ms: 1000,
        expression: 'eyb',
        parts: { head: { dy: 6, dx: 3 }, torso: { dy: 3, dx: 1 }, ...both({ dy: 3, dx: 1 }) },
      },
      { ms: 160, parts: { head: { dy: 2, dx: 1 }, torso: { dy: 1 }, ...both({ dy: 1 }) } },
      { ms: 880 },
    ],
  },
  // Agacha, sobe com um braço para cima e cai.
  jump: {
    loop: true,
    frames: [
      { ms: 110, bodyDy: 2 },
      { ms: 140, bodyDy: -7, parts: { leftArm: { action: 'wav', frame: 0 } } },
      { ms: 130, bodyDy: -12, parts: { leftArm: { action: 'wav', frame: 0 } }, expression: 'sml' },
      { ms: 140, bodyDy: -6 },
      { ms: 180, bodyDy: 1 },
    ],
  },
  // Rosto triste, soluçando, a mão secando os olhos e a cabeça balançando.
  cry: {
    loop: true,
    frames: [
      {
        ms: 320,
        expression: 'sad',
        talk: true,
        parts: { head: { dy: 1 }, rightArm: { action: 'drk', dy: -1 } },
      },
      { ms: 320, expression: 'sad', parts: { rightArm: { action: 'drk', dy: -1 } } },
    ],
  },
  // Olhos fechados e a cabeça caindo devagar.
  sleep: {
    loop: true,
    frames: [
      { ms: 1200, expression: 'eyb', parts: { head: { dy: 1 } } },
      { ms: 1200, expression: 'eyb', parts: { head: { dy: 2 } } },
    ],
  },
  // A mão no queixo e a cabeça virada para o lado.
  think: {
    frames: [
      { ms: 250, parts: { rightArm: { action: 'drk', dy: 2 } } },
      { ms: 2750, parts: { rightArm: { action: 'drk', dy: 1 }, head: { dd: -1 } } },
    ],
  },
  // Soco no ar (a "placa" sem a placa), pulinhos e sorriso.
  celebrate: {
    loop: true,
    frames: [
      {
        ms: 200,
        expression: 'sml',
        parts: { leftArm: { action: 'sig' }, rightArm: { action: 'blw', frame: 1 } },
      },
      {
        ms: 200,
        expression: 'sml',
        talk: true,
        bodyDy: -6,
        parts: { leftArm: { action: 'sig', dy: -2 }, rightArm: { action: 'blw', frame: 1 } },
      },
    ],
  },
  // Mão espalmada para cima, a batida (para a frente) e de volta.
  highfive: {
    frames: [
      { ms: 260, expression: 'sml', parts: { leftArm: { action: 'wav', frame: 0 } } },
      {
        ms: 160,
        expression: 'sml',
        parts: { leftArm: { action: 'wav', frame: 1, dx: 2, dy: 1 } },
      },
      { ms: 700, expression: 'sml', parts: { leftArm: { action: 'wav', frame: 0 } } },
      { ms: 480, expression: 'sml' },
    ],
  },
};

/** O que vale de cada grupo por postura: sentado, só braços e cabeça; deitado, só o rosto. */
function partsFor(
  parts: AnimFrame['parts'],
  posture: EmotePosture,
): Partial<Record<BodyGroup, PartPose>> | undefined {
  if (!parts || posture === 'lay') return undefined;
  if (posture === 'stand') return parts;
  const upper: Partial<Record<BodyGroup, PartPose>> = {};
  for (const g of ['head', 'leftArm', 'rightArm'] as const) if (parts[g]) upper[g] = parts[g];
  return Object.keys(upper).length ? upper : undefined;
}

/**
 * Parte da pose que um emote define (gesto, expressão, fala, pose por grupo), `elapsed` ms depois
 * de começar. `posture` tira o que não cabe: sentado não mexe tronco e pernas; deitado, só o rosto.
 */
export function emotePose(
  id: EmoteId,
  elapsedMs: number,
  posture: EmotePosture = 'stand',
): Partial<FigurePose> {
  const anim = EMOTE_ANIMS[id];
  if (anim) {
    const f = frameAt(anim, elapsedMs);
    const out: Partial<FigurePose> = {};
    const parts = partsFor(f.parts, posture);
    if (parts) out.parts = parts;
    if (f.expression) out.expression = f.expression;
    if (f.talk) Object.assign(out, { talk: true, talkFrame: Math.floor(elapsedMs / 120) % 2 });
    return out;
  }
  switch (id) {
    case 'wave':
      return { gesture: 'wav', gestureFrame: Math.floor(elapsedMs / 250) % 2 };
    case 'hand':
      return { gesture: 'wav', gestureFrame: 0 };
    case 'thumbs':
      return { gesture: 'respect', gestureFrame: elapsedMs < 400 ? 0 : 1 };
    case 'heart':
      return { gesture: 'blw', gestureFrame: elapsedMs < 700 ? 0 : 1, expression: 'sml' };
    case 'coffee':
      return { gesture: 'drk' };
    case 'laugh':
      return { expression: 'sml', talk: true, talkFrame: Math.floor(elapsedMs / 120) % 2 };
    case 'smile':
      return { expression: 'sml' };
    case 'sad':
      return { expression: 'sad' };
    case 'angry':
      return { expression: 'agr' };
    case 'surprised':
      return { expression: 'srp' };
    default:
      return {};
  }
}

/** Corpo inteiro subindo nos emotes animados (pulo, comemorar); `null` = o emote não define. */
export function emoteBodyDy(id: EmoteId, elapsedMs: number): number | null {
  const anim = EMOTE_ANIMS[id];
  return anim ? (frameAt(anim, elapsedMs).bodyDy ?? 0) : null;
}

/** Olhar para quem fala: quem está até esta distância (tiles) vira a cabeça. */
export const LOOK_RADIUS = 4;
/** Por quanto tempo a cabeça fica virada (ms). */
export const LOOK_MS = 3000;
/** A cabeça gira no máximo isto (direções) para cada lado; mais que isso seria olhar para trás. */
export const LOOK_MAX_TURN = 2;

/** Direção (0–7) de quem está em `from` olhando para `to`, pelo ângulo (não só pelo sinal). */
export function facingToward(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  // 0 é "para cima" (y diminuindo) e as direções seguem no sentido horário, de 45 em 45 graus.
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((Math.round(deg / 45) % 8) + 8) % 8;
}

/**
 * Quanto a cabeça gira (em direções, negativo = anti-horário) para olhar de `bodyDir` para
 * `target`. `null` se não precisa virar ou se a pessoa está de costas para quem fala.
 */
export function headTurn(bodyDir: number, target: number): number | null {
  const delta = ((((target - bodyDir) % 8) + 12) % 8) - 4;
  if (delta === 0 || Math.abs(delta) > LOOK_MAX_TURN) return null;
  return delta;
}
