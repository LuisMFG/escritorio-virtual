import type { FigurePose } from './figureRender.js';
import { STEP_MS } from './constants.js';
import type { EmoteId } from './social.js';

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

/** Parte da pose que um emote define (gesto, expressão, fala), `elapsed` ms depois de começar. */
export function emotePose(id: EmoteId, elapsedMs: number): Partial<FigurePose> {
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
    case 'dance':
      // A dança gira o corpo e "anda" no lugar (a cena cuida da direção).
      return { posture: 'wlk', frame: Math.floor(elapsedMs / 150) % 4, expression: 'sml' };
  }
}
