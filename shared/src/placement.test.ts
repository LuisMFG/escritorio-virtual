import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FurniDef, PlacedFurni } from './furni.js';
import { parseHeightmap } from './grid.js';
import { parseFurniManifest } from './manifests.js';
import type { FurniCatalog } from './furniCatalog.js';
import {
  acceptsOnTop,
  canPlace,
  hasWall,
  topHeight,
  MAX_FURNI_PER_ROOM,
  WALL_HEIGHT,
  canSetHeight,
  groupMoves,
  nearestSeatTile,
  stackedOn,
  stackGroup,
  surfaceTileAt,
  type PlacementContext,
} from './placement.js';
import { tileToScreen } from './iso.js';
import type { RoomDoor } from './rooms.js';
import { ROOMS } from './rooms.js';

const def = (over: Partial<FurniDef> & { id: string }): FurniDef => ({
  name: over.id,
  category: 'teste',
  width: 1,
  depth: 1,
  height: 1,
  canSit: false,
  canWalk: false,
  sitHeight: 0,
  directions: [0, 2, 4, 6],
  ...over,
});

const defs = new Map<string, FurniDef>([
  ['bloco', def({ id: 'bloco' })],
  ['mesa', def({ id: 'mesa', width: 2, depth: 1 })],
  ['tapete', def({ id: 'tapete', width: 2, depth: 2, height: 0, canWalk: true })],
  ['sofa', def({ id: 'sofa', width: 2, depth: 1, canSit: true, sitHeight: 0.5 })],
  // Empilhar: escrivaninha 2×1 com tampo a 0,8; computador e impressora pequenos.
  [
    'escrivaninha',
    def({ id: 'escrivaninha', width: 2, depth: 1, height: 1, stackHeight: 0.8, hasTop: true }),
  ],
  ['caixa', def({ id: 'caixa', hasTop: true })],
  ['pc', def({ id: 'pc', height: 0.6 })],
  ['cadeira', def({ id: 'cadeira', canSit: true, sitHeight: 0.5 })],
  ['quadro', def({ id: 'quadro', height: 2, interaction: 'whiteboard', hasTop: true })],
  ['torre', def({ id: 'torre', height: 4, hasTop: true })],
  // Balcão alto (tampo a 1,2): o tampo fica mais alto que um tile de profundidade.
  ['balcao', def({ id: 'balcao', width: 2, depth: 1, height: 1.2, hasTop: true })],
  // Fase 56: bloco de pisar (serve de base), exceções sem tampo e uma prateleira comprida.
  ['plataforma', def({ id: 'plataforma', canWalk: true, height: 1 })],
  ['luminaria', def({ id: 'luminaria', height: 1.5, light: true })],
  ['planta', def({ id: 'planta', height: 1, category: 'plantas' })],
  ['tv', def({ id: 'tv', height: 1, interaction: 'tv' })],
  ['cortina', def({ id: 'cortina', height: 2, hasTop: false })],
  ['comprida', def({ id: 'comprida', width: 2, depth: 1, height: 0.4, directions: [0] })],
]);

// Sala 6×5 com porta à esquerda em (0,2).
const door: RoomDoor = { x: 0, y: 2, targetRoomId: 'outra', targetX: 1, targetY: 1, targetDir: 2 };
function ctx(furni: PlacedFurni[] = [], over: Partial<PlacementContext> = {}): PlacementContext {
  return {
    map: parseHeightmap(['x00000', 'x00000', '000000', 'x00000', 'x00011']),
    furni,
    defs,
    doors: [door],
    spawn: { x: 1, y: 2 },
    avatars: [],
    ...over,
  };
}
const f = (id: string, defId: string, x: number, y: number, rot = 0): PlacedFurni => ({
  id,
  defId,
  x,
  y,
  z: 0,
  rot,
});

