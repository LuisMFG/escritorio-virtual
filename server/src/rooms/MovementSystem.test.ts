import { parseHeightmap, RoomGrid, STEP_MS, type FurniDef } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { MovementSystem, type Mover } from './MovementSystem.js';

const block: FurniDef = {
  id: 'bloco',
  name: 'bloco',
  category: 'teste',
  width: 1,
  depth: 1,
  height: 1,
  canSit: false,
  canWalk: false,
  sitHeight: 0,
  directions: [0],
};

const map = parseHeightmap(['00000', '00000', '00000']);
// Parede de blocos em x = 2, com passagem só em y = 2.
const furni = [
  { id: 'b1', defId: 'bloco', x: 2, y: 0, z: 0, rot: 0 },
  { id: 'b2', defId: 'bloco', x: 2, y: 1, z: 0, rot: 0 },
];

function setup(others: Map<string, Mover> = new Map()) {
  const movers = new Map<string, Mover>(others);
  const sys: MovementSystem = new MovementSystem(
    (id): RoomGrid =>
      new RoomGrid(map, furni, new Map([['bloco', block]]), {
        seatsAsGoal: false,
        occupied: [...movers].filter(([k]) => k !== id).map(([k, m]) => sys.destinationOf(k, m)),
      }),
  );
  return { sys, movers };
}

const mover = (x: number, y: number): Mover => ({
  x,
  y,
  z: 0,
  nextX: x,
  nextY: y,
  dir: 2,
  action: 'idle',
});

function runUntilIdle(sys: MovementSystem, movers: Map<string, Mover>, maxMs = 20_000) {
  const visited: string[] = [];
  for (let t = 0; t < maxMs; t += 50) {
    sys.tick(50, movers);
    const m = movers.get('a')!;
    const key = `${m.x},${m.y}`;
    if (visited.at(-1) !== key) visited.push(key);
    if (m.action === 'idle') break;
  }
  return visited;
}

