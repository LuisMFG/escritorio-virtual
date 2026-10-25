import { z } from 'zod';
import { footprint, type FurniDef, type PlacedFurni } from './furni.js';
import type { TilePoint } from './iso.js';
import type { GameScore } from './games.js';
import { decodeBall, type PongBall } from './pong.js';
import {
  decodeJson,
  GROUP_NAMES,
  otherGroup,
  type PoolBalls,
  type PoolGroup,
  type PoolLogEntry,
  type PoolShotRecord,
} from './pool.js';

/**
 * Salão de Jogos (Fase 57): base comum das mesas de sinuca e ping-pong. Cada mesa tem dois lados
 * (A e B), com um ou dois jogadores em cada (1×1 ou 2×2). Vagas, placar e resultado ficam no
 * estado da sala, então quem não joga assiste ao vivo. O jogo de cada mesa vem por cima disto.
 */
export const ARCADE_KINDS = ['pingpong', 'pool'] as const;
export type ArcadeKind = (typeof ARCADE_KINDS)[number];

export const ARCADE_INFO: Record<ArcadeKind, { name: string; icon: string; game: string }> = {
  pingpong: { name: 'Ping-pong', icon: '🏓', game: 'no ping-pong' },
  pool: { name: 'Sinuca', icon: '🎱', game: 'na sinuca' },
};

/** O jogo da mesa, pela interação do móvel (`null` = não é mesa do Salão). */
export function arcadeKindOf(interaction: string | undefined): ArcadeKind | null {
  return (ARCADE_KINDS as readonly string[]).includes(interaction ?? '')
    ? (interaction as ArcadeKind)
    : null;
}

/** Vagas: `a1`/`a2` de um lado, `b1`/`b2` do outro. No 1×1 só a primeira de cada lado. */
export const ARCADE_SLOTS = ['a1', 'a2', 'b1', 'b2'] as const;
export type ArcadeSlot = (typeof ARCADE_SLOTS)[number];
export type ArcadeSide = 'a' | 'b';
/** Jogadores por lado. */
export type ArcadeMode = 1 | 2;
export type ArcadeStatus = 'waiting' | 'playing' | 'ended';
/** Como a partida acabou: no jogo, por desistência ou por W.O. (saiu e não voltou a tempo). */
export type ArcadeEnd = '' | 'points' | 'forfeit' | 'wo';

/** Quem sai da sala no meio da partida tem este tempo para voltar; depois, W.O. */
export const ARCADE_WO_MS = 15_000;

/**
 * Jogar sozinho: treino (na sinuca, sem adversário; no ping-pong, contra a máquina de bolas) ou
 * contra o computador, em três níveis. O computador e a máquina ocupam a vaga do outro lado com
 * esta sessão (não é ninguém da sala). Nada disso conta no placar, no ranking nem nas conquistas.
 */
export const ARCADE_CPU_SESSION = 'cpu';
export const ARCADE_SOLOS = ['practice', 'cpu'] as const;
export type ArcadeSolo = (typeof ARCADE_SOLOS)[number];
export const ARCADE_LEVELS = ['facil', 'medio', 'dificil'] as const;
export type ArcadeLevel = (typeof ARCADE_LEVELS)[number];
export const LEVEL_NAMES: Record<ArcadeLevel, string> = {
  facil: 'fácil',
  medio: 'médio',
  dificil: 'difícil',
};
/** Nome de quem ocupa a vaga do outro lado. */
export function soloOpponentName(kind: ArcadeKind, solo: ArcadeSolo, level: ArcadeLevel): string {
  if (solo === 'cpu') return `Computador (${LEVEL_NAMES[level]})`;
  return kind === 'pingpong' ? `Máquina de bolas (${LEVEL_NAMES[level]})` : '';
}
/** Quem pede a mesa espera a resposta por esse tempo; sem resposta, a mesa é liberada. */
export const ARCADE_ASK_MS = 20_000;

export const sideOf = (slot: ArcadeSlot): ArcadeSide => slot[0] as ArcadeSide;
export const otherSide = (side: ArcadeSide): ArcadeSide => (side === 'a' ? 'b' : 'a');

/** Vagas em jogo num modo. */
export function slotsOf(mode: number): ArcadeSlot[] {
  return mode === 2 ? [...ARCADE_SLOTS] : ['a1', 'b1'];
}

