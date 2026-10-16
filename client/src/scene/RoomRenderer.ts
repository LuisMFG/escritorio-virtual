import { tileCorners, tileHeight, type Heightmap, type RoomDefinition } from '@office/shared';
import { Graphics } from 'pixi.js';
import { hexToNumber, shade } from '../assets/colors.js';

/** Altura das paredes e da porta, em pixels. */
const WALL_PX = 116;
const DOOR_PX = 86;
/** Espessura do piso (borda frontal) e do topo das paredes. */
const FLOOR_THICKNESS = 8;
const WALL_THICKNESS = 8;

type Pt = [number, number];

/**
 * Desenha chão em losangos e paredes nos dois lados de trás (estilo quarto do Habbo),
 * tudo por código — não depende de nenhum asset externo.
 * Paredes ficam nas arestas de trás de tiles cujo vizinho em -x ou -y não existe.
 */
export function drawRoom(map: Heightmap, room: RoomDefinition): Graphics {
  const g = new Graphics();
  g.label = 'room';
  const floor = hexToNumber(room.floorColor);
  const wall = hexToNumber(room.wallColor);
  const isDoor = (x: number, y: number) => room.doors.some((d) => d.x === x && d.y === y);
  const exists = (x: number, y: number) => tileHeight(map, x, y) !== null;
  /** Para efeito de paredes, a porta conta como "fora" da sala. */
  const solid = (x: number, y: number) => exists(x, y) && !isDoor(x, y);

  // 1) Paredes (atrás de tudo). Esquerda: aresta noroeste; direita: aresta nordeste.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!solid(x, y)) continue;
      const z = tileHeight(map, x, y)!;
      const [top, right, , left] = tileCorners(x, y, z).map((c) => [c.sx, c.sy] as Pt) as [
        Pt,
        Pt,
        Pt,
        Pt,
      ];
      if (!solid(x - 1, y)) {
        const door = isDoor(x - 1, y);
        wallSegment(g, left, top, [-WALL_THICKNESS, -WALL_THICKNESS / 2], shade(wall, 1.0), door);
      }
      if (!solid(x, y - 1)) {
        wallSegment(
          g,
          top,
          right,
          [WALL_THICKNESS, -WALL_THICKNESS / 2],
          shade(wall, 0.82),
          isDoor(x, y - 1),
        );
      }
    }
  }

  // 2) Piso, com borda frontal onde a sala termina.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const z = tileHeight(map, x, y);
      if (z === null) continue;
      const [top, right, bottom, left] = tileCorners(x, y, z).map((c) => [c.sx, c.sy] as Pt) as [
        Pt,
        Pt,
        Pt,
        Pt,
      ];
      const color = isDoor(x, y) ? shade(floor, 0.55) : floor;
      if (!exists(x + 1, y)) quad(g, right, bottom, FLOOR_THICKNESS, shade(floor, 0.62));
      if (!exists(x, y + 1)) quad(g, bottom, left, FLOOR_THICKNESS, shade(floor, 0.75));
      g.poly([...top, ...right, ...bottom, ...left]).fill(color);
      g.poly([...top, ...right, ...bottom, ...left], true).stroke({
        width: 1,
        color: shade(floor, 0.88),
      });
    }
  }
  return g;
}

/**
 * Segmento de parede sobre a aresta a→b, com topo de espessura `outward`.
 * Se `door`, desenha a abertura escura da porta com a verga por cima.
 */
function wallSegment(g: Graphics, a: Pt, b: Pt, outward: Pt, color: number, door: boolean): void {
  const up = (p: Pt, h: number): Pt => [p[0], p[1] - h];
  if (door) {
    g.poly([...a, ...b, ...up(b, DOOR_PX), ...up(a, DOOR_PX)]).fill(0x121318);
    g.poly([...up(a, DOOR_PX), ...up(b, DOOR_PX), ...up(b, WALL_PX), ...up(a, WALL_PX)]).fill(
      color,
    );
  } else {
    g.poly([...a, ...b, ...up(b, WALL_PX), ...up(a, WALL_PX)]).fill(color);
    // Rodapé.
    g.poly([...a, ...b, ...up(b, 4), ...up(a, 4)]).fill(shade(color, 0.8));
  }
  const ta = up(a, WALL_PX);
  const tb = up(b, WALL_PX);
  const out = (p: Pt): Pt => [p[0] + outward[0], p[1] + outward[1]];
  g.poly([...ta, ...tb, ...out(tb), ...out(ta)]).fill(shade(color, 1.18));
}

/** Face vertical abaixo da aresta a→b (espessura do piso). */
function quad(g: Graphics, a: Pt, b: Pt, h: number, color: number): void {
  g.poly([...a, ...b, b[0], b[1] + h, a[0], a[1] + h]).fill(color);
}
