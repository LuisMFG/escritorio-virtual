/** Definição de um móvel do catálogo (espelha `furni/manifest.json` e a tabela `furni_catalog`). */
export interface FurniDef {
  /** Classname do Habbo (ex.: `chair_norja`) ou id local. */
  id: string;
  name: string;
  category: string;
  /** Tamanho no eixo x da grade quando rot = 0. */
  width: number;
  /** Tamanho no eixo y da grade quando rot = 0. */
  depth: number;
  /** Altura de empilhamento, em unidades de altura. */
  height: number;
  canSit: boolean;
  /** Tapetes e afins: dá para andar por cima. */
  canWalk: boolean;
  sitHeight: number;
  /** Direções que o render suporta (0, 2, 4, 6). */
  directions: number[];
}

/** Móvel posicionado numa sala. */
export interface PlacedFurni {
  id: string;
  defId: string;
  x: number;
  y: number;
  z: number;
  rot: number;
}

export interface Footprint {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Largura (x) e profundidade (y) ocupadas pelo móvel em uma rotação. Rotações 2 e 6 trocam os eixos. */
export function footprintSize(
  def: Pick<FurniDef, 'width' | 'depth'>,
  rot: number,
): { w: number; d: number } {
  return rot % 4 === 0 ? { w: def.width, d: def.depth } : { w: def.depth, d: def.width };
}

export function footprint(
  def: Pick<FurniDef, 'width' | 'depth'>,
  x: number,
  y: number,
  rot: number,
): Footprint {
  const { w, d } = footprintSize(def, rot);
  return { minX: x, minY: y, maxX: x + w - 1, maxY: y + d - 1 };
}
