import { parseFigure, serializeFigure, type FigurePart } from './figure.js';
import type { Gender } from './manifests.js';

/**
 * Fantasias (aba "Fantasias" do Meu visual): conjuntos prontos montados com peças do catálogo.
 * Vestir uma fantasia troca só a roupa e os acessórios; o rosto, a pele e o cabelo da pessoa
 * ficam como estão.
 */
export interface Costume {
  id: string;
  /** Tema (o grupo na aba), ex.: "Dragon Ball". */
  theme: string;
  /** Personagem (ou versão) dentro do tema. */
  label: string;
  /** Peças por gênero (`tipo-set-cor-cor`, como na figure). */
  parts: Record<Gender, string>;
}

/**
 * Tipos que uma fantasia controla: o que ela não traz é tirado (um chapéu antigo, um cinto, o
 * sabre de luz da fantasia anterior…).
 */
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
  'mc',
];

/**
 * Peças de fantasia montadas com o catálogo (grupos por franquia). Algumas trazem também óculos,
 * máscara ou pet de ombro (a venda do Gojo, os olhos do Gengar, o "Pikachu" do Ash): esses
 * entram no lugar dos da pessoa e saem ao trocar de fantasia.
 */
export const COSTUMES: readonly Costume[] = [
  {
    id: 'pegaso-classica',
    theme: 'Cavaleiros do Zodíaco',
    label: 'Seiya',
    parts: {
      M: 'ch-3030-96.he-4022.cc-3609-92-96.lg-3607-92-96.sh-3611-92-96',
      F: 'ch-3351-96-96.he-4022.cc-3609-92-96.lg-3607-92-96.sh-3611-92-96',
    },
  },
  {
    id: 'pegaso-asas',
    theme: 'Cavaleiros do Zodíaco',
    label: 'Seiya com asas',
    parts: {
      M: 'ch-3030-96.he-4022.cc-3609-92-96.lg-3607-92-96.sh-3611-92-96.ca-5026-92',
      F: 'ch-3351-96-96.he-4022.cc-3609-92-96.lg-3607-92-96.sh-3611-92-96.ca-5026-92',
    },
  },
  {
    id: 'pegaso-azul',
    theme: 'Cavaleiros do Zodíaco',
    label: 'Seiya (armadura azul)',
    parts: {
      M: 'ch-3030-96.he-4022.cc-3609-92-108.lg-3607-92-108.sh-3611-92-108',
      F: 'ch-3351-96-96.he-4022.cc-3609-92-108.lg-3607-92-108.sh-3611-92-108',
    },
  },
  {
    id: 'goku',
    theme: 'Dragon Ball',
    label: 'Goku',
    parts: {
      M: 'ch-3030-1424.cc-3827-94-94.wa-3366-1424-1424.lg-270-94.sh-3383-1424-1424',
      F: 'ch-3351-1424-1424.cc-3826-94-94.wa-3366-1424-1424.lg-695-94.sh-3383-1424-1424',
    },
  },
  {
    id: 'vegeta',
    theme: 'Dragon Ball',
    label: 'Vegeta',
    parts: {
      M: 'ch-3030-1424.cc-3609-92-1410.lg-4114-1424-1424.sh-3611-92-1410.mc-3360-92',
      F: 'ch-3351-1424-1424.cc-3609-92-1410.lg-4114-1424-1424.sh-3611-92-1410.mc-3360-92',
    },
  },
  {
    id: 'naruto',
    theme: 'Naruto',
    label: 'Naruto',
    parts: {
      M: 'ch-3030-110.cc-5581-94-110.lg-5582-94-110.sh-6181-1424.ha-3352-1424-1427',
      F: 'ch-3351-110-110.cc-5580-94-110.lg-5582-94-110.sh-6181-1424.ha-3352-1424-1427',
    },
  },
  {
    id: 'luffy',
    theme: 'One Piece',
    label: 'Luffy',
    parts: {
      M: 'ch-3030-96.cc-3269-96-96.lg-3202-1424-1424.sh-6181-1325.ha-3209-1320.wa-3504-1410',
      F: 'ch-3351-96-96.cc-3515-96-96.lg-3202-1424-1424.sh-6181-1325.ha-3209-1320.wa-3504-1410',
    },
  },
  {
    id: 'ichigo',
    theme: 'Bleach',
    label: 'Ichigo',
    parts: {
      M: 'ch-3372-110-110.wa-3366-92-92.lg-3365-110.ca-6044.sh-6181-110',
      F: 'ch-3371-110-110.wa-3366-92-92.lg-3365-110.ca-6044.sh-6181-110',
    },
  },
  {
    id: 'ichigo-hollow',
    theme: 'Bleach',
    label: 'Ichigo (máscara Hollow)',
    parts: {
      M: 'ch-3372-110-110.wa-3366-92-92.lg-3365-110.ca-6044.sh-6181-110.ea-3141',
      F: 'ch-3371-110-110.wa-3366-92-92.lg-3365-110.ca-6044.sh-6181-110.ea-3141',
    },
  },
  {
    id: 'sukuna',
    theme: 'Jujutsu Kaisen',
    label: 'Sukuna',
    parts: {
      M: 'ch-3372-92-92.wa-3366-110-110.lg-3365-92.sh-6181-110',
      F: 'ch-3371-92-92.wa-3366-110-110.lg-3365-92.sh-6181-110',
    },
  },
  {
    id: 'gojo',
    theme: 'Jujutsu Kaisen',
    label: 'Gojo (venda)',
    parts: {
      M: 'ch-3030-110.cc-3075-110.lg-4114-110-110.sh-3375-110-110.ea-5156-92',
      F: 'ch-3351-110-110.cc-3066-110.lg-4114-110-110.sh-3375-110-110.ea-5156-92',
    },
  },
  {
    id: 'gojo-oculos',
    theme: 'Jujutsu Kaisen',
    label: 'Gojo (óculos)',
    parts: {
      M: 'ch-3030-110.cc-3075-110.lg-4114-110-110.sh-3375-110-110.ea-3107-92-92',
      F: 'ch-3351-110-110.cc-3066-110.lg-4114-110-110.sh-3375-110-110.ea-3107-92-92',
    },
  },
  {
    id: 'miku',
    theme: 'Vocaloid',
    label: 'Hatsune Miku',
    parts: {
      M: 'ch-3030-1427.ca-3437-104.lg-4114-110-110.sh-5943-110-110.he-3295-104-104',
      F: 'ch-3067-1427.ca-3437-104.lg-3061-110.sh-5943-110-110.he-3295-104-104',
    },
  },
  {
    id: 'ash',
    theme: 'Pokémon',
    label: 'Ash',
    parts: {
      M: 'ch-3030-110.cc-3269-1424-92.lg-270-82.sh-3383-110-110.ha-3171-96-96.mc-4091-102.pt-6217',
      F: 'ch-3351-110-110.cc-3515-1424-92.lg-695-82.sh-3383-110-110.ha-3171-96-96.mc-4091-102.pt-6217',
    },
  },
  {
    id: 'pikachu',
    theme: 'Pokémon',
    label: 'Pikachu',
    parts: {
      M: 'ch-3030-1410.cc-4109-1410-1410.lg-4114-1410-1410.sh-3252-1410-1410.he-5442-1410-110',
      F: 'ch-3351-1410-1410.cc-4108-1410-1410.lg-4114-1410-1410.sh-3252-1410-1410.he-5442-1410-110',
    },
  },
  {
    id: 'snorlax',
    theme: 'Pokémon',
    label: 'Snorlax',
    parts: {
      M: 'ch-6388-1425-89.ha-6389-1425-89.lg-4114-1425-1425.sh-3252-89-89',
      F: 'ch-6388-1425-89.ha-6389-1425-89.lg-4114-1425-1425.sh-3252-89-89',
    },
  },
  {
    id: 'gengar',
    theme: 'Pokémon',
    label: 'Gengar',
    parts: {
      M: 'ch-6564-1417-1419.ha-6563-1417-1419.lg-4114-1417-1417.sh-3252-1417-1417.ea-5146',
      F: 'ch-6564-1417-1419.ha-6563-1417-1419.lg-4114-1417-1417.sh-3252-1417-1417.ea-5146',
    },
  },
  {
    id: 'darth-vader',
    theme: 'Star Wars',
    label: 'Darth Vader',
    parts: {
      M: 'ch-3030-110.cc-3299-110-110.wa-3073-1427.lg-4114-110-110.sh-3375-110-110.ha-4018-110-110.mc-6424-96',
      F: 'ch-3351-110-110.cc-3299-110-110.wa-3073-1427.lg-4114-110-110.sh-3375-110-110.ha-4018-110-110.mc-6424-96',
    },
  },
  {
    id: 'stormtrooper',
    theme: 'Star Wars',
    label: 'Stormtrooper',
    parts: {
      M: 'ch-6051-92.lg-3449.sh-3375-92-92.ha-3179-92-92',
      F: 'ch-6051-92.lg-3449.sh-3375-92-92.ha-3179-92-92',
    },
  },
  {
    id: 'jedi',
    theme: 'Star Wars',
    label: 'Jedi',
    parts: {
      M: 'ch-3848-1325-1409.lg-4114-1325-1325.sh-3375-1325-1325.mc-6424-107',
      F: 'ch-3849-1325-1409.lg-4114-1325-1325.sh-3375-1325-1325.mc-6424-107',
    },
  },
  {
    id: 'harry-potter',
    theme: 'Harry Potter',
    label: 'Harry Potter',
    parts: {
      M: 'ch-3848-110-110.ca-3151-100-1410.ea-3698-110-110.mc-6574-1325-1325.lg-270-110.sh-290-110',
      F: 'ch-3849-110-110.ca-3151-100-1410.ea-3698-110-110.mc-6574-1325-1325.lg-695-110.sh-725-110',
    },
  },
  {
    id: 'mario',
    theme: 'Nintendo',
    label: 'Mario',
    parts: {
      M: 'ch-3728-1424-96.lg-270-1424.sh-3383-1325-1325.ha-3171-96-96.mc-3360-92',
      F: 'ch-3729-1424-96.lg-695-1424.sh-3383-1325-1325.ha-3171-96-96.mc-3360-92',
    },
  },
  {
    id: 'luigi',
    theme: 'Nintendo',
    label: 'Luigi',
    parts: {
      M: 'ch-3728-1424-1432.lg-270-1424.sh-3383-1325-1325.ha-3171-1432-1432.mc-3360-92',
      F: 'ch-3729-1424-1432.lg-695-1424.sh-3383-1325-1325.ha-3171-1432-1432.mc-3360-92',
    },
  },
  {
    id: 'link',
    theme: 'Nintendo',
    label: 'Link',
    parts: {
      M: 'ch-3030-1409.cc-4109-1431-1431.lg-4114-1409-1409.sh-3783-1325-1325.he-3081-92.ca-4936.ha-3843-1431-1431',
      F: 'ch-3351-1409-1409.cc-4108-1431-1431.lg-4114-1409-1409.sh-3783-1325-1325.he-3081-92.ca-4936.ha-3843-1431-1431',
    },
  },
  {
    id: 'batman',
    theme: 'DC',
    label: 'Batman',
    parts: {
      M: 'ch-6564-110-110.ha-6563-110-110.cc-3299-110-110.wa-3073-1410.lg-4114-110-110.sh-5729-110-110',
      F: 'ch-6564-110-110.ha-6563-110-110.cc-3299-110-110.wa-3073-1410.lg-4114-110-110.sh-5729-110-110',
    },
  },
];

