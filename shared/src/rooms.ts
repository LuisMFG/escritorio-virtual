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
  furni: [
    { id: 'r-carpet', defId: 'carpet_standard', x: 5, y: 3, z: 0, rot: 0 },
    { id: 'r-table', defId: 'table_norja_med', x: 8, y: 1, z: 0, rot: 0 },
    { id: 'r-chair-1', defId: 'chair_norja', x: 7, y: 1, z: 0, rot: 2 },
    { id: 'r-chair-2', defId: 'chair_norja', x: 10, y: 2, z: 0, rot: 6 },
    { id: 'r-couch', defId: 'couch_norja', x: 1, y: 7, z: 0, rot: 2 },
    { id: 'r-shelves', defId: 'shelves_norja', x: 1, y: 1, z: 0, rot: 2 },
    { id: 'r-cactus-1', defId: 'plant_big_cactus', x: 1, y: 0, z: 0, rot: 0 },
    { id: 'r-cactus-2', defId: 'plant_big_cactus', x: 12, y: 0, z: 0, rot: 0 },
  ],
};

export const ROOMS: readonly RoomDefinition[] = [RECEPTION];
