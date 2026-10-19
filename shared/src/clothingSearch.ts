import { nameKey } from './protocol.js';

/**
 * Busca de roupas no editor (Fase 35). O Habbo não tem nome em português para cada peça, só o
 * nome da biblioteca em inglês (`shirt_M_pinstripesuit`, `hat_U_bananahelmet`): as palavras
 * dele são traduzidas por este dicionário para dar para buscar "terno", "chapéu", "capacete".
 */
const WORDS: Record<string, string> = {
  shirt: 'camisa blusa camiseta',
  tshirt: 'camiseta',
  top: 'blusa top',
  suit: 'terno',
  pinstripe: 'risca listrado',
  jacket: 'jaqueta',
  coat: 'casaco',
  hoodie: 'moletom capuz',
  sweater: 'suéter blusa de frio',
  jumper: 'suéter',
  vest: 'colete',
  dress: 'vestido',
  skirt: 'saia',
  pants: 'calça',
  trousers: 'calça',
  jeans: 'jeans calça',
  shorts: 'bermuda short',
  leg: 'calça',
  legs: 'calça',
  shoes: 'sapatos tênis',
  shoe: 'sapato tênis',
  boots: 'botas',
  boot: 'bota',
  sneakers: 'tênis',
  trainers: 'tênis',
  sandals: 'sandálias',
  heels: 'salto',
  socks: 'meias',
  hat: 'chapéu',
  cap: 'boné',
  helmet: 'capacete',
  crown: 'coroa',
  beanie: 'gorro touca',
  hood: 'capuz',
  bandana: 'bandana',
  headband: 'faixa tiara',
  tiara: 'tiara',
  horns: 'chifres',
  ears: 'orelhas',
  hair: 'cabelo',
  wig: 'peruca cabelo',
  glasses: 'óculos',
  sunglasses: 'óculos de sol',
  goggles: 'óculos',
  eye: 'olho óculos',
  mask: 'máscara',
  beard: 'barba',
  moustache: 'bigode',
  mustache: 'bigode',
  scarf: 'cachecol lenço',
  tie: 'gravata',
  bowtie: 'gravata borboleta',
  necklace: 'colar',
  chain: 'corrente',
  medal: 'medalha',
  badge: 'distintivo',
  bag: 'bolsa mochila',
  backpack: 'mochila',
  wings: 'asas',
  cape: 'capa',
  belt: 'cinto',
  waist: 'cintura cinto',
  apron: 'avental',
  uniform: 'uniforme',
  armor: 'armadura',
  armour: 'armadura',
  robe: 'roupão túnica',
  kimono: 'quimono',
  bikini: 'biquíni',
  swimsuit: 'maiô',
  wetsuit: 'roupa de mergulho',
  jumpsuit: 'macacão',
  playsuit: 'macaquinho',
  tracksuit: 'agasalho',
  bodysuit: 'body collant',
  catsuit: 'macacão',
  pajamas: 'pijama',
  pyjama: 'pijama',
  costume: 'fantasia',
  party: 'festa',
  christmas: 'natal',
  xmas: 'natal',
  santa: 'papai noel natal',
  halloween: 'halloween',
  easter: 'páscoa',
  valentine: 'namorados',
  valentines: 'namorados',
  summer: 'verão',
  winter: 'inverno',
  snow: 'neve',
  pirate: 'pirata',
  ninja: 'ninja',
  viking: 'viking',
  cowboy: 'cowboy vaqueiro',
  chef: 'chef cozinheiro',
  police: 'polícia',
  doctor: 'médico',
  nurse: 'enfermeira',
  school: 'escola',
  sport: 'esporte',
  football: 'futebol',
  soccer: 'futebol',
  basketball: 'basquete',
  baseball: 'beisebol',
  rock: 'rock',
  punk: 'punk',
  gothic: 'gótico',
  goth: 'gótico',
  princess: 'princesa',
  king: 'rei',
  queen: 'rainha',
  knight: 'cavaleiro',
  angel: 'anjo',
  devil: 'diabo',
  bunny: 'coelho',
  cat: 'gato',
  dog: 'cachorro',
  bear: 'urso',
  flower: 'flor',
  flowers: 'flores',
  heart: 'coração',
  star: 'estrela',
  gold: 'dourado ouro',
  silver: 'prateado prata',
  black: 'preto',
  white: 'branco',
  red: 'vermelho',
  blue: 'azul',
  green: 'verde',
  pink: 'rosa',
  purple: 'roxo',
  yellow: 'amarelo',
  leather: 'couro',
  denim: 'jeans',
  wool: 'lã',
  lace: 'renda',
  striped: 'listrado',
  stripes: 'listras',
  long: 'longo comprido',
  short: 'curto',
  sleeve: 'manga',
  sleeveless: 'regata sem manga',
  tank: 'regata',
  polo: 'polo',
  formal: 'social formal',
  casual: 'casual',
  business: 'social executivo',
  hc: 'clube habbo club',
  vip: 'vip',
  banana: 'banana',
};

/** Prefixos de tipo nos nomes das bibliotecas (não ajudam na busca). */
const SKIP = new Set(['m', 'f', 'u', 'acc', 'misc', 'hh', 'human']);

/** Texto pesquisável de uma peça: palavras do nome da biblioteca, traduções, categoria e número. */
export function clothingSearchText(library: string | undefined, label: string, id: number): string {
  const words = (library ?? '')
    .split(/[_\d]+|(?<=[a-z])(?=[A-Z])/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 1 && !SKIP.has(w));
  const pt = words.flatMap((w) => WORDS[w] ?? findInside(w));
  return nameKey([label, String(id), ...words, ...pt].join(' '));
}

/** Palavras grudadas (`bananahelmet`): procura termos do dicionário dentro. */
function findInside(word: string): string[] {
  const out: string[] = [];
  let rest = word;
  // Mais longas primeiro, consumindo o trecho: "swimsuit" não vira também "suit" (terno).
  for (const en of BY_LENGTH) {
    if (rest.includes(en)) {
      out.push(en, WORDS[en]!);
      rest = rest.split(en).join(' ');
    }
  }
  return out;
}

const BY_LENGTH = Object.keys(WORDS)
  .filter((w) => w.length >= 3)
  .sort((a, b) => b.length - a.length);

/** A peça bate com a busca (todas as palavras digitadas, sem acento nem maiúsculas)? */
export function matchesSearch(text: string, query: string): boolean {
  const terms = nameKey(query).split(/\s+/).filter(Boolean);
  return terms.every((t) => text.includes(t));
}

// ---------- Looks salvos ----------

/** Quantos looks cada pessoa guarda. */
export const LOOK_SLOTS = 5;

export interface SavedLook {
  slot: number;
  figure: string;
  gender: 'M' | 'F';
}
