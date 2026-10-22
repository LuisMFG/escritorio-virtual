import { describe, expect, it } from 'vitest';
import {
  addPongPoint,
  ballAt,
  canHit,
  clampPaddle,
  decodeBall,
  encodeBall,
  hitBall,
  isDeuce,
  newPongScore,
  nextEvent,
  PONG,
  serveBall,
  servingSide,
  servingSlot,
  simulate,
  type PongBall,
  type PongScore,
  type PongSide,
} from './pong.js';

const NET = PONG.tableL / 2;
/** Placar com estes pontos (e sets). */
const score = (a: number, b: number, over: Partial<PongScore> = {}): PongScore => ({
  ...newPongScore(),
  points: { a, b },
  ...over,
});
/** Joga a sequência de pontos a partir do zero. */
function play(seq: string): ReturnType<typeof addPongPoint> {
  let res: ReturnType<typeof addPongPoint> = { score: newPongScore() };
  for (const c of seq) res = addPongPoint(res.score, c as PongSide);
  return res;
}
/** O ponto que o trecho decide sozinho (sem ninguém rebater). */
const pointOf = (b: PongBall) => simulate(b, b.t0 + 30_000).point;

describe('ping-pong: placar, saque e sets (Fase 58)', () => {
  it('set de 11 com 2 de vantagem; no 10 × 10 vai até alguém abrir 2', () => {
    expect(addPongPoint(score(10, 9), 'a')).toMatchObject({
      set: 'a',
      score: { sets: { a: 1, b: 0 } },
    });
    expect(addPongPoint(score(10, 10), 'a').set).toBeUndefined();
    expect(isDeuce(score(10, 10))).toBe(true);
    expect(addPongPoint(score(11, 10), 'b').score.points).toEqual({ a: 11, b: 11 });
    expect(addPongPoint(score(12, 11), 'a')).toMatchObject({ set: 'a' });
    // O placar do set zera e quem recebeu primeiro saca primeiro no set seguinte.
    const next = addPongPoint(score(10, 3), 'a').score;
    expect(next).toMatchObject({ points: { a: 0, b: 0 }, first: 'b' });
  });

  it('melhor de 3: quem fecha 2 sets vence', () => {
    const elevenZero = 'a'.repeat(11);
    expect(play(elevenZero).set).toBe('a');
    expect(play(elevenZero + 'b'.repeat(11))).toMatchObject({
      set: 'b',
      score: { sets: { a: 1, b: 1 } },
    });
    const won = play(elevenZero + 'b'.repeat(11) + elevenZero);
    expect(won).toMatchObject({ match: 'a', score: { sets: { a: 2, b: 1 } } });
    // O placar final do último set fica à mostra.
    expect(won.score.points).toEqual({ a: 11, b: 0 });
  });

  it('o saque troca a cada 2 pontos; no 10 × 10, a cada ponto', () => {
    const sides = [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ].map(([a, b]) => servingSide(score(a!, b!)));
    expect(sides).toEqual(['a', 'a', 'b', 'b', 'a']);
    expect(servingSide(score(10, 10))).toBe('a');
    expect(servingSide(score(11, 10))).toBe('b');
    expect(servingSide(score(11, 11))).toBe('a');
    // No segundo set, quem saca primeiro é o B.
    expect(servingSide(score(0, 0, { first: 'b' }))).toBe('b');
  });

  it('no 2×2, os parceiros se revezam no saque do seu lado', () => {
    const slots = [0, 2, 4, 6, 8].map((n) => servingSlot(score(n, 0), 2));
    expect(slots).toEqual(['a1', 'b1', 'a2', 'b2', 'a1']);
    expect(servingSlot(score(2, 0), 1)).toBe('b1');
  });
});

