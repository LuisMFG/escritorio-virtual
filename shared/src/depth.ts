import type { Footprint } from './furni.js';

/**
 * Caixa de um objeto na grade usada para ordenar a profundidade.
 * Avatar parado = o próprio tile; avatar andando = união do tile atual e do próximo;
 * móvel = footprint na rotação atual.
 */
export interface DepthBox extends Footprint {
  id: string;
  /** Altura da base (piso, pilha, assento). */
  z: number;
  /** Altura do topo (base + altura do móvel): a faixa de altura que o objeto ocupa (Fase 56). */
  top?: number;
  /** Objetos rasteiros (tapetes) usam -1 para ficar sempre por baixo de quem pisa neles. */
  layer?: number;
}

/**
 * Relação de desenho entre duas caixas:
 * -1 = `a` fica atrás de `b` (desenhar antes), 1 = `a` fica na frente, 0 = sem restrição
 * (não se sobrepõem na tela de forma relevante).
 */
export function compareDepth(a: DepthBox, b: DepthBox): -1 | 0 | 1 {
  const xSepAB = a.maxX < b.minX; // a está inteiro antes de b no eixo x
  const xSepBA = b.maxX < a.minX;
  const ySepAB = a.maxY < b.minY;
  const ySepBA = b.maxY < a.minY;
  const xOverlap = !xSepAB && !xSepBA;
  const yOverlap = !ySepAB && !ySepBA;

  // Separados num eixo e sobrepostos no outro: a ordem é clara.
  if (yOverlap && xSepAB) return -1;
  if (yOverlap && xSepBA) return 1;
  if (xOverlap && ySepAB) return -1;
  if (xOverlap && ySepBA) return 1;

  // Separados nos dois eixos no mesmo sentido: um está na diagonal de trás do outro.
  if (xSepAB && ySepAB) return -1;
  if (xSepBA && ySepBA) return 1;

  // Ocupam tiles em comum (tapete + avatar, avatar sentado na cadeira, a pilha).
  if (xOverlap && yOverlap) {
    const la = a.layer ?? 0;
    const lb = b.layer ?? 0;
    if (la !== lb) return la < lb ? -1 : 1;
    // Um acima da faixa do outro (a pilha, mesmo com a altura ajustada): o de cima na frente.
    if (a.top !== undefined && b.z >= a.top - 0.01) return -1;
    if (b.top !== undefined && a.z >= b.top - 0.01) return 1;
    if (a.z !== b.z) return a.z < b.z ? -1 : 1;
    return 0;
  }

  // Separados em diagonais opostas (um à esquerda, outro à direita): lado a lado na tela.
  return 0;
}

/** Soma usada para desempate: quanto maior, mais "na frente" na tela. */
function frontness(b: DepthBox): number {
  return b.minX + b.maxX + b.minY + b.maxY + (b.layer ?? 0) * 1000 + b.z * 0.01;
}

/**
 * Ordena as caixas de trás para frente (sort topológico das relações de `compareDepth`).
 * Entre objetos sem restrição, desempata pela posição na tela. Ciclos (não deveriam
 * acontecer com footprints que não se sobrepõem) são quebrados pelo mesmo critério.
 * O(n²): só deve rodar quando algo muda, não a cada frame.
 */
export function depthOrder(boxes: readonly DepthBox[]): string[] {
  const n = boxes.length;
  const behindCount = new Array<number>(n).fill(0);
  const inFrontOf: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = compareDepth(boxes[i]!, boxes[j]!);
      if (c < 0) {
        inFrontOf[i]!.push(j);
        behindCount[j]!++;
      } else if (c > 0) {
        inFrontOf[j]!.push(i);
        behindCount[i]!++;
      }
    }
  }

  const done = new Array<boolean>(n).fill(false);
  const result: string[] = [];
  for (let k = 0; k < n; k++) {
    let pick = -1;
    let pickCycle = -1;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      if (behindCount[i] === 0) {
        if (pick < 0 || frontness(boxes[i]!) < frontness(boxes[pick]!)) pick = i;
      } else if (pickCycle < 0 || frontness(boxes[i]!) < frontness(boxes[pickCycle]!)) {
        pickCycle = i;
      }
    }
    if (pick < 0) pick = pickCycle;
    done[pick] = true;
    result.push(boxes[pick]!.id);
    for (const j of inFrontOf[pick]!) behindCount[j]!--;
  }
  return result;
}
