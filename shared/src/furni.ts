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
  /** Altura do tampo, quando diferente de `height` (onde se apoia o que vai em cima). */
  stackHeight?: number;
  /**
   * Tampo explícito da curadoria. Sem ele vale a regra geral (Fase 56): todo móvel sólido com
   * altura aceita coisas em cima; `false` tira (luminárias, cortinas…).
   */
  hasTop?: boolean;
  /** Luminária (acesa, brilha): não serve de base. */
  light?: boolean;
  /** Comportamento especial (os quadros e o tabuleiro não aceitam nada em cima). */
  interaction?: string;
  canSit: boolean;
  /** Camas e afins: deita (Fase 33). */
  canLay?: boolean;
  /** Vai na parede (quadros, janelas…): não ocupa o piso (Fase 36). */
  wall?: boolean;
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
  /** Estado do móvel (luz acesa, TV ligada…); 0 = padrão. */
  state?: number;
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
