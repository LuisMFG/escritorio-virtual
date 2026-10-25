import {
  ballAt,
  canHit,
  hitBall,
  PONG,
  serveBall,
  simulate,
  type PongBall,
  type PongSide,
} from '@office/shared';
import { describe, expect, it } from 'vitest';
import { catchupTime, homeX, interceptX, magnetY, perspective } from './pong.js';

/** A primeira hora (ms) em que a bola dá para rebater com a raquete em `x`, alinhada com ela. */
function hittableAt(seg: PongBall, side: PongSide, x: number): number | null {
  for (let t = seg.t0; t < seg.t0 + 3000; t += 5) {
    const sim = simulate(seg, t);
    if (sim.point || !sim.ball) return null;
    const at = ballAt(sim.ball, t);
    if (canHit(sim.ball, at, side, { x, y: at.y }) && Math.abs(at.x - x) < 0.05) return t;
  }
  return null;
}

describe('ping-pong: ajuda de quem joga', () => {
  it('perspectiva: esquerda e direita são as de quem joga, e o perto fica embaixo e maior', () => {
    const a = perspective('a', 520);
    const b = perspective('b', 520);
    // O lado A olha para x crescente: y maior fica à direita; o B olha ao contrário.
    expect(a.toPx(0, 1.4).x).toBeGreaterThan(a.toPx(0, 0.1).x);
    expect(b.toPx(PONG.tableL, 1.4).x).toBeLessThan(b.toPx(PONG.tableL, 0.1).x);
    // A minha linha de fundo fica embaixo e mais larga que a do outro lado.
    const nearW = a.toPx(0, PONG.tableW).x - a.toPx(0, 0).x;
    const farW = a.toPx(PONG.tableL, PONG.tableW).x - a.toPx(PONG.tableL, 0).x;
    expect(nearW).toBeGreaterThan(farW * 2);
    expect(a.toPx(0, 0.7).y).toBeGreaterThan(a.toPx(PONG.tableL, 0.7).y);
    // A bola mais alta sobe na tela.
    expect(a.toPx(1, 0.7, 0.5).y).toBeLessThan(a.toPx(1, 0.7, 0).y);
    // O mouse apontando para um lado leva a raquete para lá (ida e volta).
    for (const side of ['a', 'b'] as const) {
      const pr = perspective(side, 520);
      const sx = pr.toPx(homeX(side), 0.3, 0).x;
      expect(pr.lateralAt(sx)).toBeCloseTo(0.3, 6);
    }
  });

  it('a raquete espera atrás da linha e a bola sempre passa por onde ela dá para rebater', () => {
    // Saques e rebatidas de vários jeitos: em todos, dá para rebater no ponto que a raquete escolhe.
    const segs: [PongBall, PongSide][] = [
      [serveBall('a', { x: -0.2, y: 0.3 }, 0), 'b'],
      [serveBall('b', { x: 2.9, y: 1.2 }, 0), 'a'],
    ];
    const at = { x: -0.1, y: 0.7, h: 0.2, vx: -2, vy: 0, vh: 0 };
    for (const [paddleY, vx, vy, hits] of [
      [0.7, 0, 0, 0],
      [0.7, 3, 0, 8],
      [0.6, 0, 2, 3],
      [0.84, 0, -2, 12],
    ] as const) {
      segs.push([hitBall(at, { x: -0.1, y: paddleY }, { x: vx, y: vy }, 'a', hits, 0), 'b']);
    }
    for (const [seg, side] of segs) {
      const sim = simulate(seg, seg.t0 + 5000);
      // Saiu da mesa (o ponto é de quem recebia): não tem o que rebater.
      if (sim.point?.side === side) continue;
      const x = interceptX(seg, side, seg.t0);
      expect(hittableAt(seg, side, x)).not.toBeNull();
      // Perto do lugar de espera (no máximo a zona da raquete).
      expect(Math.abs(x - homeX(side))).toBeLessThan(PONG.zoneBack);
    }
    // Sem bola vindo (ou a minha indo embora), espera no lugar.
    expect(interceptX(null, 'a', 0)).toBe(homeX('a'));
    expect(interceptX(serveBall('a', { x: -0.2, y: 0.7 }, 0), 'a', 0)).toBe(homeX('a'));
  });

  it('ímã: perto, a raquete é puxada até a bola aos poucos; longe, nada', () => {
    expect(magnetY(0.5, 0.5 + PONG.magnetR + 0.01, 16)).toBe(0.5);
    const step = (PONG.magnetSpeed * 16) / 1000;
    expect(magnetY(0.5, 0.7, 16)).toBeCloseTo(0.5 + step, 9);
    expect(magnetY(0.5, 0.3, 16)).toBeCloseTo(0.5 - step, 9);
    expect(magnetY(0.5, 0.5 + step / 2, 16)).toBe(0.5 + step / 2);
  });

  it('rebatida atrasada: a tela sai de onde a bola estava e alcança o tempo certo', () => {
    const late = 200;
    // Chegou agora: mostra o começo da rebatida (o instante dela, 200 ms atrás).
    expect(catchupTime(1000, 1000, late)).toBe(800);
    // No meio do caminho, metade do atraso; depois de `catchupMs`, o tempo de verdade.
    expect(catchupTime(1000 + PONG.catchupMs / 2, 1000, late)).toBeCloseTo(
      1000 + PONG.catchupMs / 2 - late / 2,
      9,
    );
    expect(catchupTime(1000 + PONG.catchupMs, 1000, late)).toBe(1000 + PONG.catchupMs);
    expect(catchupTime(5000, 1000, late)).toBe(5000);
  });
});