describe('ping-pong: a bola (Fase 58)', () => {
  it('o saque passa a rede e quica no outro lado; sem rebatida, o ponto é de quem sacou', () => {
    const serve = serveBall('a', { x: -0.2, y: 0.5 }, 1000);
    const first = nextEvent(serve);
    expect(first).toMatchObject({ kind: 'bounce', side: 'b' });
    const at = ballAt(serve, first.t);
    expect(at.x).toBeGreaterThan(NET);
    expect(at.x).toBeLessThan(PONG.tableL);
    expect(pointOf(serve)).toMatchObject({ side: 'a' });
    // Do lado B também.
    expect(nextEvent(serveBall('b', { x: 3, y: 1 }, 0))).toMatchObject({
      kind: 'bounce',
      side: 'a',
    });
  });

  it('o quique tira um pouco da velocidade e conta do lado em que caiu', () => {
    const serve = serveBall('a', { x: -0.1, y: 0.7 }, 0);
    const ev = nextEvent(serve);
    const after = simulate(serve, ev.t + 1).ball!;
    const impact = ballAt(serve, ev.t);
    expect(after).toMatchObject({ h: 0, na: 0, nb: 1, by: 'a' });
    expect(after.vh).toBeCloseTo(-impact.vh * PONG.bounce, 6);
    expect(after.vx).toBeCloseTo(impact.vx * PONG.bounceKeep, 6);
  });

  it('rebatida volta para o outro lado por cima da rede; diagonal demais sai', () => {
    const serve = serveBall('a', { x: -0.2, y: 0.76 }, 0);
    const bounce = nextEvent(serve);
    const t = bounce.t + 250;
    const b = simulate(serve, t).ball!;
    const at = ballAt(b, t);
    const paddle = { x: at.x + 0.03, y: at.y };
    expect(canHit(b, at, 'b', paddle)).toBe(true);
    const back = hitBall(at, paddle, { x: -1.5, y: 0 }, 'b', b.hits, t);
    const land = nextEvent(back);
    expect(land).toMatchObject({ kind: 'bounce', side: 'a' });
    expect(back).toMatchObject({ by: 'b', na: 0, nb: 0, hits: 1 });
    // Pegando com a beirada da raquete e puxando para o lado, a bola sai pela lateral: ponto do A.
    const wide = hitBall(at, { x: at.x, y: at.y + 0.1 }, { x: -1, y: -4 }, 'b', 0, t);
    expect(pointOf(wide)).toMatchObject({ side: 'a' });
  });

  it('mais forte cai mais fundo e chega mais rápido; a bola acelera ao longo do ponto', () => {
    const at = { x: 3, y: 0.7, h: 0.2, vx: 2, vy: 0, vh: 0 };
    const soft = hitBall(at, { x: 3, y: 0.7 }, { x: 0, y: 0 }, 'b', 0, 0);
    const hard = hitBall(at, { x: 3, y: 0.7 }, { x: -3, y: 0 }, 'b', 0, 0);
    const landX = (b: PongBall) => ballAt(b, nextEvent(b).t).x;
    expect(landX(hard)).toBeLessThan(landX(soft));
    expect(nextEvent(hard).t).toBeLessThan(nextEvent(soft).t);
    const late = hitBall(at, { x: 3, y: 0.7 }, { x: 0, y: 0 }, 'b', 20, 0);
    expect(nextEvent(late).t).toBeLessThan(nextEvent(soft).t);
  });

  it('rebatendo de trás e de baixo da mesa, o arco sobe para passar a linha de fundo e a rede', () => {
    const low = { x: 3.3, y: 0.7, h: -0.4, vx: 2, vy: 0, vh: -1 };
    const back = hitBall(low, { x: 3.3, y: 0.7 }, { x: 0, y: 0 }, 'b', 0, 0);
    const heightAt = (x: number) => ballAt(back, ((x - back.x) / back.vx) * 1000).h;
    expect(heightAt(PONG.tableL)).toBeGreaterThanOrEqual(0.02);
    expect(heightAt(NET)).toBeGreaterThan(PONG.netH);
    expect(nextEvent(back)).toMatchObject({ kind: 'bounce', side: 'a' });
  });

  it('bola baixa demais bate na rede: ponto de quem recebia', () => {
    // Arco rente ao tampo (sem a correção do lançamento), chegando na rede abaixo da altura dela.
    const flat: PongBall = {
      t0: 0,
      x: 1,
      y: 0.7,
      h: 0.1,
      vx: 3,
      vy: 0,
      vh: 0.2,
      by: 'a',
      na: 0,
      nb: 0,
      hits: 0,
    };
    expect(nextEvent(flat)).toMatchObject({ kind: 'net' });
    expect(pointOf(flat)).toMatchObject({ side: 'b' });
  });

  it('dois quiques do mesmo lado: ponto de quem bateu; quique no próprio lado: do outro', () => {
    // Bola fraquinha logo depois da rede: quica duas vezes no lado B.
    const weak: PongBall = {
      t0: 0,
      x: NET + 0.2,
      y: 0.7,
      h: 0.2,
      vx: 0.3,
      vy: 0,
      vh: 0,
      by: 'a',
      na: 0,
      nb: 0,
      hits: 0,
    };
    expect(pointOf(weak)).toMatchObject({ side: 'a' });
    const own: PongBall = { ...weak, x: 0.2, vx: 0.2 };
    expect(pointOf(own)).toMatchObject({ side: 'b' });
  });

  it('só rebate quem recebe, depois de um quique, ao alcance e na altura que dá', () => {
    const serve = serveBall('a', { x: 0, y: 0.76 }, 0);
    const before = ballAt(serve, 300);
    expect(canHit(serve, before, 'b', before)).toBe(false); // ainda não quicou
    const t = nextEvent(serve).t + 200;
    const b = simulate(serve, t).ball!;
    const at = ballAt(b, t);
    expect(canHit(b, at, 'a', at)).toBe(false); // quem sacou não rebate a própria bola
    expect(canHit(b, at, 'b', { x: at.x + 0.3, y: at.y })).toBe(false); // longe
    expect(canHit(b, at, 'b', { x: at.x + 0.12, y: at.y }, PONG.reachSlack)).toBe(true); // folga
  });

  it('a raquete fica no seu lado da mesa', () => {
    expect(clampPaddle('a', { x: 2, y: -3 })).toEqual({ x: NET - PONG.netGap, y: -PONG.zoneSide });
    expect(clampPaddle('b', { x: 9, y: 0.5 })).toEqual({ x: PONG.tableL + PONG.zoneBack, y: 0.5 });
  });

  it('o trecho vai para o estado e volta igual (o navegador calcula a mesma bola)', () => {
    const serve = serveBall('b', { x: 2.9, y: 0.3 }, 123_456);
    expect(decodeBall(encodeBall(serve))).toEqual(serve);
    expect(decodeBall('')).toBeNull();
    expect(decodeBall('{ruim')).toBeNull();
    // Calcular em passos dá o mesmo que de uma vez.
    const t = serve.t0 + 1500;
    const once = simulate(serve, t).ball!;
    const mid = simulate(serve, serve.t0 + 700).ball!;
    expect(ballAt(simulate(mid, t).ball!, t)).toEqual(ballAt(once, t));
  });
});
