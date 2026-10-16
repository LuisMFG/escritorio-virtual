/** Largura de um tile isométrico em pixels (padrão Habbo). */
export const TILE_W = 64;
/** Altura de um tile isométrico em pixels. */
export const TILE_H = 32;
/** Pixels de tela por unidade de altura (pilha de móveis / degraus). */
export const Z_UNIT = 32;

/** Duração de um passo de tile para tile, em ms (2 tiles/s, diagonal igual — estilo Habbo). */
export const STEP_MS = 500;
/** Diferença máxima de altura que um avatar consegue subir/descer num passo. */
export const MAX_STEP_HEIGHT = 1.5;
/** Limite de nós expandidos pelo A* antes de desistir. */
export const MAX_PATH_NODES = 4000;

/** Hotel usado na HabboAssets API (2 = Habbo Brasil). */
export const HABBO_HOTEL_ID = 2;
