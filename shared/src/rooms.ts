import type { PlacedFurni } from './furni.js';
import type { TilePoint } from './iso.js';

/**
 * Porta: um tile do heightmap "para fora" da parede (linha 0 ou coluna 0). Pisar nele leva
 * para outra sala, nascendo em `target*` (o tile logo dentro da porta correspondente do outro
 * lado). Desde a Fase 13 o servidor calcula `target*` a partir das portas da outra sala.
 */
export interface RoomDoor extends TilePoint {
  targetRoomId: string;
  targetX: number;
  targetY: number;
  targetDir: number;
  /** Nome da sala de destino (preenchido pelo servidor no layout). */
  targetName?: string;
}

export interface RoomDefinition {
  id: string;
  name: string;
  /** Heightmap no formato Habbo (ver `parseHeightmap`). Portas são tiles fora das paredes. */
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
    'xxxxxxxxx0xxx', // porta para a Copa, na parede do fundo
    'x000000000000',
    'x000000000000',
    'x000000000000',
    'x000000000000',
    '0000000000000', // porta para a Sala de reunião, na parede esquerda
    'x000000000000',
    'x000000000000',
    'x000000000000',
    'x000000000000',
    'x000000000000',
  ],
  spawn: { x: 1, y: 5, dir: 2 },
  doors: [
    { x: 0, y: 5, targetRoomId: 'meeting', targetX: 1, targetY: 4, targetDir: 2 },
    { x: 9, y: 0, targetRoomId: 'pantry', targetX: 1, targetY: 3, targetDir: 2 },
  ],
  floorColor: '#b8b09a',
  wallColor: '#a7b4c2',
  furni: [
    { id: 'r-carpet', defId: 'carpet_standard', x: 5, y: 4, z: 0, rot: 0 },
    { id: 'r-table', defId: 'table_norja_med', x: 8, y: 2, z: 0, rot: 0 },
    { id: 'r-chair-1', defId: 'chair_norja', x: 7, y: 2, z: 0, rot: 2 },
    { id: 'r-chair-2', defId: 'chair_norja', x: 10, y: 3, z: 0, rot: 6 },
    { id: 'r-couch', defId: 'couch_norja', x: 1, y: 8, z: 0, rot: 2 },
    { id: 'r-shelves', defId: 'shelves_norja', x: 1, y: 2, z: 0, rot: 2 },
    { id: 'r-cactus-1', defId: 'plant_big_cactus', x: 1, y: 1, z: 0, rot: 0 },
    { id: 'r-cactus-2', defId: 'plant_big_cactus', x: 12, y: 1, z: 0, rot: 0 },
  ],
};

export const MEETING: RoomDefinition = {
  id: 'meeting',
  name: 'Sala de reunião',
  heightmap: [
    'xxxxxxxxxxx', // linha 0: só portas
    'x0000000000',
    'x0000000000',
    'x0000000000',
    '00000000000', // porta para a Recepção
    'x0000000000',
    'x0000000000',
    'x0000000000',
    'x0000000000',
  ],
  spawn: { x: 1, y: 4, dir: 2 },
  doors: [{ x: 0, y: 4, targetRoomId: 'reception', targetX: 1, targetY: 5, targetDir: 2 }],
  floorColor: '#a9b8ae',
  wallColor: '#cdbf9f',
  furni: [
    // Mesa de reunião 4×2 (duas mesas lado a lado) com cadeiras em volta.
    { id: 'm-table-1', defId: 'table_norja_med', x: 4, y: 3, z: 0, rot: 0 },
    { id: 'm-table-2', defId: 'table_norja_med', x: 6, y: 3, z: 0, rot: 0 },
    { id: 'm-chair-n1', defId: 'chair_norja', x: 4, y: 2, z: 0, rot: 4 },
    { id: 'm-chair-n2', defId: 'chair_norja', x: 5, y: 2, z: 0, rot: 4 },
    { id: 'm-chair-n3', defId: 'chair_norja', x: 6, y: 2, z: 0, rot: 4 },
    { id: 'm-chair-n4', defId: 'chair_norja', x: 7, y: 2, z: 0, rot: 4 },
    { id: 'm-chair-s1', defId: 'chair_norja', x: 4, y: 5, z: 0, rot: 0 },
    { id: 'm-chair-s2', defId: 'chair_norja', x: 5, y: 5, z: 0, rot: 0 },
    { id: 'm-chair-s3', defId: 'chair_norja', x: 6, y: 5, z: 0, rot: 0 },
    { id: 'm-chair-s4', defId: 'chair_norja', x: 7, y: 5, z: 0, rot: 0 },
    { id: 'm-chair-w', defId: 'chair_norja', x: 3, y: 3, z: 0, rot: 2 },
    { id: 'm-chair-e', defId: 'chair_norja', x: 8, y: 4, z: 0, rot: 6 },
    { id: 'm-whiteboard', defId: 'uni_c23_whiteboard', x: 10, y: 3, z: 0, rot: 6 },
    { id: 'm-shelves', defId: 'shelves_norja', x: 1, y: 1, z: 0, rot: 2 },
    { id: 'm-cactus-1', defId: 'plant_big_cactus', x: 10, y: 1, z: 0, rot: 0 },
    { id: 'm-cactus-2', defId: 'plant_big_cactus', x: 1, y: 8, z: 0, rot: 0 },
  ],
};

export const PANTRY: RoomDefinition = {
  id: 'pantry',
  name: 'Copa',
  heightmap: [
    'xxxxxxxxx', // linha 0: só portas
    'x00000000',
    'x00000000',
    '000000000', // porta para a Recepção
    'x00000000',
    'x00000000',
    'x00000000',
    'x00000000',
  ],
  spawn: { x: 1, y: 3, dir: 2 },
  doors: [{ x: 0, y: 3, targetRoomId: 'reception', targetX: 9, targetY: 1, targetDir: 4 }],
  floorColor: '#cdbb94',
  wallColor: '#b9cdb2',
  furni: [
    { id: 'p-coffee', defId: 'sunsetcafe_c20_coffeemachine', x: 3, y: 1, z: 0, rot: 2 },
    { id: 'p-table', defId: 'table_norja_med', x: 4, y: 4, z: 0, rot: 0 },
    { id: 'p-chair-w', defId: 'chair_norja', x: 3, y: 4, z: 0, rot: 2 },
    { id: 'p-chair-e', defId: 'chair_norja', x: 6, y: 5, z: 0, rot: 6 },
    { id: 'p-chair-n', defId: 'chair_norja', x: 5, y: 3, z: 0, rot: 4 },
    { id: 'p-chair-s', defId: 'chair_norja', x: 4, y: 6, z: 0, rot: 0 },
    { id: 'p-couch', defId: 'couch_norja', x: 1, y: 6, z: 0, rot: 2 },
    { id: 'p-cactus', defId: 'plant_big_cactus', x: 8, y: 1, z: 0, rot: 0 },
  ],
};

export const ROOMS: readonly RoomDefinition[] = [RECEPTION, MEETING, PANTRY];

export function findRoom(id: string): RoomDefinition | undefined {
  return ROOMS.find((r) => r.id === id);
}
