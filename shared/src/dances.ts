import { z } from 'zod';
import { frameAt, type AnimFrame, type Animation } from './avatarAnim.js';
import type { BodyGroup, PartPose } from './figureRender.js';
import type { TilePoint } from './iso.js';
import { nameKey } from './protocol.js';

/**
 * Danças sincronizadas (Fase 55): inspiradas nas músicas (sem som) e montadas quadro a quadro com
 * os desenhos do Habbo, como os emotes da Fase 54. A dança é estado no servidor (qual e quando
 * começou); o compasso vem do relógio do servidor, então todo mundo vê o mesmo quadro.
 */

/** Quem começa a mesma dança a até esta distância (tiles) de alguém que já dança entra no tempo dele. */
export const DANCE_NEAR = 5;

type Parts = Partial<Record<BodyGroup, PartPose>>;
/** Um quadro de `beats` batidas no andamento da dança. */
type Step = Omit<AnimFrame, 'ms'> & { beats: number };

function choreo(bpm: number, steps: readonly Step[]): Animation {
  const beat = 60_000 / bpm;
  return {
    loop: true,
    frames: steps.map(({ beats, ...f }) => ({ ...f, ms: Math.round(beats * beat) })),
  };
}

const arms = (left: PartPose, right: PartPose): Parts => ({ leftArm: left, rightArm: right });
const legs = (frame: number): Parts => ({ legs: { action: 'wlk', frame } });

/** Macarena: braço por braço, mãos nos ombros, na cabeça e no quadril, rebolado e pulo com virada. */
function macarena(): Step[] {
  const cycle = (turn: number): Step[] =>
    [
      { beats: 1, parts: arms({}, { action: 'crr' }) },
      { beats: 1, parts: arms({ action: 'crr' }, { action: 'crr' }) },
      { beats: 1, parts: arms({ action: 'crr' }, { action: 'crr', dy: -1 }) },
      { beats: 1, parts: arms({ action: 'crr', dy: -1 }, { action: 'crr', dy: -1 }) },
      { beats: 1, parts: arms({ action: 'crr', dy: -1 }, { action: 'drk', dx: 2 }) },
      { beats: 1, parts: arms({ action: 'respect' }, { action: 'drk', dx: 2 }) },
      { beats: 1, parts: arms({ action: 'respect' }, { action: 'drk', dy: -6 }) },
      { beats: 1, parts: arms({ action: 'wav', dy: 3 }, { action: 'drk', dy: -6 }) },
      { beats: 1, parts: arms({ action: 'wav', dy: 3 }, { dx: 2, dy: -2 }) },
      { beats: 1, parts: arms({ dx: -2, dy: -2 }, { dx: 2, dy: -2 }) },
      { beats: 1, parts: arms({ dx: -2, dy: -2 }, { dx: -1, dy: -1 }) },
      { beats: 1, parts: arms({ dx: 1, dy: -1 }, { dx: -1, dy: -1 }) },
      {
        beats: 1,
        parts: { ...arms({ dx: 1, dy: -1 }, { dx: -1, dy: -1 }), torso: { dx: -1 }, ...legs(1) },
      },
      {
        beats: 1,
        parts: { ...arms({ dx: 1, dy: -1 }, { dx: -1, dy: -1 }), torso: { dx: 1 }, ...legs(3) },
      },
      {
        beats: 1,
        parts: { ...arms({ dx: 1, dy: -1 }, { dx: -1, dy: -1 }), torso: { dx: -1 }, ...legs(1) },
      },
      {
        beats: 1,
        bodyDy: -8,
        expression: 'sml',
        parts: arms({ action: 'sig' }, { action: 'blw', frame: 1 }),
      },
    ].map((s) => ({ ...s, bodyDd: turn }) as Step);
  // Cada volta termina virando um quarto: quatro voltas e está de frente de novo.
  return [0, 2, 4, 6].flatMap(cycle);
}

/** Thriller: braços de zumbi, cabeça tombando, passinhos de lado, garra e ombros. */
function thriller(): Step[] {
  const zombie = (dy = -1): Parts => arms({ action: 'crr', dy }, { action: 'crr', dy });
  return [
    { beats: 1, expression: 'agr', parts: { ...zombie(), head: { dd: -1 }, torso: { dx: -1 } } },
    { beats: 1, expression: 'agr', parts: { ...zombie(), ...legs(1) } },
    { beats: 1, expression: 'agr', parts: { ...zombie(), head: { dd: 1 }, torso: { dx: 1 } } },
    { beats: 1, expression: 'agr', parts: { ...zombie(), ...legs(3) } },
    {
      beats: 1,
      expression: 'agr',
      parts: { ...arms({ action: 'respect' }, { action: 'drk', dy: -3 }), head: { dy: 1 } },
    },
    { beats: 0.5, expression: 'agr', parts: { ...arms({ dy: -2 }, { dy: -2 }), head: { dy: -1 } } },
    { beats: 0.5, expression: 'agr', parts: zombie(0) },
    {
      beats: 1,
      expression: 'agr',
      parts: { ...arms({ action: 'crr', dy: -3 }, { action: 'blw', frame: 1 }), head: { dd: -1 } },
    },
    {
      beats: 1,
      expression: 'agr',
      parts: { ...zombie(), head: { dx: -2, dy: 2 }, torso: { dx: -1 } },
    },
  ];
}