describe('canPlace', () => {
  it('aceita um lugar livre e devolve a altura do piso', () => {
    expect(canPlace(ctx(), { defId: 'bloco', x: 3, y: 1, rot: 0 })).toEqual({ ok: true, z: 0 });
  });

  it.each([
    [{ defId: 'nao-existe', x: 3, y: 1, rot: 0 }, 'desconhecido'],
    [{ defId: 'bloco', x: 3, y: 1, rot: 1 }, 'Rotação'],
    [{ defId: 'mesa', x: 5, y: 0, rot: 0 }, 'Fora da sala'],
    [{ defId: 'bloco', x: 0, y: 0, rot: 0 }, 'Fora da sala'],
    [{ defId: 'mesa', x: 3, y: 4, rot: 0 }, 'plano'],
    [{ defId: 'bloco', x: 0, y: 2, rot: 0 }, 'porta'],
    [{ defId: 'bloco', x: 1, y: 2, rot: 0 }, 'porta'],
  ])('recusa %o', (req, reason) => {
    const res = canPlace(ctx(), req);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(reason);
  });

  it('respeita o footprint girado', () => {
    // Mesa 2×1 girada ocupa (5,0) e (5,1): cabe; sem girar sairia da sala.
    expect(canPlace(ctx(), { defId: 'mesa', x: 5, y: 0, rot: 2 }).ok).toBe(true);
  });

  it('tapete não sobrepõe tapete; sólido fica em cima de tapete na altura do piso', () => {
    const c = ctx([f('t', 'tapete', 3, 0), f('b', 'bloco', 2, 0)]);
    expect(canPlace(c, { defId: 'bloco', x: 4, y: 1, rot: 0 })).toEqual({ ok: true, z: 0 });
    expect(canPlace(c, { defId: 'tapete', x: 4, y: 0, rot: 0 }).ok).toBe(false);
  });

  describe('empilhar', () => {
    it('computador e impressora em cima da escrivaninha, na altura do tampo', () => {
      const c = ctx([f('e', 'escrivaninha', 2, 0)]);
      expect(canPlace(c, { defId: 'pc', x: 2, y: 0, rot: 0 })).toEqual({ ok: true, z: 0.8 });
      const c2 = ctx([f('e', 'escrivaninha', 2, 0), { ...f('p', 'pc', 2, 0), z: 0.8 }]);
      expect(canPlace(c2, { defId: 'pc', x: 3, y: 0, rot: 0 })).toEqual({ ok: true, z: 0.8 });
      // Fase 56: qualquer móvel sólido com altura serve de base (impressora em cima do computador).
      expect(canPlace(c2, { defId: 'pc', x: 2, y: 0, rot: 0 })).toEqual({ ok: true, z: 1.4 });
    });

    it('sem stackHeight o tampo fica na altura do móvel; as exceções não aceitam nada', () => {
      const c = ctx([
        f('c', 'caixa', 2, 0),
        f('b', 'bloco', 4, 0),
        f('l', 'luminaria', 1, 3),
        f('pl', 'planta', 2, 3),
        f('t', 'tv', 3, 3),
        f('co', 'cortina', 4, 3),
      ]);
      expect(canPlace(c, { defId: 'pc', x: 2, y: 0, rot: 0 })).toEqual({ ok: true, z: 1 });
      // Regra nova (Fase 56): o bloco sem tampo explícito também serve.
      expect(canPlace(c, { defId: 'pc', x: 4, y: 0, rot: 0 })).toEqual({ ok: true, z: 1 });
      for (const x of [1, 2, 3, 4]) {
        expect(canPlace(c, { defId: 'pc', x, y: 3, rot: 0 }), `x=${x}`).toMatchObject({
          reason: 'Já tem um móvel aí.',
        });
      }
    });

    it('bloco de pisar serve de base e empilha em outro bloco (IN14)', () => {
      const c = ctx([f('pf', 'plataforma', 3, 1)]);
      expect(canPlace(c, { defId: 'pc', x: 3, y: 1, rot: 0 })).toEqual({ ok: true, z: 1 });
      expect(canPlace(c, { defId: 'plataforma', x: 3, y: 1, rot: 0 })).toEqual({ ok: true, z: 1 });
      // Tapete continua no chão, e bloco não vai em cima de alguém.
      expect(canPlace(c, { defId: 'tapete', x: 2, y: 0, rot: 0 })).toEqual({ ok: true, z: 0 });
      const withAvatar = ctx([], { avatars: [{ x: 3, y: 1 }] });
      expect(canPlace(withAvatar, { defId: 'plataforma', x: 3, y: 1, rot: 0 })).toMatchObject({
        reason: 'Tem alguém nesse lugar.',
      });
    });

    it('precisa de apoio plano: metade em cima da mesa e metade no chão não dá', () => {
      const c = ctx([f('c', 'caixa', 2, 0)]);
      expect(canPlace(c, { defId: 'mesa', x: 2, y: 0, rot: 0 })).toMatchObject({
        reason: 'Precisa de um apoio plano embaixo (ficaria torto).',
      });
    });

    it('nada em cima de assento, cama e quadro; assento já vai em cima de uma base (Fase 56)', () => {
      const c = ctx([f('s', 'sofa', 2, 0), f('q', 'quadro', 4, 0), f('e', 'escrivaninha', 2, 3)]);
      expect(canPlace(c, { defId: 'pc', x: 2, y: 0, rot: 0 })).toMatchObject({
        reason: 'Já tem um móvel aí.',
      });
      expect(canPlace(c, { defId: 'pc', x: 4, y: 0, rot: 0 }).ok).toBe(false);
      expect(canPlace(c, { defId: 'cadeira', x: 2, y: 3, rot: 0 })).toEqual({ ok: true, z: 0.8 });
    });

    it('pilha tem limite de altura', () => {
      const c = ctx([f('t', 'torre', 2, 0)]);
      expect(canPlace(c, { defId: 'torre', x: 2, y: 0, rot: 0 })).toMatchObject({
        reason: 'Alto demais para empilhar.',
      });
    });

    it('a base se move com o que está em cima (Fase 56); o de cima move à vontade', () => {
      const c = ctx([f('e', 'escrivaninha', 2, 0), { ...f('p', 'pc', 2, 0), z: 0.8 }]);
      expect(stackedOn(c.furni[0]!, c.furni, defs).map((x) => x.id)).toEqual(['p']);
      expect(canPlace(c, { defId: 'escrivaninha', x: 2, y: 3, rot: 0, ignoreId: 'e' })).toEqual({
        ok: true,
        z: 0,
      });
      expect(canPlace(c, { defId: 'pc', x: 3, y: 0, rot: 0, ignoreId: 'p' })).toEqual({
        ok: true,
        z: 0.8,
      });
      expect(canPlace(c, { defId: 'pc', x: 4, y: 3, rot: 0, ignoreId: 'p' })).toEqual({
        ok: true,
        z: 0,
      });
    });

    it('a pilha vai junto: muda de lugar e gira com a base (Fase 56)', () => {
      const c = ctx([
        f('e', 'escrivaninha', 2, 3),
        { ...f('p', 'pc', 3, 3), z: 0.8 },
        { ...f('cx', 'caixa', 2, 3), z: 0.8 },
        { ...f('top', 'pc', 2, 3), z: 1.8 },
      ]);
      const desk = c.furni[0]!;
      expect(
        stackGroup(desk, c.furni, defs)
          .map((g) => g.id)
          .sort(),
      ).toEqual(['cx', 'p', 'top']);
      // Andou dois tiles para a direita: tudo junto, nas mesmas alturas.
      expect(groupMoves(c, desk, { x: 4, y: 3, z: 0, rot: 0 })).toEqual([
        { ...c.furni[1], x: 5, y: 3 },
        { ...c.furni[2], x: 4, y: 3 },
        { ...c.furni[3], x: 4, y: 3 },
      ]);
      // Um quarto de volta (2×1 vira 1×2): o da ponta direita vai para a de baixo, e gira.
      const turn = groupMoves(c, desk, { x: 2, y: 3, z: 0, rot: 2 })!;
      expect(turn.find((g) => g.id === 'p')).toMatchObject({ x: 2, y: 4, rot: 2 });
      expect(turn.find((g) => g.id === 'cx')).toMatchObject({ x: 2, y: 3, rot: 2 });
      // Voltar o giro devolve tudo ao lugar.
      const turned = c.furni.map((f0) => ({ ...f0, ...turn.find((g) => g.id === f0.id) }));
      turned[0] = { ...desk, rot: 2 };
      expect(
        groupMoves({ ...c, furni: turned }, turned[0], { x: 2, y: 3, z: 0, rot: 0 })!.map(
          ({ id, x, y, rot }) => ({ id, x, y, rot }),
        ),
      ).toEqual(c.furni.slice(1).map(({ id, x, y, rot }) => ({ id, x, y, rot })));
      expect(canPlace(c, { defId: 'escrivaninha', x: 2, y: 3, rot: 2, ignoreId: 'e' }).ok).toBe(
        true,
      );
    });

    it('não gira se algo comprido em cima não couber girado', () => {
      const c = ctx([f('e', 'escrivaninha', 2, 3), { ...f('l', 'comprida', 2, 3), z: 0.8 }]);
      expect(
        canPlace(c, { defId: 'escrivaninha', x: 2, y: 3, rot: 2, ignoreId: 'e' }),
      ).toMatchObject({ reason: 'O que está em cima não cabe girado. Tire antes.' });
    });

    it('ninguém pode estar sentado na pilha que se move', () => {
      const c = ctx([f('e', 'escrivaninha', 2, 3), { ...f('ch', 'cadeira', 3, 3), z: 0.8 }], {
        avatars: [{ x: 3, y: 3 }],
      });
      expect(
        canPlace(c, { defId: 'escrivaninha', x: 2, y: 1, rot: 0, ignoreId: 'e' }),
      ).toMatchObject({ reason: 'Tem alguém sentado aí.' });
    });

    it('o que vai em cima não fica preso no próprio lugar (ao mover, não se apoia em si)', () => {
      const c = ctx([f('e', 'escrivaninha', 2, 0), { ...f('p', 'pc', 2, 0), z: 0.8 }]);
      expect(canPlace(c, { defId: 'pc', x: 2, y: 0, rot: 2, ignoreId: 'p' })).toEqual({
        ok: true,
        z: 0.8,
      });
    });
  });

  it('ao mover, o próprio móvel não atrapalha', () => {
    const c = ctx([f('m', 'mesa', 2, 0)]);
    expect(canPlace(c, { defId: 'mesa', x: 3, y: 0, rot: 0 }).ok).toBe(false);
    expect(canPlace(c, { defId: 'mesa', x: 3, y: 0, rot: 0, ignoreId: 'm' }).ok).toBe(true);
  });

  it('não move nem gira um assento com alguém sentado (Fase 53)', () => {
    const c = ctx([f('c', 'cadeira', 3, 1), f('t', 'tapete', 3, 3)], {
      avatars: [
        { x: 3, y: 1 },
        { x: 3, y: 3 },
      ],
    });
    expect(canPlace(c, { defId: 'cadeira', x: 3, y: 1, rot: 2, ignoreId: 'c' })).toMatchObject({
      reason: 'Tem alguém sentado aí.',
    });
    // Tapete com gente em cima move (quem está ali só pisa nele).
    expect(canPlace(c, { defId: 'tapete', x: 2, y: 3, rot: 0, ignoreId: 't' }).ok).toBe(true);
  });

  it('sólido não vai em cima de avatar; tapete vai', () => {
    const c = ctx([], { avatars: [{ x: 3, y: 1 }] });
    expect(canPlace(c, { defId: 'bloco', x: 3, y: 1, rot: 0 })).toMatchObject({
      reason: 'Tem alguém nesse lugar.',
    });
    expect(canPlace(c, { defId: 'tapete', x: 3, y: 0, rot: 0 }).ok).toBe(true);
  });

  it('não deixa bloquear o caminho até a porta', () => {
    // Mapa estreito: corredor de 1 tile entre a entrada e a porta do fundo.
    const narrow: PlacementContext = {
      map: parseHeightmap(['xx0x', '0000', 'x0xx', 'x0xx']),
      furni: [],
      defs,
      doors: [
        door,
        { x: 2, y: 0, targetRoomId: 'outra', targetX: 0, targetY: 0, targetDir: 4 },
      ].map((d, i) => (i === 0 ? { ...d, x: 0, y: 1 } : d)),
      spawn: { x: 1, y: 3 },
      avatars: [],
    };
    expect(canPlace(narrow, { defId: 'bloco', x: 1, y: 2, rot: 0 })).toMatchObject({
      ok: false,
      reason: 'Isso bloquearia o caminho até uma porta.',
    });
  });

  it(`limita a ${MAX_FURNI_PER_ROOM} móveis (mover ainda funciona)`, () => {
    const many = Array.from({ length: MAX_FURNI_PER_ROOM }, (_, i) => f(`t${i}`, 'tapete', 99, 99));
    expect(canPlace(ctx(many), { defId: 'bloco', x: 3, y: 1, rot: 0 }).ok).toBe(false);
    expect(canPlace(ctx(many), { defId: 'tapete', x: 3, y: 0, rot: 0, ignoreId: 't0' }).ok).toBe(
      true,
    );
  });
});