describe('MovementSystem', () => {
  it('anda tile a tile até o destino desviando dos móveis', () => {
    const { sys, movers } = setup();
    movers.set('a', mover(0, 0));
    expect(sys.request('a', movers.get('a')!, { x: 4, y: 0 })).toEqual({
      ok: true,
      dest: { x: 4, y: 0 },
    });
    const m = movers.get('a')!;
    expect(m.action).toBe('walk');
    expect([m.nextX, m.nextY]).not.toEqual([0, 0]);

    const visited = runUntilIdle(sys, movers);
    expect(m).toMatchObject({ x: 4, y: 0, nextX: 4, nextY: 0, action: 'idle' });
    expect(visited).not.toContain('2,0');
    expect(visited).not.toContain('2,1');
    expect(visited).toContain('2,2');
  });

  it('cada passo leva STEP_MS', () => {
    const { sys, movers } = setup();
    movers.set('a', mover(0, 0));
    sys.request('a', movers.get('a')!, { x: 1, y: 0 });
    sys.tick(STEP_MS - 1, movers);
    expect(movers.get('a')!.x).toBe(0);
    sys.tick(1, movers);
    expect(movers.get('a')).toMatchObject({ x: 1, action: 'idle' });
  });

  it('destino bloqueado vai para o tile livre mais próximo', () => {
    const { sys, movers } = setup();
    movers.set('a', mover(0, 0));
    const res = sys.request('a', movers.get('a')!, { x: 2, y: 0 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.dest).toEqual({ x: 1, y: 0 });
  });

  it('recusa destino fora da sala sem nada perto', () => {
    const { sys, movers } = setup();
    movers.set('a', mover(0, 0));
    expect(sys.request('a', movers.get('a')!, { x: 50, y: 50 })).toEqual({ ok: false });
    expect(movers.get('a')!.action).toBe('idle');
  });

  it('não para no mesmo tile que outro avatar', () => {
    const { sys, movers } = setup(new Map([['b', mover(1, 0)]]));
    movers.set('a', mover(0, 0));
    const res = sys.request('a', movers.get('a')!, { x: 1, y: 0 });
    expect(res.ok && (res.dest.x !== 1 || res.dest.y !== 0)).toBe(true);
  });

  it('pedido novo no meio do passo termina o passo atual primeiro', () => {
    const { sys, movers } = setup();
    movers.set('a', mover(0, 2));
    sys.request('a', movers.get('a')!, { x: 4, y: 2 });
    sys.tick(STEP_MS / 2, movers);
    const m = movers.get('a')!;
    expect([m.nextX, m.nextY]).toEqual([1, 2]);
    sys.request('a', m, { x: 1, y: 0 });
    // O passo para (1,2) continua; depois ele sobe para (1,1) e (1,0).
    expect([m.nextX, m.nextY]).toEqual([1, 2]);
    runUntilIdle(sys, movers);
    expect(m).toMatchObject({ x: 1, y: 0, action: 'idle' });
  });

  it('onStepEnd pode parar o avatar no meio do caminho (porta)', () => {
    const movers = new Map<string, Mover>([['a', mover(0, 2)]]);
    const stops: string[] = [];
    const sys = new MovementSystem(
      () => new RoomGrid(map, [], new Map(), { seatsAsGoal: false }),
      (_id, m) => {
        stops.push(`${m.x},${m.y}`);
        return m.x === 2;
      },
    );
    sys.request('a', movers.get('a')!, { x: 4, y: 2 });
    runUntilIdle(sys, movers);
    const m = movers.get('a')!;
    expect(m).toMatchObject({ x: 2, nextX: 2, action: 'idle' });
    expect(m.nextY).toBe(m.y);
    expect(stops).toHaveLength(2);
  });

  describe('plan / go / stop (Fase 52)', () => {
    it('plan só calcula: não mexe no avatar nem reserva o destino', () => {
      const { sys, movers } = setup();
      movers.set('a', mover(0, 0));
      const m = movers.get('a')!;
      const plan = sys.plan('a', m, { x: 4, y: 0 })!;
      expect(plan.dest).toEqual({ x: 4, y: 0 });
      expect(plan.path.at(-1)).toEqual({ x: 4, y: 0 });
      expect(m).toEqual(mover(0, 0));
      expect(sys.destinationOf('a', m)).toEqual({ x: 0, y: 0 });
      // Sem `go`, o tick não anda.
      sys.tick(STEP_MS * 3, movers);
      expect(m).toEqual(mover(0, 0));
    });

    it('go com caminho vazio (já está lá) mantém sentado', () => {
      const { sys, movers } = setup();
      movers.set('a', { ...mover(0, 0), action: 'sit', z: 0.5 });
      const m = movers.get('a')!;
      const plan = sys.plan('a', m, { x: 0, y: 0 })!;
      expect(plan.path).toEqual([]);
      sys.go('a', m, plan);
      expect(m).toMatchObject({ x: 0, y: 0, nextX: 0, nextY: 0, action: 'sit', z: 0.5 });
      sys.tick(STEP_MS, movers);
      expect(m.action).toBe('sit');
    });

    it('go com caminho vazio no meio de um passo termina o passo e para', () => {
      const { sys, movers } = setup();
      movers.set('a', mover(0, 2));
      const m = movers.get('a')!;
      sys.request('a', m, { x: 4, y: 2 });
      sys.tick(STEP_MS / 2, movers);
      sys.go('a', m, { dest: { x: 1, y: 2 }, path: [] });
      runUntilIdle(sys, movers);
      expect(m).toMatchObject({ x: 1, y: 2, nextX: 1, nextY: 2, action: 'idle' });
    });

    it('stop termina o passo atual sem deixar o avatar entre dois tiles', () => {
      const { sys, movers } = setup();
      movers.set('a', mover(0, 2));
      const m = movers.get('a')!;
      sys.request('a', m, { x: 4, y: 2 });
      sys.tick(STEP_MS / 2, movers);
      sys.stop('a');
      expect([m.nextX, m.nextY]).toEqual([1, 2]);
      runUntilIdle(sys, movers);
      expect(m).toMatchObject({ x: 1, y: 2, nextX: 1, nextY: 2, action: 'idle' });
      expect(sys.destinationOf('a', m)).toEqual({ x: 1, y: 2 });
    });
  });
});
