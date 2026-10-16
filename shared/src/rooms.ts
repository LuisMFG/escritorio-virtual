import type { PlacedFurni } from './furni.js';
import type { TilePoint } from './iso.js';

export interface RoomDoor extends TilePoint {
  /** Sala de destino (ativado na Fase 5). */
  targetRoomId: string | null;
}

export interface RoomDefinition {
  id: string;
  name: string;
  /** Heightmap no formato Habbo (ver `parseHeightmap`). */
  heightmap: string[];
  spawn: TilePoint & { dir: number };
  doors: RoomDoor[];
  floorColor: string;
  wallColor: string;
  /** Móveis iniciais (seed). A partir da Fase 6 o layout vem do banco. */
  furni: PlacedFurni[];
}

export const RECEPTION: RoomDefinition = {
  id: 'reception',
  name: 'Recepção',
  heightmap: [
    'x000000000000',
    'x000000000000',
    'x000000000000',
    'x000000000000',
    '0000000000000',
    'x000000000000',
    'x000000000000',
    'x000000000000',
    'x000000000000',
    'x000000000000',
  ],
  spawn: { x: 1, y: 4, dir: 2 },
  doors: [{ x: 0, y: 4, targetRoomId: null }],
  floorColor: '#b8b09a',
  wallColor: '#a7b4c2',
  furni: [],
};

export const ROOMS: readonly RoomDefinition[] = [RECEPTION];