/** Gangnam Style: cavalgando (pulsos cruzados, galope) e o laço girando no alto. */
function gangnam(): Step[] {
  const reins = arms({ action: 'crr', dx: 1, dy: -1 }, { action: 'crr', dx: -1, dy: -1 });
  const gallop = (i: number, top: Parts): Step => ({
    beats: 0.5,
    expression: 'sml',
    bodyDy: i % 2 ? -3 : 0,
    parts: { ...top, ...legs(i % 2 ? 1 : 3) },
  });
  const lasso = (i: number) => arms({ action: 'sig', dx: i % 2 ? 1 : -1 }, { action: 'crr' });
  return [
    ...Array.from({ length: 12 }, (_, i) => gallop(i, reins)),
    ...Array.from({ length: 4 }, (_, i) => gallop(i, lasso(i))),
  ];
}

/** YMCA: as quatro letras com os braços e o balanço entre elas. */
function ymca(): Step[] {
  return [
    {
      beats: 1,
      expression: 'sml',
      bodyDy: -2,
      parts: arms({ action: 'sig', dx: -1 }, { action: 'drk', dy: -7, dx: 1 }),
    },
    {
      beats: 1,
      expression: 'sml',
      parts: arms({ action: 'wav', dy: 4 }, { action: 'drk', dy: -5 }),
    },
    {
      beats: 1,
      expression: 'sml',
      parts: { ...arms({ action: 'sig', dx: -2 }, { action: 'crr', dy: -3 }), torso: { dx: -1 } },
    },
    {
      beats: 1,
      expression: 'sml',
      parts: arms({ action: 'sig', dx: 2 }, { action: 'drk', dy: -8, dx: -2 }),
    },
    { beats: 1, expression: 'sml', parts: { torso: { dx: -1 }, ...legs(1) } },
    { beats: 1, expression: 'sml', bodyDy: -2, parts: { torso: { dx: 1 }, ...legs(3) } },
    { beats: 1, expression: 'sml', parts: { torso: { dx: -1 }, ...legs(1) } },
    { beats: 1, expression: 'sml', bodyDy: -2, parts: { torso: { dx: 1 }, ...legs(3) } },
  ];
}

/** Floss: os braços esticados passando de um lado para o outro, o quadril ao contrário. */
function floss(): Step[] {
  const side = (dx: number, frame: number, hip: number): Step => ({
    beats: 0.5,
    expression: 'sml',
    parts: {
      ...arms({ action: 'wlk', frame, dx }, { action: 'wlk', frame, dx }),
      torso: { dx: hip },
    },
  });
  return [side(3, 1, -1), side(0, 0, 0), side(-3, 3, 1), side(0, 2, 0)];
}

/** Robô: poses duras, sem transição, a cabeça e o corpo virando aos trancos. */
function robot(): Step[] {
  return [
    { beats: 1, parts: arms({ action: 'crr' }, {}) },
    { beats: 1, parts: { ...arms({ action: 'crr' }, { action: 'crr' }), head: { dd: -1 } } },
    { beats: 1, parts: { ...arms({ action: 'respect' }, { action: 'crr' }), head: { dd: -1 } } },
    { beats: 1, bodyDd: 1, parts: arms({ action: 'respect' }, { action: 'drk' }) },
    { beats: 1, bodyDd: 1, parts: arms({ dy: -1 }, { dy: -1 }) },
    {
      beats: 1,
      parts: { ...arms({ action: 'crr', dy: -2 }, { action: 'crr', dy: -2 }), head: { dd: 1 } },
    },
    { beats: 1, bodyDy: -1, parts: { ...arms({}, { action: 'crr' }), head: { dd: 1 } } },
    { beats: 1, parts: arms({ action: 'crr' }, { action: 'crr' }) },
  ];
}

