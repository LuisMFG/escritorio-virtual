import { parseFigure, serializeFigure, type FigurePart } from './figure.js';
import type { Gender } from './manifests.js';

/**
 * Fantasias (aba "Fantasias" do Meu visual): conjuntos prontos montados com peças do catálogo.
 * Vestir uma fantasia troca só a roupa e os acessórios; o rosto, a pele, o cabelo, os óculos e a
 * máscara da pessoa ficam como estão.
 */
export interface Costume {
  id: string;
  /** Tema (o grupo na aba), ex.: "Seiya de Pégaso". */
  theme: string;
  /** Nome da versão dentro do tema. */
  label: string;
  /** Peças por gênero (`tipo-set-cor-cor`, como na figure). */
  parts: Record<Gender, string>;
}

/** Tipos que uma fantasia controla: o que ela não traz é tirado (um chapéu antigo, um cinto…). */
export const COSTUME_TYPES: readonly string[] = [
  'ch',
  'cp',
  'cc',
  'ca',
  'wa',
  'lg',
  'sh',
  'ha',
  'he',
];

// Seiya de Pégaso: tiara alada, peitoral, pernas e botas de armadura, camiseta vermelha por baixo.
const PEGASUS_SHIRT: Record<Gender, string> = { M: 'ch-3030-96', F: 'ch-3351-96-96' };
const pegasus = (armor: string, extra = ''): Record<Gender, string> => {
  const rest = `he-4022.cc-3609-${armor}.lg-3607-${armor}.sh-3611-${armor}${extra}`;
  return { M: `${PEGASUS_SHIRT.M}.${rest}`, F: `${PEGASUS_SHIRT.F}.${rest}` };
};

export const COSTUMES: readonly Costume[] = [
  {
    id: 'pegaso-classica',
    theme: 'Seiya de Pégaso',
    label: 'Armadura clássica',
    parts: pegasus('92-96'),
  },
  {
    id: 'pegaso-asas',
    theme: 'Seiya de Pégaso',
    label: 'Com asas',
    parts: pegasus('92-96', '.ca-5026-92'),
  },
  {
    id: 'pegaso-azul',
    theme: 'Seiya de Pégaso',
    label: 'Armadura azul',
    parts: pegasus('92-108'),
  },
];

/** Temas na ordem da lista, cada um com as suas versões. */
export function costumeThemes(): { theme: string; costumes: Costume[] }[] {
  const out: { theme: string; costumes: Costume[] }[] = [];
  for (const c of COSTUMES) {
    const group = out.find((g) => g.theme === c.theme);
    if (group) group.costumes.push(c);
    else out.push({ theme: c.theme, costumes: [c] });
  }
  return out;
}

/** Veste a fantasia no visual: troca roupa e acessórios, mantém o resto da pessoa. */
export function applyCostume(figure: string, costume: Costume, gender: Gender): string {
  const kept = parseFigure(figure).filter((p) => !COSTUME_TYPES.includes(p.type));
  const worn: FigurePart[] = parseFigure(costume.parts[gender]);
  return serializeFigure([...kept, ...worn]);
}

/** A pessoa está vestindo exatamente essa fantasia? */
export function wearsCostume(figure: string, costume: Costume, gender: Gender): boolean {
  const key = (p: FigurePart) => `${p.type}-${p.setId}-${p.colors.join('-')}`;
  const mine = parseFigure(figure).filter((p) => COSTUME_TYPES.includes(p.type));
  const want = parseFigure(costume.parts[gender]);
  return mine.length === want.length && want.every((w) => mine.some((m) => key(m) === key(w)));
}