/** Óculos, máscaras e pets que só existem por causa de alguma fantasia. */
const COSTUME_EXTRAS = new Set(
  COSTUMES.flatMap((c) =>
    Object.values(c.parts).flatMap((parts) =>
      parseFigure(parts)
        .filter((p) => !COSTUME_TYPES.includes(p.type))
        .map((p) => `${p.type}-${p.setId}`),
    ),
  ),
);

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

/**
 * Veste a fantasia no visual: troca roupa e acessórios e mantém o resto da pessoa (pele, rosto,
 * cabelo e, se a fantasia não trouxer os seus, óculos, máscara e pet de ombro).
 */
export function applyCostume(figure: string, costume: Costume, gender: Gender): string {
  const worn: FigurePart[] = parseFigure(costume.parts[gender]);
  const wornTypes = new Set(worn.map((p) => p.type));
  const kept = parseFigure(figure).filter(
    (p) =>
      !COSTUME_TYPES.includes(p.type) &&
      !wornTypes.has(p.type) &&
      !COSTUME_EXTRAS.has(`${p.type}-${p.setId}`),
  );
  return serializeFigure([...kept, ...worn]);
}

/** A pessoa está vestindo exatamente essa fantasia? */
export function wearsCostume(figure: string, costume: Costume, gender: Gender): boolean {
  const key = (p: FigurePart) => `${p.type}-${p.setId}-${p.colors.join('-')}`;
  const want = parseFigure(costume.parts[gender]);
  const types = new Set([...COSTUME_TYPES, ...want.map((p) => p.type)]);
  const mine = parseFigure(figure).filter((p) => types.has(p.type));
  return mine.length === want.length && want.every((w) => mine.some((m) => key(m) === key(w)));
}
