/**
 * Pets do Habbo (Fase 38): os tipos do Habbo Brasil, desenhados por camadas como os móveis
 * animados. O catálogo (`client/public/assets/pets/pets.json`) é gerado pelo `npm run assets:pets`.
 */

/** Prefixo da espécie dos pets do Habbo (`hh:dog`); sem ele, a arte própria antiga. */
export const HABBO_PET_PREFIX = 'hh:';

/**
 * Nomes em português dos tipos do Habbo. Ficam de fora: a pedra de 1º de abril (`fools`), o
 * monstro-caixa (`monster`), a planta que não anda e o cavalo (paletas de corpo e crina separadas).
 */
export const HABBO_PET_NAMES: Record<string, string> = {
  dog: 'Cachorro',
  cat: 'Gato',
  terrier: 'Terrier',
  croco: 'Crocodilo',
  bear: 'Urso',
  pig: 'Porco',
  lion: 'Leão',
  rhino: 'Rinoceronte',
  spider: 'Aranha',
  turtle: 'Tartaruga',
  chicken: 'Galinha',
  frog: 'Sapo',
  dragon: 'Dragão',
  monkey: 'Macaco',
  horse: 'Cavalo',
  bunnyeaster: 'Coelho de Páscoa',
  bunnyevil: 'Coelho Malvado',
  bunnydepressed: 'Coelho Tristonho',
  bunnylove: 'Coelho Apaixonado',
  pigeongood: 'Pombo Bonzinho',
  pigeonevil: 'Pombo Malvado',
  demonmonkey: 'Macaco Demônio',
  bearbaby: 'Ursinho',
  terrierbaby: 'Filhote de Terrier',
  gnome: 'Gnomo',
  kittenbaby: 'Gatinho',
  puppybaby: 'Filhote de Cachorro',
  pigletbaby: 'Porquinho',
  haloompa: 'Haloompa',
  cow: 'Vaca',
  velociraptor: 'Velociraptor',
  pterosaur: 'Pterossauro',
  dragondog: 'Cão-Dragão',
  curseddragon: 'Dragão Amaldiçoado',
};

/** Cores para tingir o pet (multiplicam a paleta; branco = a paleta pura). */
export const HABBO_PET_TINTS = [
  'ffffff',
  'f4d3a4',
  'c98a4b',
  '8b5a2b',
  '5a4636',
  '9aa3ad',
  '3c3f45',
  'f2a7c3',
  'a7d3f2',
  'b9e3a1',
  'f7e07a',
  'd99ae0',
] as const;

/** Um tipo de pet do Habbo no catálogo. */
export interface HabboPetType {
  type: string;
  name: string;
  revision: number;
  swf: string;
  /** Paletas (padrões de pelagem), pelo nome no SWF; a escolhida é a posição nesta lista. */
  palettes: string[];
  postures: string[];
}

export interface HabboPetCatalog {
  version: 1;
  pets: HabboPetType[];
}

/** Folha + dados de desenho de um pet do Habbo (com a paleta), pelo proxy do servidor. */
export function petVisualUrl(
  type: string,
  revision: number,
  palette: number,
  ext: 'png' | 'json',
): string {
  return `/hh/pet/${type}.${ext}?revision=${revision}&palette=${palette}&v=2`;
}

/** `hh:dog` → `dog`; outra espécie → `null`. */
export function habboPetType(species: string): string | null {
  return species.startsWith(HABBO_PET_PREFIX) ? species.slice(HABBO_PET_PREFIX.length) : null;
}

/** Postura do Habbo para a ação do pet na sala (cada tipo tem as suas; `std` sempre existe). */
export function petPosture(
  action: string,
  walking: boolean,
  postures: Readonly<Record<string, number>>,
): string {
  const want = walking
    ? ['mv', 'wlk', 'std']
    : action === 'sit'
      ? ['sit', 'std']
      : action === 'lie'
        ? ['lay', 'sit', 'std']
        : ['std'];
  return want.find((p) => p in postures) ?? Object.keys(postures)[0] ?? 'std';
}
