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

/** Móvel da semente (`id` legível; `z` padrão 0). */
const f = (id: string, defId: string, x: number, y: number, rot = 0, z = 0): PlacedFurni => ({
  id,
  defId,
  x,
  y,
  z,
  rot,
});

/** Altura do tampo da mesa de trabalho (`uni_desk`): o computador fica em cima. */
const DESK_TOP = 1.1;

/**
 * Uma estação de trabalho: mesa 2×1 ao longo de x, cadeira giratória do lado `side` (+1 = em
 * y+1, de frente para a mesa olhando para -y; -1 = em y-1, olhando para +y) e o computador em
 * cima da mesa virado para a cadeira.
 */
function station(id: string, x: number, y: number, side: 1 | -1): PlacedFurni[] {
  return [
    f(`${id}-mesa`, 'uni_desk', x, y, side === 1 ? 0 : 4),
    f(`${id}-cadeira`, 'army_c15_chair', x, y + side, side === 1 ? 0 : 4),
    f(`${id}-pc`, 'computer_flatscreen', x, y, side === 1 ? 4 : 0, DESK_TOP),
  ];
}

/**
 * Bancada costas com costas: `n` mesas de cada lado de uma divisória de vidro, cadeiras por
 * fora (como na planta do escritório: cada pessoa vira para a sua mesa).
 */
function bench(id: string, x: number, y: number, n: number): PlacedFurni[] {
  const out: PlacedFurni[] = [];
  for (let i = 0; i < n; i++) {
    const dx = x + i * 2;
    out.push(...station(`${id}-n${i + 1}`, dx, y, -1));
    out.push(f(`${id}-div${i + 1}`, 'exe_glassdvdr', dx, y + 1, 0));
    out.push(...station(`${id}-s${i + 1}`, dx, y + 2, 1));
  }
  return out;
}

/**
 * Recepção = o escritório de verdade (planta enviada em 19/10/2026): uma fileira de 4 mesas
 * de frente para a parede do fundo, uma bancada de 10 (5 de cada lado, costas com costas, com
 * divisória) e uma segunda bancada igual completando o open space. À direita, a área de
 * convivência: café, Quadro de Demandas, mural, Quadro de Elogios, lounge e jogo da velha.
 * Cores da foto: piso de granito cinza claro, paredes claras.
 */
export const RECEPTION: RoomDefinition = {
  id: 'reception',
  name: 'Recepção',
  heightmap: [
    'xxxxxxxxxxxxxxxxxxxxx0x', // porta para a Copa, na parede do fundo (perto do café)
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    '00000000000000000000000', // porta para a Sala de reunião, na parede esquerda
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
    'x0000000000000000000000',
  ],
  spawn: { x: 1, y: 4, dir: 2 },
  doors: [
    { x: 0, y: 4, targetRoomId: 'meeting', targetX: 1, targetY: 4, targetDir: 2 },
    { x: 21, y: 0, targetRoomId: 'pantry', targetX: 1, targetY: 3, targetDir: 2 },
  ],
  floorColor: '#b3b2ab',
  wallColor: '#d9dddc',
  furni: [
    // ---------- Área de trabalho (planta) ----------
    // Fileira de 4 mesas de frente para a parede do fundo.
    ...[4, 6, 8, 10].flatMap((x, i) => station(`r-fila-${i + 1}`, x, 2, 1)),
    // Bancada de 10: 5 de cada lado (as duas da ponta esquerda são as novas).
    ...bench('r-bancada', 2, 6, 5),
    // Segunda bancada, completando o open space como na foto.
    ...bench('r-bancada2', 2, 12, 5),
    // Arquivos e impressora no fim da fileira, plantas nos cantos.
    f('r-arquivo-1', 'army_c15_cabinet', 12, 1, 4),
    f('r-arquivo-2', 'army_c15_cabinet', 13, 1, 4),
    f('r-impressora', 'exe_c15_printer', 13, 3, 0),
    f('r-planta-1', 'plant_yukka', 1, 1),
    f('r-planta-2', 'plant_yukka', 13, 9),
    f('r-planta-3', 'plant_yukka', 13, 15),
    f('r-planta-4', 'plant_yukka', 1, 19),

    // ---------- Convivência ----------
    // Café, perto da porta da Copa.
    f('r-cafe', 'sunsetcafe_c20_coffeemachine', 16, 1, 2),
    f('r-geladeira', 'fridge', 17, 1, 4),
    f('r-mural', 'noticeboard', 18, 1, 0),
    f('r-planta-5', 'plant_big_cactus', 22, 1),
    f('r-mesa-cafe', 'table_norja_med', 17, 4, 0),
    f('r-cafe-c1', 'chair_silo', 17, 3, 4),
    f('r-cafe-c2', 'chair_silo', 18, 3, 4),
    f('r-cafe-c3', 'chair_silo', 17, 6, 0),
    f('r-cafe-c4', 'chair_silo', 18, 6, 0),
    // Quadros: demandas (Jira) e elogios.
    f('r-jira', 'jira_board', 22, 4, 6),
    // Quadro de Elogios (Fase 26). Longe das portas: alto, ele cobriria o clique numa porta atrás.
    f('r-kudos', 'easel_0', 22, 7, 6),
    // Lounge: tapete, sofá de três lugares e sofá de dois.
    f('r-tapete', 'carpet_standard', 17, 9, 0),
    f('r-couch', 'exe_sofa', 17, 8, 4),
    f('r-sofa', 'sofa_silo', 20, 10, 6),
    f('r-planta-6', 'plant_yukka', 16, 8),
    // Jogo da velha: duas mesas com cadeiras de cada lado.
    f('r-jogo-1', 'table_plasto_round', 17, 16, 0),
    f('r-jogo-1a', 'chair_plasto', 16, 16, 2),
    f('r-jogo-1b', 'chair_plasto', 18, 16, 6),
    f('r-jogo-2', 'table_plasto_round', 20, 16, 0),
    f('r-jogo-2a', 'chair_plasto', 19, 16, 2),
    f('r-jogo-2b', 'chair_plasto', 21, 16, 6),
    // Quadro branco para rabiscar ideias.
    f('r-quadro', 'uni_c23_whiteboard', 22, 12, 6),
  ],
};

/** Versão do layout da Recepção: muda quando a semente acima muda e o banco precisa receber. */
export const RECEPTION_LAYOUT = 'escritorio-2';

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
    // Quadro de Demandas do Jira (Fase 30).
    { id: 'm-jira', defId: 'jira_board', x: 10, y: 6, z: 0, rot: 6 },
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
    // Mesa de jogos (jogo da velha) com duas cadeiras, uma de cada lado.
    { id: 'p-games', defId: 'table_plasto_round', x: 6, y: 2, z: 0, rot: 0 },
    { id: 'p-games-w', defId: 'chair_plasto', x: 5, y: 2, z: 0, rot: 2 },
    { id: 'p-games-e', defId: 'chair_plasto', x: 7, y: 2, z: 0, rot: 6 },
  ],
};

export const ROOMS: readonly RoomDefinition[] = [RECEPTION, MEETING, PANTRY];

export function findRoom(id: string): RoomDefinition | undefined {
  return ROOMS.find((r) => r.id === id);
}