describe('surfaceTileAt (Fase 53)', () => {
  const desk = [f('e', 'escrivaninha', 3, 2)];
  // Ponto de tela no meio do tampo do tile (3,2), a 0,8 de altura.
  const top = tileToScreen(3, 2, 0.8);

  it('apontar para o tampo escolhe a mesa, não o piso atrás dela', () => {
    expect(surfaceTileAt(ctx(desk), top.sx, top.sy)).toEqual({ x: 3, y: 2, z: 0.8 });
    // Sem a mesa (ou arrastando a própria mesa), o mesmo ponto é o piso de trás.
    expect(surfaceTileAt(ctx(), top.sx, top.sy)).toEqual({ x: 2, y: 1, z: 0 });
    expect(surfaceTileAt(ctx(desk), top.sx, top.sy, 'e')).toEqual({ x: 2, y: 1, z: 0 });
  });

  it('na frente da mesa avisa que é a frente (o arrasto não sobe nela)', () => {
    const floor = tileToScreen(3, 2, 0);
    expect(surfaceTileAt(ctx(desk), floor.sx, floor.sy)).toEqual({
      x: 3,
      y: 2,
      z: 0.8,
      face: true,
    });
  });

  it('a frente de uma mesa alta esconde o piso de trás (o computador não pula para trás)', () => {
    // Logo abaixo do tampo do balcão (3,2): o losango do piso de trás (2,1) contém o ponto, mas ali
    // aparece a frente do balcão.
    const c = ctx([f('b', 'balcao', 3, 2)]);
    const behind = tileToScreen(2, 1, 0);
    const point = { sx: behind.sx, sy: behind.sy + 12 };
    expect(surfaceTileAt(c, point.sx, point.sy)).toEqual({ x: 3, y: 2, z: 1.2, face: true });
    // No tampo, sim: em cima do balcão.
    const top = tileToScreen(3, 2, 1.2);
    expect(surfaceTileAt(c, top.sx, top.sy)).toEqual({ x: 3, y: 2, z: 1.2 });
    // Longe do balcão, o piso de sempre.
    const floor = tileToScreen(1, 1, 0);
    expect(surfaceTileAt(c, floor.sx, floor.sy)).toEqual({ x: 1, y: 1, z: 0 });
  });

  it('longe da sala não escolhe nada', () => {
    expect(surfaceTileAt(ctx(), -2000, -2000)).toBeNull();
  });
});

