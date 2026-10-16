import { TILE_H, TILE_W, Z_UNIT } from './constants.js';

export interface TilePoint {
  x: number;
  y: number;
}

export interface ScreenPoint {
  sx: number;
  sy: number;
}

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

/**
 * Converte coordenadas de grade para tela. Devolve o **centro** do losango do tile.
 * Eixo x da grade cresce para baixo-direita na tela; eixo y para baixo-esquerda.
 * Aceita valores fracionários (posições interpoladas durante a caminhada).
 */
export function tileToScreen(x: number, y: number, z = 0): ScreenPoint {
  return {
    sx: (x - y) * HALF_W,
    sy: (x + y) * HALF_H - z * Z_UNIT,
  };
}

/** Inverso exato de `tileToScreen` (com z = 0), sem arredondar. */
export function screenToTileFloat(sx: number, sy: number): TilePoint {
  const a = sy / HALF_H;
  const b = sx / HALF_W;
  return { x: (a + b) / 2, y: (a - b) / 2 };
}

/** Tile (inteiro) cujo losango contém o ponto de tela, assumindo piso na altura 0. */
export function screenToTile(sx: number, sy: number): TilePoint {
  const f = screenToTileFloat(sx, sy);
  // +0 normaliza -0 para 0
  return { x: Math.round(f.x) + 0, y: Math.round(f.y) + 0 };
}

/** Vértices do losango do tile, em ordem: topo, direita, baixo, esquerda. */
export function tileCorners(
  x: number,
  y: number,
  z = 0,
): [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] {
  const c = tileToScreen(x, y, z);
  return [
    { sx: c.sx, sy: c.sy - HALF_H },
    { sx: c.sx + HALF_W, sy: c.sy },
    { sx: c.sx, sy: c.sy + HALF_H },
    { sx: c.sx - HALF_W, sy: c.sy },
  ];
}

/** Ponto dentro do losango do tile (bordas inclusas)? */
export function pointInTile(sx: number, sy: number, x: number, y: number, z = 0): boolean {
  const c = tileToScreen(x, y, z);
  return Math.abs(sx - c.sx) / HALF_W + Math.abs(sy - c.sy) / HALF_H <= 1;
}

/**
 * Direções no padrão Habbo (0–7), indexadas por deslocamento na grade:
 * 0 = (0,-1), 1 = (1,-1), 2 = (1,0), 3 = (1,1), 4 = (0,1), 5 = (-1,1), 6 = (-1,0), 7 = (-1,-1).
 * A direção 2 é "de frente, olhando para baixo-direita", que é o padrão do imager.
 */
export const DIRECTION_OFFSETS: readonly TilePoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/** Direção Habbo (0–7) de `from` para `to`. Devolve `fallback` se forem o mesmo tile. */
export function directionBetween(from: TilePoint, to: TilePoint, fallback = 2): number {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return fallback;
  return DIRECTION_OFFSETS.findIndex((d) => d.x === dx && d.y === dy);
}
