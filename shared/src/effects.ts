import { z } from 'zod';
import type { AchievementsResponse } from './achievements.js';
import type { FigureSheet } from './figureRender.js';

/**
 * Efeitos e itens na mão (Fase 34). Os efeitos são os do Habbo (bibliotecas de efeito), com a
 * animação descrita no próprio SWF; os itens na mão vêm da biblioteca `hh_human_item`.
 */

// ---------- Efeitos ----------

/** Animação de um efeito: camadas e a sequência de quadros. */
export interface EffectAnimation {
  sprites: {
    id: string;
    /** Prefixo das imagens (`std_fx4_1_1` → `h_std_fx4_1_1_{dir}_{quadro}`). */
    member: string;
    /** 33 = brilho aditivo; o resto, normal. */
    ink: number;
    /** Por direção: na frente do corpo (≥ 0) ou atrás (< 0). */
    dz: Record<string, number>;
  }[];
  frames: { id: string; frame: number; dx: number; dy: number }[][];
}

/** Folha de um efeito (`/hh/effect/{nome}.json`): imagens + animação. */
export interface EffectSheet extends FigureSheet {
  animation: EffectAnimation;
}

/** Quadros por segundo dos efeitos. */
export const EFFECT_FPS = 12;

export type EffectUnlock =
  { kind: 'free' } | { kind: 'achievements'; count: number } | { kind: 'kudos'; count: number };

export interface EffectDef {
  /** Biblioteca de efeito do Habbo. */
  lib: string;
  name: string;
  emoji: string;
  unlock: EffectUnlock;
}

/** Efeitos que dá para usar (escolhidos no Perfil) e os que aparecem em comemorações. */
export const EFFECTS = {
  twinkle: { lib: 'Twinkle', name: 'Brilho', emoji: '✨', unlock: { kind: 'free' } },
  thumbs: {
    lib: 'SpinningThumbsUp',
    name: 'Joinha girando',
    emoji: '👍',
    unlock: { kind: 'kudos', count: 1 },
  },
  bluetwinkle: {
    lib: 'BlueTwinkle',
    name: 'Brilho azul',
    emoji: '💠',
    unlock: { kind: 'achievements', count: 3 },
  },
  love: { lib: 'Love', name: 'Corações', emoji: '💕', unlock: { kind: 'kudos', count: 3 } },
  fireflies: {
    lib: 'Fireflies',
    name: 'Vaga-lumes',
    emoji: '🌟',
    unlock: { kind: 'achievements', count: 5 },
  },
  butterflies: {
    lib: 'Butterflies',
    name: 'Borboletas',
    emoji: '🦋',
    unlock: { kind: 'achievements', count: 8 },
  },
  halo: {
    lib: 'TrippyHalo',
    name: 'Auréola',
    emoji: '😇',
    unlock: { kind: 'achievements', count: 11 },
  },
  spotlight: {
    lib: 'GoldSpotlight',
    name: 'Holofote',
    emoji: '🔦',
    unlock: { kind: 'achievements', count: 14 },
  },
  lightning: {
    lib: 'Lightning',
    name: 'Raio',
    emoji: '⚡',
    unlock: { kind: 'achievements', count: 17 },
  },
  medal: {
    lib: 'Medal1',
    name: 'Medalha',
    emoji: '🏅',
    unlock: { kind: 'achievements', count: 999 },
  },
} as const satisfies Record<string, EffectDef>;

export type EffectId = keyof typeof EFFECTS;
export const EFFECT_IDS = Object.keys(EFFECTS) as EffectId[];
/** Bibliotecas de efeito usadas (o `assets:figure` busca o SWF de cada uma). */
export const EFFECT_LIBRARIES = [...new Set(EFFECT_IDS.map((id) => EFFECTS[id].lib))];

/** Comemorações: efeito por alguns segundos. */
export const CELEBRATIONS = {
  achievement: { effect: 'spotlight', ms: 6000 },
  kudos: { effect: 'thumbs', ms: 5000 },
  focus: { effect: 'medal', ms: 5000 },
  birthday: { effect: 'love', ms: 8000 },
} as const satisfies Record<string, { effect: EffectId; ms: number }>;

/** O efeito está liberado para quem tem estas conquistas e estes elogios recebidos? */
export function effectUnlocked(
  id: EffectId,
  a: Pick<AchievementsResponse, 'unlocked' | 'stats'>,
): boolean {
  const rule: EffectUnlock = EFFECTS[id].unlock;
  if (rule.kind === 'free') return true;
  if (rule.kind === 'kudos') return (a.stats.kudosReceived ?? 0) >= rule.count;
  return a.unlocked.length >= rule.count;
}

/** Como liberar (texto do Perfil). */
export function unlockHint(id: EffectId): string {
  const rule: EffectUnlock = EFFECTS[id].unlock;
  if (rule.kind === 'free') return 'Liberado';
  if (rule.kind === 'kudos')
    return `Receba ${rule.count} ${rule.count === 1 ? 'elogio' : 'elogios'}`;
  if (rule.count > 100) return 'Só nas comemorações';
  return `Desbloqueie ${rule.count} conquistas`;
}

export const effectSchema = z.object({
  effect: z.enum(EFFECT_IDS as [EffectId, ...EffectId[]]).nullable(),
});

/** `GET /api/effects`. */
export interface EffectsResponse {
  current: EffectId | null;
  effects: { id: EffectId; unlocked: boolean }[];
}

/** Sala → todos: efeito por um tempo (comemoração). */
export interface EffectFlash {
  sessionId: string;
  effect: EffectId;
  ms: number;
}

// ---------- Itens na mão ----------

/** Biblioteca do Habbo com os itens na mão. */
export const HAND_ITEM_LIB = 'hh_human_item';
/** Itens que o escritório entrega (id do Habbo → nome). */
export const HAND_ITEMS = {
  6: 'Café',
  1: 'Água com gás',
  43: 'Refrigerante',
  44: 'Limonada',
  48: 'Suco de laranja',
} as const;
export const COFFEE_ITEM = 6;
/** O que sai da geladeira (sorteado). */
export const FRIDGE_ITEMS = [1, 43, 44, 48] as const;
/** Quanto tempo o item fica na mão. */
export const HAND_ITEM_MS = 5 * 60_000;
/** Segurando um copo, dá um gole a cada tanto e o gole dura um pouco. */
export const SIP_EVERY_MS = 12_000;
export const SIP_MS = 1500;

/** `/largar` (sem diferenciar maiúsculas). */
export function isDropCommand(text: string): boolean {
  return /^\s*\/largar\s*$/i.test(text);
}

export function handItemName(id: number): string {
  return (HAND_ITEMS as Record<number, string>)[id] ?? 'Item';
}