describe('nearestSeatTile', () => {
  it('escolhe o lugar do sofá mais perto', () => {
    const sofa = f('s', 'sofa', 2, 3);
    expect(nearestSeatTile(defs.get('sofa')!, sofa, { x: 5, y: 3 })).toEqual({ x: 3, y: 3 });
    expect(nearestSeatTile(defs.get('sofa')!, sofa, { x: 0, y: 3 })).toEqual({ x: 2, y: 3 });
  });
});

describe('salas iniciais', () => {
  const manifest = parseFurniManifest(
    JSON.parse(
      readFileSync(
        new URL('../../client/public/assets/furni/manifest.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const real = new Map(manifest.items.map((i) => [i.id, i]));
  it.each(ROOMS.map((r) => [r.name, r] as const))(
    'cada móvel de %s é uma colocação válida',
    (_n, room) => {
      // Itens em cima de outro móvel (computador na mesa, z > 0) são colocados pela semente.
      const onFloor = room.furni.filter((f) => f.z === 0);
      for (const item of onFloor) {
        const res = canPlace(
          {
            map: parseHeightmap(room.heightmap),
            furni: onFloor,
            defs: real,
            doors: room.doors,
            spawn: room.spawn,
            avatars: [],
          },
          { defId: item.defId, x: item.x, y: item.y, rot: item.rot, ignoreId: item.id },
        );
        expect(res, `${room.id}/${item.id}`).toMatchObject({ ok: true });
      }
    },
  );

  it('o tampo dos móveis do escritório é a altura de empilhar do Habbo (Fase 56)', () => {
    const catalog = JSON.parse(
      readFileSync(
        new URL('../../client/public/assets/furni/catalog.json', import.meta.url),
        'utf8',
      ),
    ) as FurniCatalog;
    const habbo = new Map<string, number>();
    for (const item of catalog.items) {
      for (const id of [item.id, ...(item.colors ?? [])]) habbo.set(id, item.h);
    }
    const bases = manifest.items.filter((d) => acceptsOnTop(d) && habbo.has(d.sprite ?? d.id));
    expect(bases.length).toBeGreaterThan(15);
    for (const d of bases) expect(topHeight(d), d.id).toBeCloseTo(habbo.get(d.sprite ?? d.id)!, 2);
    // O computador antigo tem altura de empilhar 0 no Habbo: não serve de base.
    expect(acceptsOnTop(real.get('computer_old')!)).toBe(false);
  });
});

describe('itens de parede (Fase 36)', () => {
  const wallDefs = new Map<string, FurniDef>([
    ...defs,
    ['quadro', def({ id: 'quadro', height: 0, wall: true, directions: [2, 4] })],
  ]);
  const wctx = (furni: PlacedFurni[] = []) => ctx(furni, { defs: wallDefs });

  it('hasWall: parede onde o vizinho de trás não existe, nunca na abertura da porta', () => {
    const c = wctx();
    expect(hasWall(c, 3, 0, 2)).toBe(true); // fundo (y-1 fora)
    expect(hasWall(c, 3, 1, 2)).toBe(false);
    expect(hasWall(c, 1, 0, 4)).toBe(true); // lateral (x-1 = 'x')
    expect(hasWall(c, 1, 2, 4)).toBe(false); // ao lado da porta: é a abertura
    expect(hasWall(c, 0, 2, 4)).toBe(false); // a porta não tem parede
  });

  it('vai só na parede, com altura dentro dela, e não ocupa o piso', () => {
    expect(canPlace(wctx(), { defId: 'quadro', x: 3, y: 0, rot: 2, z: 1.5 })).toEqual({
      ok: true,
      z: 1.5,
    });
    expect(canPlace(wctx(), { defId: 'quadro', x: 3, y: 1, rot: 2, z: 1 }).ok).toBe(false);
    expect(canPlace(wctx(), { defId: 'quadro', x: 3, y: 0, rot: 0, z: 1 }).ok).toBe(false);
    expect(canPlace(wctx(), { defId: 'quadro', x: 3, y: 0, rot: 2, z: WALL_HEIGHT + 1 }).ok).toBe(
      false,
    );
    // Altura absoluta = piso + altura na parede (degrau de altura 1 em (5,4)).
    const step = ctx([], {
      defs: wallDefs,
      map: parseHeightmap(['x00011', 'x00011']),
    });
    expect(canPlace(step, { defId: 'quadro', x: 4, y: 0, rot: 2, z: 1 })).toEqual({
      ok: true,
      z: 2,
    });
    // Um bloco no mesmo tile não impede o quadro, e o quadro não impede o bloco.
    const withBlock = wctx([f('b', 'bloco', 3, 0)]);
    expect(canPlace(withBlock, { defId: 'quadro', x: 3, y: 0, rot: 2, z: 1 }).ok).toBe(true);
    const withPicture = wctx([{ ...f('q', 'quadro', 3, 0, 2), z: 1 }]);
    expect(canPlace(withPicture, { defId: 'bloco', x: 3, y: 0, rot: 0 }).ok).toBe(true);
  });
});

describe('ajuste fino de altura (Fase 56)', () => {
  const pile = () =>
    ctx([f('e', 'escrivaninha', 2, 3), { ...f('p', 'pc', 2, 3), z: 0.8 }, f('b', 'bloco', 4, 1)]);

  it('sobe em passos de 0,1 levando o que está em cima', () => {
    expect(canSetHeight(pile(), 'e', 0.43)).toEqual({
      ok: true,
      moves: [
        { ...pile().furni[0], z: 0.4 },
        { ...pile().furni[1], z: 1.2 },
      ],
    });
  });

  it('do piso até 6, com a pilha inteira dentro do limite', () => {
    expect(canSetHeight(pile(), 'b', -0.5)).toMatchObject({ reason: 'Já está no chão.' });
    expect(canSetHeight(pile(), 'b', 6)).toMatchObject({ ok: true });
    expect(canSetHeight(pile(), 'b', 6.2)).toMatchObject({ reason: 'Mais alto não dá (até 6).' });
    // A escrivaninha a 5,5 levaria o computador a 6,3.
    expect(canSetHeight(pile(), 'e', 5.5)).toMatchObject({ reason: 'Mais alto não dá (até 6).' });
  });

  it('não afunda no móvel de baixo; erguido, continua na pilha e vai junto com a base', () => {
    expect(canSetHeight(pile(), 'p', 0.5)).toMatchObject({
      reason: 'Está apoiado no móvel de baixo.',
    });
    const up = canSetHeight(pile(), 'p', 1.5);
    expect(up).toMatchObject({ ok: true, moves: [{ id: 'p', z: 1.5 }] });
    // Erguido acima do tampo, ainda é da pilha da escrivaninha.
    const raised = ctx([pile().furni[0]!, { ...pile().furni[1]!, z: 1.5 }]);
    expect(stackGroup(raised.furni[0]!, raised.furni, defs).map((g) => g.id)).toEqual(['p']);
    // E desce de volta até o tampo, não abaixo dele.
    expect(canSetHeight(raised, 'p', 0.8)).toMatchObject({ ok: true });
    // No piso elevado (altura 1), o chão é 1.
    const high = ctx([f('b', 'bloco', 4, 4)].map((b) => ({ ...b, z: 1 })));
    expect(canSetHeight(high, 'b', 0.5)).toMatchObject({ reason: 'Já está no chão.' });
    expect(canSetHeight(high, 'b', 7)).toMatchObject({ ok: true, moves: [{ z: 7 }] });
  });

  it('não mexe com alguém em cima nem em item de parede', () => {
    expect(
      canSetHeight(ctx([...pile().furni], { avatars: [{ x: 4, y: 1 }] }), 'b', 1),
    ).toMatchObject({
      reason: 'Tem alguém em cima.',
    });
    expect(canSetHeight(pile(), 'nao-existe', 1)).toMatchObject({ ok: false });
  });
});