/** Moonwalk: desliza para trás andando para a frente, gira, fica na ponta dos pés e volta. */
function moonwalk(): Step[] {
  const back = Array.from({ length: 8 }, (_, i) => ({
    beats: 0.5,
    bodyDx: -Math.round((i + 1) * 1.5),
    parts: legs(3 - (i % 4)),
  }));
  const spin = [2, 4, 6, 0].map((bodyDd) => ({ beats: 0.25, bodyDx: -12, bodyDd }));
  const toe: Step = {
    beats: 2,
    bodyDx: -12,
    bodyDy: -3,
    expression: 'sml',
    parts: arms({ action: 'crr', dy: -2 }, {}),
  };
  const forward = Array.from({ length: 8 }, (_, i) => ({
    beats: 0.5,
    bodyDx: -12 + Math.round((i + 1) * 1.5),
    parts: legs(i % 4),
  }));
  return [...back, ...spin, toe, ...forward];
}

export interface DanceDef {
  label: string;
  emoji: string;
  /** Comando no chat, sem a barra e sem acento (`/macarena`). */
  command: string;
  anim: Animation;
}

export const DANCES = {
  macarena: { label: 'Macarena', emoji: '💃', command: 'macarena', anim: choreo(103, macarena()) },
  thriller: { label: 'Thriller', emoji: '🧟', command: 'thriller', anim: choreo(118, thriller()) },
  gangnam: {
    label: 'Gangnam Style',
    emoji: '🐎',
    command: 'gangnam',
    anim: choreo(132, gangnam()),
  },
  ymca: { label: 'YMCA', emoji: '🙆', command: 'ymca', anim: choreo(127, ymca()) },
  floss: { label: 'Floss', emoji: '🕺', command: 'floss', anim: choreo(120, floss()) },
  robot: { label: 'Robô', emoji: '🤖', command: 'robo', anim: choreo(100, robot()) },
  moonwalk: { label: 'Moonwalk', emoji: '🌙', command: 'moonwalk', anim: choreo(117, moonwalk()) },
} as const satisfies Record<string, DanceDef>;

export type DanceId = keyof typeof DANCES;
export const DANCE_IDS = Object.keys(DANCES) as DanceId[];

/** `{ dance }`: começa a dança; vazio para (`/parar`). */
export const danceSchema = z.object({
  dance: z.union([z.enum(DANCE_IDS as [DanceId, ...DanceId[]]), z.literal('')]),
});
export type DanceRequest = z.infer<typeof danceSchema>;

/** Quadro da dança `elapsed` ms depois do começo do compasso (repete para sempre). */
export function danceFrame(id: DanceId, elapsedMs: number): AnimFrame {
  return frameAt(DANCES[id].anim, Math.max(0, elapsedMs));
}

/** Número do quadro (para comparar a sincronia entre telas). */
export function danceFrameIndex(id: DanceId, elapsedMs: number): number {
  return DANCES[id].anim.frames.indexOf(danceFrame(id, elapsedMs));
}

/**
 * Começo do compasso de quem começa a dançar `dance` em `at`: o de quem já dança a mesma dança
 * mais perto (até `DANCE_NEAR` tiles), para os dois ficarem no mesmo quadro; sem ninguém, agora.
 */
export function danceStartFor(
  dance: DanceId,
  at: TilePoint,
  now: number,
  others: readonly (TilePoint & { dance: string; danceStart: number })[],
): number {
  let best: { d: number; start: number } | null = null;
  for (const o of others) {
    if (o.dance !== dance) continue;
    const d = Math.max(Math.abs(o.x - at.x), Math.abs(o.y - at.y));
    if (d <= DANCE_NEAR && (!best || d < best.d)) best = { d, start: o.danceStart };
  }
  return best ? best.start : now;
}

/** Comando de dança no chat: abrir a escolha, começar uma dança, parar ou nome desconhecido. */
export type DanceCommand =
  { menu: true } | { dance: DanceId } | { stop: true } | { unknown: string };

function danceByName(name: string): DanceId | null {
  const key = nameKey(name).replace(/\s+/g, '');
  return (
    DANCE_IDS.find(
      (id) => DANCES[id].command === key || nameKey(DANCES[id].label).replace(/\s+/g, '') === key,
    ) ?? null
  );
}

/**
 * `/dancar` (abre a escolha), `/dancar macarena`, `/macarena`… e `/parar`. Devolve `null` se não
 * for um comando de dança.
 */
export function parseDanceCommand(text: string): DanceCommand | null {
  const m = /^\s*\/(\S+)(?:\s+(.*\S))?\s*$/.exec(text);
  if (!m) return null;
  const cmd = nameKey(m[1]!);
  if (cmd === 'parar' && !m[2]) return { stop: true };
  if (cmd === 'dancar') {
    if (!m[2]) return { menu: true };
    const id = danceByName(m[2]);
    return id ? { dance: id } : { unknown: m[2] };
  }
  const id = m[2] ? null : danceByName(cmd);
  return id ? { dance: id } : null;
}