/** As vagas de um lado num modo. */
export function sideSlots(side: ArcadeSide, mode: number): ArcadeSlot[] {
  return slotsOf(mode).filter((s) => sideOf(s) === side);
}

/** Um jogador numa vaga (vazia = sem sessão). `awayUntil`: saiu e tem até lá para voltar. */
export interface ArcadeSeat {
  session: string;
  user: string;
  name: string;
  awayUntil: number;
}

/** A partida como o estado sincroniza: as vagas achatadas, como no jogo da velha. */
export interface ArcadeFields {
  kind: string;
  mode: number;
  status: string;
  a1Session: string;
  a1User: string;
  a1Name: string;
  a1Away: number;
  a2Session: string;
  a2User: string;
  a2Name: string;
  a2Away: number;
  b1Session: string;
  b1User: string;
  b1Name: string;
  b1Away: number;
  b2Session: string;
  b2User: string;
  b2Name: string;
  b2Away: number;
  scoreA: number;
  scoreB: number;
  setsA: number;
  setsB: number;
  turn: string;
  phase: string;
  ball: string;
  a1Px: number;
  a1Py: number;
  a2Px: number;
  a2Py: number;
  b1Px: number;
  b1Py: number;
  b2Px: number;
  b2Py: number;
  balls: string;
  shot: string;
  groupA: string;
  inHand: boolean;
  breakShot: boolean;
  deadline: number;
  aim: string;
  detail: string;
  log: string;
  solo: string;
  level: string;
  askSession: string;
  askName: string;
  askUntil: number;
  winner: string;
  end: string;
}

/** Mira ao vivo de quem taca na sinuca. */
export interface PoolAim {
  dx: number;
  dy: number;
  power: number;
  cx: number;
  cy: number;
}

/** A sinuca para ler (Fase 59). */
export interface PoolView {
  balls: PoolBalls | null;
  shot: PoolShotRecord | null;
  groupA: '' | PoolGroup;
  inHand: boolean;
  breakShot: boolean;
  deadline: number;
  aim: PoolAim | null;
  /** As últimas tacadas, a mais nova primeiro. */
  log: PoolLogEntry[];
}

/** A partida para ler: vagas como objetos. */
export interface ArcadeView {
  kind: ArcadeKind;
  mode: ArcadeMode;
  status: ArcadeStatus;
  seats: Record<ArcadeSlot, ArcadeSeat>;
  scoreA: number;
  scoreB: number;
  /** Sets ganhos por lado (ping-pong). */
  setsA: number;
  setsB: number;
  /** Vaga da vez (quem saca), ou vazio. */
  turn: ArcadeSlot | '';
  /** Ping-pong: 'serve' | 'rally' | 'point'; sinuca: 'aim' (mirando) | 'shot' (bolas andando). */
  phase: '' | 'serve' | 'rally' | 'point' | 'aim' | 'shot';
  ball: PongBall | null;
  paddles: Record<ArcadeSlot, { x: number; y: number }>;
  pool: PoolView;
  /** Detalhe do jogo (o último ponto, set, grupo de bolas…). */
  detail: string;
  winner: '' | ArcadeSide;
  end: ArcadeEnd;
  /** Jogando sozinho (treino ou contra o computador), e em que nível. */
  solo: '' | ArcadeSolo;
  level: ArcadeLevel;
  /** Pedido da mesa a quem joga sozinho: quem pediu e até quando. */
  ask: { session: string; name: string; until: number } | null;
}

export function seatOf(g: ArcadeFields, slot: ArcadeSlot): ArcadeSeat {
  return {
    session: g[`${slot}Session`],
    user: g[`${slot}User`],
    name: g[`${slot}Name`],
    awayUntil: g[`${slot}Away`],
  };
}

