import { describe, expect, it } from 'vitest';
import {
  ARCADE_SLOTS,
  arcadeJoinSchema,
  arcadeKindOf,
  arcadeModeSchema,
  arcadeView,
  scoreboardText,
  sideNames,
  slotSpot,
  slotsOf,
  type ArcadeFields,
} from './arcade.js';
import { rackBalls } from './pool.js';

/** Partida como o estado manda (vagas achatadas). */
function fields(over: Partial<ArcadeFields> = {}): ArcadeFields {
  const seats = Object.fromEntries(
    ARCADE_SLOTS.flatMap((s) => [
      [`${s}Session`, ''],
      [`${s}User`, ''],
      [`${s}Name`, ''],
      [`${s}Away`, 0],
    ]),
  );
  const paddles = Object.fromEntries(
    ARCADE_SLOTS.flatMap((s) => [
      [`${s}Px`, 0],
      [`${s}Py`, 0],
    ]),
  );
  return {
    kind: 'pingpong',
    mode: 1,
    status: 'waiting',
    scoreA: 0,
    scoreB: 0,
    setsA: 0,
    setsB: 0,
    turn: '',
    phase: '',
    ball: '',
    balls: '',
    shot: '',
    groupA: '',
    inHand: false,
    breakShot: false,
    deadline: 0,
    aim: '',
    ...paddles,
    detail: '',
    winner: '',
    end: '',
    ...seats,
    ...over,
  } as ArcadeFields;
}
const ana = { a1Session: 's1', a1User: 'u1', a1Name: 'Ana' };
const beto = { b1Session: 's2', b1User: 'u2', b1Name: 'Beto' };

describe('Salão de Jogos: base das mesas (Fase 57)', () => {
  it('as mesas são as de interação pingpong e pool', () => {
    expect(arcadeKindOf('pingpong')).toBe('pingpong');
    expect(arcadeKindOf('pool')).toBe('pool');
    expect(arcadeKindOf('tictactoe')).toBeNull();
    expect(arcadeKindOf(undefined)).toBeNull();
  });

  it('1×1 usa a primeira vaga de cada lado; 2×2, as quatro', () => {
    expect(slotsOf(1)).toEqual(['a1', 'b1']);
    expect(slotsOf(2)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('as vagas ficam nas pontas da mesa, a segunda do lado da frente', () => {
    const def = { width: 2, depth: 1 };
    // Comprida no eixo x (rot 0): pontas em x-1 e x+2.
    const t0 = { x: 4, y: 6, rot: 0 };
    expect(slotSpot(def, t0, 'a1')).toEqual({ x: 3, y: 6 });
    expect(slotSpot(def, t0, 'a2')).toEqual({ x: 3, y: 7 });
    expect(slotSpot(def, t0, 'b1')).toEqual({ x: 6, y: 6 });
    expect(slotSpot(def, t0, 'b2')).toEqual({ x: 6, y: 7 });
    // Girada (rot 2): comprida no eixo y.
    const t2 = { x: 4, y: 6, rot: 2 };
    expect(slotSpot(def, t2, 'a1')).toEqual({ x: 4, y: 5 });
    expect(slotSpot(def, t2, 'b2')).toEqual({ x: 5, y: 8 });
  });

  it('o placar sobre a mesa: vazia, esperando, jogando, alguém saiu e o resultado', () => {
    expect(scoreboardText(arcadeView(fields()), 0)).toBeNull();
    expect(scoreboardText(arcadeView(fields({ ...ana })), 0)).toBe('🏓 Ana × …\nAguardando');
    const game = fields({ ...ana, ...beto, status: 'playing', scoreA: 3, scoreB: 5, setsA: 1 });
    expect(scoreboardText(arcadeView(game), 0)).toBe('🏓 Ana 3 × 5 Beto\nSets 1 × 0');
    expect(scoreboardText(arcadeView({ ...game, b1Away: 12_000 }), 2_500)).toBe(
      '🏓 Ana 3 × 5 Beto\n⏳ Beto saiu: W.O. em 10 s',
    );
    // Fim no jogo: os sets de quem venceu primeiro.
    expect(
      scoreboardText(
        arcadeView({ ...game, status: 'ended', winner: 'b', end: 'points', setsA: 1, setsB: 2 }),
        0,
      ),
    ).toBe('🏆 Beto venceu (2 × 1)');
    expect(
      scoreboardText(arcadeView({ ...game, status: 'ended', winner: 'b', end: 'wo' }), 0),
    ).toBe('🏆 Beto venceu (W.O.)');
    // Duplas, na sinuca, com nome comprido encurtado.
    const doubles = fields({
      kind: 'pool',
      mode: 2,
      status: 'ended',
      winner: 'a',
      end: 'forfeit',
      ...ana,
      a2Session: 's3',
      a2User: 'u3',
      a2Name: 'Bianca Albuquerque',
      ...beto,
    });
    const v = arcadeView(doubles);
    expect(sideNames(v, 'a')).toBe('Ana e Bianca Albuquerque');
    expect(scoreboardText(v, 0)).toBe('🏆 Ana e Bianca Albu… venceram (desistência)');
  });

  it('sinuca: o placar mostra os grupos (ou a mesa aberta) e o motivo do fim', () => {
    const game = fields({ kind: 'pool', ...ana, ...beto, status: 'playing', scoreA: 2, scoreB: 1 });
    expect(scoreboardText(arcadeView(game), 0)).toBe('🎱 Ana 2 × 1 Beto\nMesa aberta');
    expect(scoreboardText(arcadeView({ ...game, groupA: 'stripes' }), 0)).toBe(
      '🎱 Ana 2 × 1 Beto\nA: listradas · B: lisas',
    );
    const lost = { status: 'ended', winner: 'b', end: 'points', detail: 'a 8 caiu antes da hora' };
    expect(scoreboardText(arcadeView({ ...game, ...lost }), 0)).toBe(
      '🏆 Beto venceu (a 8 caiu antes da hora)',
    );
    // A vista lê as bolas, a mira ao vivo e as regras do estado.
    const aim = { dx: 1, dy: 0, power: 0.5, cx: 0.4, cy: 0.5 };
    const v = arcadeView({
      ...game,
      phase: 'shot',
      balls: JSON.stringify(rackBalls()),
      aim: JSON.stringify(aim),
      inHand: true,
      groupA: 'grupo-inventado',
    });
    expect(v.phase).toBe('shot');
    expect(v.pool).toEqual({
      balls: rackBalls(),
      shot: null,
      groupA: '',
      inHand: true,
      breakShot: false,
      deadline: 0,
      aim,
      log: [],
    });
    // O histórico das tacadas vem do estado (ruim ou vazio vira lista vazia).
    const log = [{ kind: 'foul', text: 'Falta de Ana: branca na caçapa.', help: 'A branca…' }];
    expect(arcadeView({ ...game, log: JSON.stringify(log) }).pool.log).toEqual(log);
    expect(arcadeView({ ...game, log: '{quebrado' }).pool.log).toEqual([]);
  });

  it('os pedidos só aceitam vagas e modos que existem', () => {
    expect(arcadeJoinSchema.safeParse({ furniId: 'm', slot: 'b2' }).success).toBe(true);
    expect(arcadeJoinSchema.safeParse({ furniId: 'm', slot: 'c1' }).success).toBe(false);
    expect(arcadeModeSchema.safeParse({ furniId: 'm', mode: 2 }).success).toBe(true);
    expect(arcadeModeSchema.safeParse({ furniId: 'm', mode: 3 }).success).toBe(false);
  });
});
