import { z } from 'zod';
import { layFacing, sitFacing } from './figureRender.js';
import { footprint, type FurniDef, type PlacedFurni } from './furni.js';
import type { TilePoint } from './iso.js';
import { nameKey } from './protocol.js';

/**
 * Sentar e deitar (Fase 33): em cadeiras, sofás e camas, e no chão com `/sentar` e `/deitar`.
 * As poses do Habbo só existem em algumas direções: sentado em 0/2 (e 4/6 espelhadas) e
 * deitado em 2 (e 4 espelhada).
 */

export const POSTURES = ['sit', 'lay', 'stand'] as const;
export type Posture = (typeof POSTURES)[number];

/** `{ posture }`: sentar ou deitar no chão onde está, ou levantar. */
export const postureSchema = z.object({ posture: z.enum(POSTURES) });
/** `{ dir }`: virar sem sair do lugar (parado ou sentado no chão). */
export const turnSchema = z.object({ dir: z.number().int().min(0).max(7) });

const COMMANDS: Record<string, Posture> = { sentar: 'sit', deitar: 'lay', levantar: 'stand' };

/** `/sentar`, `/deitar`, `/levantar` (sem diferenciar maiúsculas e acentos). */
export function parsePostureCommand(text: string): Posture | null {
  const m = /^\s*\/(\S+)\s*$/.exec(text);
  return m ? (COMMANDS[nameKey(m[1]!)] ?? null) : null;
}

/** Sentado só existe nas direções pares: arredonda para a anterior. */
export function sitDirection(dir: number): number {
  return sitFacing(dir);
}

/** Deitado só de lado: virado para a direita (2) ou, espelhado, para a esquerda (4). */
export function layDirection(dir: number): number {
  return layFacing(dir);
}

/** Na cama, deita no sentido do comprimento, com a cabeça na cabeceira. */
export function bedDirection(rot: number): number {
  return rot % 4 === 0 ? 4 : 2;
}

/**
 * Lugares de um assento: cada tile de cadeiras e sofás; na cama, só a fileira da cabeceira
 * (a cama de casal tem dois lugares).
 */
export function seatTiles(
  def: Pick<FurniDef, 'width' | 'depth' | 'canSit'> & { canLay?: boolean },
  f: Pick<PlacedFurni, 'x' | 'y' | 'rot'>,
): TilePoint[] {
  const fp = footprint(def, f.x, f.y, f.rot);
  const tiles: TilePoint[] = [];
  for (let y = fp.minY; y <= fp.maxY; y++) {
    for (let x = fp.minX; x <= fp.maxX; x++) {
      // Cama no eixo y (rot 0): cabeceira em minY; no eixo x (rot 2): em minX.
      if (def.canLay && (f.rot % 4 === 0 ? y !== fp.minY : x !== fp.minX)) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** O lugar livre mais perto de quem vai sentar (ou `null` se estão todos ocupados). */
export function nearestFreeSeat(
  tiles: readonly TilePoint[],
  from: TilePoint,
  taken: (t: TilePoint) => boolean,
): TilePoint | null {
  let best: TilePoint | null = null;
  let bestDist = Infinity;
  for (const t of tiles) {
    if (taken(t)) continue;
    const d = Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y));
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}