export function arcadeView(g: ArcadeFields): ArcadeView {
  return {
    kind: arcadeKindOf(g.kind) ?? 'pingpong',
    mode: g.mode === 2 ? 2 : 1,
    status: (['waiting', 'playing', 'ended'] as const).find((s) => s === g.status) ?? 'waiting',
    seats: Object.fromEntries(ARCADE_SLOTS.map((s) => [s, seatOf(g, s)])) as Record<
      ArcadeSlot,
      ArcadeSeat
    >,
    scoreA: g.scoreA,
    scoreB: g.scoreB,
    setsA: g.setsA,
    setsB: g.setsB,
    turn: (ARCADE_SLOTS as readonly string[]).includes(g.turn) ? (g.turn as ArcadeSlot) : '',
    phase: (['serve', 'rally', 'point', 'aim', 'shot'] as const).find((p) => p === g.phase) ?? '',
    ball: decodeBall(g.ball),
    paddles: Object.fromEntries(
      ARCADE_SLOTS.map((s) => [s, { x: g[`${s}Px`], y: g[`${s}Py`] }]),
    ) as Record<ArcadeSlot, { x: number; y: number }>,
    pool: {
      balls: decodeJson<PoolBalls>(g.balls),
      shot: decodeJson<PoolShotRecord>(g.shot),
      groupA: g.groupA === 'solids' || g.groupA === 'stripes' ? g.groupA : '',
      inHand: Boolean(g.inHand),
      breakShot: Boolean(g.breakShot),
      deadline: g.deadline ?? 0,
      aim: decodeJson<PoolAim>(g.aim),
      log: decodeJson<PoolLogEntry[]>(g.log ?? '') ?? [],
    },
    detail: g.detail,
    winner: g.winner === 'a' || g.winner === 'b' ? g.winner : '',
    end: (['points', 'forfeit', 'wo'] as const).find((e) => e === g.end) ?? '',
    solo: ARCADE_SOLOS.find((s) => s === g.solo) ?? '',
    level: ARCADE_LEVELS.find((l) => l === g.level) ?? 'medio',
    ask: g.askSession
      ? { session: g.askSession, name: g.askName ?? '', until: g.askUntil ?? 0 }
      : null,
  };
}

/** Nomes de um lado: "Ana" ou "Ana e Bia" (vazio = ninguém). */
export function sideNames(v: ArcadeView, side: ArcadeSide): string {
  return sideSlots(side, v.mode)
    .map((s) => v.seats[s].name)
    .filter(Boolean)
    .join(' e ');
}

const short = (name: string) => (name.length > 12 ? `${name.slice(0, 11)}…` : name);

/**
 * Placar que flutua sobre a mesa na sala: quem joga e o placar; quem saiu, com o tempo até o
 * W.O.; e o vencedor no fim. `null` = mesa vazia (sem placar).
 */
export function scoreboardText(v: ArcadeView, now: number): string | null {
  const seated = slotsOf(v.mode).filter((s) => v.seats[s].session);
  if (!seated.length) return null;
  const names = (side: ArcadeSide) =>
    sideSlots(side, v.mode)
      .map((s) => short(v.seats[s].name))
      .filter(Boolean)
      .join(' e ') || '…';
  const icon = ARCADE_INFO[v.kind].icon;
  // Sets de quem venceu primeiro (ping-pong, Fase 58).
  const sets = (w: ArcadeSide) =>
    w === 'a' ? `${v.setsA} × ${v.setsB}` : `${v.setsB} × ${v.setsA}`;
  if (v.status === 'ended' && v.winner) {
    const how =
      v.end === 'wo'
        ? ' (W.O.)'
        : v.end === 'forfeit'
          ? ' (desistência)'
          : v.end === 'points' && v.kind === 'pingpong'
            ? ` (${sets(v.winner)})`
            : v.end === 'points' && v.detail
              ? ` (${v.detail})`
              : '';
    const plural = sideSlots(v.winner, v.mode).filter((s) => v.seats[s].name).length > 1;
    return `🏆 ${names(v.winner)} ${plural ? 'venceram' : 'venceu'}${how}`;
  }
  const line =
    v.status === 'playing'
      ? `${icon} ${names('a')} ${v.scoreA} × ${v.scoreB} ${names('b')}`
      : `${icon} ${names('a')} × ${names('b')}`;
  // Treino: quem treina (e, no ping-pong, as devolvidas); pedido da mesa em andamento.
  if (v.status === 'playing' && v.solo === 'practice') {
    const slot = seated.find((s) => v.seats[s].session !== ARCADE_CPU_SESSION);
    const name = slot ? short(v.seats[slot].name) : '';
    const ok = slot && sideOf(slot) === 'a' ? v.scoreA : v.scoreB;
    const extra = v.kind === 'pingpong' ? `Devolvidas: ${ok}` : 'Treino livre';
    return `${icon} ${name} treinando\n${extra}`;
  }
  const away = seated.find((s) => v.seats[s].awayUntil > now);
  if (v.status === 'playing' && away) {
    const left = Math.ceil((v.seats[away].awayUntil - now) / 1000);
    return `${line}\n⏳ ${short(v.seats[away].name)} saiu: W.O. em ${left} s`;
  }
  if (v.status === 'waiting') return `${line}\nAguardando`;
  if (v.kind === 'pingpong') return `${line}\nSets ${sets('a')}`;
  // Sinuca: o grupo de cada lado, ou a mesa aberta.
  const g = v.pool.groupA;
  return g
    ? `${line}\nA: ${GROUP_NAMES[g]} · B: ${GROUP_NAMES[otherGroup(g)]}`
    : `${line}\nMesa aberta`;
}

