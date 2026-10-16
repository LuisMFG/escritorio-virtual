/** Uma peça da figure string do Habbo: `tipo-set-cor[-cor2]`, ex. `hr-115-45`. */
export interface FigurePart {
  type: string;
  setId: number;
  colors: number[];
}

/**
 * Lê uma figure string (`hd-180-1.ch-210-66.lg-270-82`). Peças malformadas são ignoradas
 * aqui; a validação rigorosa contra o manifesto entra na Fase 3.
 */
export function parseFigure(figure: string): FigurePart[] {
  const parts: FigurePart[] = [];
  for (const raw of figure.split('.')) {
    const [type, set, ...colors] = raw.split('-');
    if (!type || !/^[a-z]{2}$/.test(type) || !set || !/^\d+$/.test(set)) continue;
    parts.push({
      type,
      setId: Number(set),
      colors: colors.filter((c) => /^\d+$/.test(c)).map(Number),
    });
  }
  return parts;
}

export function serializeFigure(parts: readonly FigurePart[]): string {
  return parts.map((p) => [p.type, p.setId, ...p.colors].join('-')).join('.');
}