/**
 * Onde cada vaga fica, em volta da mesa: o lado A numa ponta e o B na outra, o segundo
 * jogador de cada lado ao lado do primeiro (do lado da frente, que aparece na tela).
 */
export function slotSpot(
  def: Pick<FurniDef, 'width' | 'depth'>,
  table: Pick<PlacedFurni, 'x' | 'y' | 'rot'>,
  slot: ArcadeSlot,
): TilePoint {
  const fp = footprint(def, table.x, table.y, table.rot);
  const second = slot.endsWith('2') ? 1 : 0;
  if (fp.maxX - fp.minX >= fp.maxY - fp.minY) {
    const y = Math.floor((fp.minY + fp.maxY) / 2) + second;
    return { x: sideOf(slot) === 'a' ? fp.minX - 1 : fp.maxX + 1, y };
  }
  const x = Math.floor((fp.minX + fp.maxX) / 2) + second;
  return { x, y: sideOf(slot) === 'a' ? fp.minY - 1 : fp.maxY + 1 };
}

const furniId = z.string().min(1).max(40);
export const arcadeRefSchema = z.object({ furniId });
export const arcadeJoinSchema = z.object({ furniId, slot: z.enum(ARCADE_SLOTS) });
export const arcadeModeSchema = z.object({
  furniId,
  mode: z.union([z.literal(1), z.literal(2)]),
});
export type ArcadeJoinMessage = z.infer<typeof arcadeJoinSchema>;
export type ArcadeModeMessage = z.infer<typeof arcadeModeSchema>;

/** Torcida: o que quem assiste pode mandar para a mesa (aparece sobre ela para a sala toda). */
export const ARCADE_CHEERS = {
  clap: { emoji: '👏', label: 'Aplausos' },
  uuh: { emoji: '😮', label: 'Uuh!' },
  hype: { emoji: '🔥', label: 'Vai, vai!' },
  laugh: { emoji: '😂', label: 'Kkkk' },
} as const;
export type ArcadeCheer = keyof typeof ARCADE_CHEERS;
export const ARCADE_CHEER_IDS = Object.keys(ARCADE_CHEERS) as ArcadeCheer[];
export const arcadeCheerSchema = z.object({
  furniId,
  cheer: z.enum(ARCADE_CHEER_IDS as [ArcadeCheer, ...ArcadeCheer[]]),
});
/** Alguém da torcida reagiu (servidor → sala). */
export interface ArcadeCheerMessage {
  furniId: string;
  cheer: ArcadeCheer;
  sessionId: string;
  name: string;
}

/** Ranking de um jogo do Salão: os melhores e o placar de quem pediu. */
export const ARCADE_RANKING_TOP = 10;
export const arcadeRankingSchema = z.object({ kind: z.enum(ARCADE_KINDS) });
export interface ArcadeRanking {
  kind: ArcadeKind;
  top: GameScore[];
  me: GameScore;
}

/** Jogar sozinho numa mesa em que só eu estou. */
export const arcadeSoloSchema = z.object({
  furniId,
  solo: z.enum(ARCADE_SOLOS),
  level: z.enum(ARCADE_LEVELS),
});
export type ArcadeSoloMessage = z.infer<typeof arcadeSoloSchema>;
/** Resposta de quem joga sozinho ao pedido da mesa. */
export const arcadeAnswerSchema = z.object({ furniId, accept: z.boolean() });
/** Quem pediu a mesa fica sabendo se a pessoa aceitou. */
export interface ArcadeAskResult {
  furniId: string;
  accepted: boolean;
  name: string;
}

/** Resposta dos pedidos das mesas: aceito, ou o motivo da recusa. */
export type ArcadeReply = { ok: true } | { ok: false; reason: string };
