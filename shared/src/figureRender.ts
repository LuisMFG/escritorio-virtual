/**
 * Montagem do avatar a partir das partes do Habbo (Fase 31). Puro (sem DOM nem Node): o cliente
 * usa no navegador e os testes usam no Node. O imager da HabboAssets só desenha a pose em pé;
 * montando as partes das bibliotecas de roupa temos todas as poses (andar, sentar, acenar…).
 */

/** Tamanho do quadro: o mesmo do imager (64×110), para a cena não mudar nada. */
export const FIGURE_WIDTH = 64;
export const FIGURE_HEIGHT = 110;
/** Quadro em que a figura é montada: tamanho e ponto de registro das partes. */
export interface FigureCanvas {
  width: number;
  height: number;
  regX: number;
  regY: number;
}
/** Em pé, andando, sentado: o quadro do imager (registro calibrado contra ele). */
export const STAND_CANVAS: FigureCanvas = { width: 64, height: 110, regX: 0, regY: 100 };
/** Deitado o corpo fica na horizontal: quadro mais largo, com o mesmo eixo do em pé no meio. */
export const LAY_CANVAS: FigureCanvas = { width: 128, height: 120, regX: 32, regY: 100 };

/**
 * Com pet de ombro ou item diverso (20/10/2026): o desenho sai para os lados do avatar; quadro
 * largo como o de deitado, com o mesmo eixo, para não cortar.
 */
export const WIDE_CANVAS: FigureCanvas = { width: 128, height: 110, regX: 32, regY: 100 };

/** Partes que desenham fora do corpo (pet de ombro, itens diversos). */
export function needsWideCanvas(parts: readonly { type: string }[]): boolean {
  return parts.some((p) => /^(pt|mc)/.test(p.type));
}

/** Quadro de cada postura (`wide`: figura com pet de ombro ou item diverso). */
export function canvasFor(pose: Pick<FigurePose, 'posture'>, wide = false): FigureCanvas {
  if (pose.posture === 'lay') return LAY_CANVAS;
  return wide ? WIDE_CANVAS : STAND_CANVAS;
}

/** Dados de montagem gerados pelo `assets:figure` (`client/public/assets/figure/figuredata.json`). */
export interface FigureData {
  /** Biblioteca → revisão (vai na URL da folha, para o cache nunca servir uma versão velha). */
  libs: Record<string, number>;
  /** Biblioteca → SWF original na CDN da HabboAssets (o servidor converte em folha). */
  swf: Record<string, string>;
  /** `tipo:id` da parte → biblioteca onde está o desenho. */
  partLib: Record<string, string>;
  /** `tipo:idDoConjunto` → paleta, partes `[tipo, id, pintável (0/1), índice da cor]` e camadas que esconde. */
  sets: Record<
    string,
    { p: number; parts: [string, number, 0 | 1, number][]; hide?: string[]; /** animada */ a?: 1 }
  >;
  /** Paleta → cor → hex (`"RRGGBB"`). */
  palettes: Record<string, Record<string, string>>;
  /** Efeitos (Fase 34): biblioteca → revisão e SWF. */
  effects?: Record<string, { revision: number; swf: string }>;
}

/** Folha de uma biblioteca, gerada pelo servidor a partir do SWF (`/hh/figure/{lib}.json`). */
export interface FigureSheet {
  /** `h_std_ch_1_2_0` → deslocamento (e `source` quando reaproveita a imagem de outra). */
  assets: Record<string, { x: number; y: number; source?: string }>;
  /** Recorte de cada imagem na folha PNG (`/hh/figure/{lib}.png`). */
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

/** Uma biblioteca pronta para montar: a folha e os pixels RGBA do PNG. */
export interface FigureLib extends FigureSheet {
  width: number;
  height: number;
  /** RGBA, `width * height * 4`. */
  pixels: Uint8Array | Uint8ClampedArray;
}

// Ordem de desenho, de trás para a frente, por direção (4–6 são o espelho de 2–0).
// Tipos novos do catálogo completo (20/10/2026): estampa (cp) por cima da blusa; itens diversos
// (mc, mcl/mcr nas mãos, mco por cima) e pet de ombro (pt, ptl atrás, ptr na frente).
const FRONT =
  'sd ptl mcl lh ls lc bd sh lg ch cp cc ca wa mc pt rh rs rc mcr hd fa ey fc hr hrb ha he ea ptr mco ri li';
/** De lado (3): os dois braços por cima da roupa. */
const SIDE =
  'sd ptl bd sh lg ch cp cc ca wa mc pt mcl lh ls lc rh rs rc mcr hd fa ey fc hr hrb ha he ea ptr mco ri li';
/** De costas para a esquerda (7): o braço direito fica atrás do corpo. */
const BACK =
  'sd ptr mcr rh rs rc mcl lh ls lc bd sh lg ch cp cc ca wa mc pt hd fa ey fc hr hrb ha he ea ptl mco ri li';
const ORDER: Record<number, string[]> = {
  0: FRONT.split(' '),
  1: FRONT.split(' '),
  2: FRONT.split(' '),
  3: SIDE.split(' '),
  7: BACK.split(' '),
};

/** Partes da cabeça: ficam na pose `std` enquanto o corpo anda, senta ou acena. */
const HEAD_PARTS = new Set(['hd', 'fa', 'ey', 'fc', 'hr', 'hrb', 'ha', 'he', 'ea']);

export interface FigureLayer {
  type: string;
  id: number;
  lib: string;
  /** Cor de multiplicar (`[r, g, b]`) ou `null` para o desenho original (olhos, por exemplo). */
  tint: [number, number, number] | null;
  /** Roupa animada: a pose em pé tem vários quadros que se alternam (Fase 35). */
  animated?: boolean;
}

/**
 * Partes a desenhar para uma figure string. `missing` lista conjuntos/partes que os dados não
 * conhecem: nesse caso quem chama usa o imager, para não mostrar alguém pela metade.
 */
export function resolveFigure(
  figure: string,
  data: FigureData,
): { parts: FigureLayer[]; libs: string[]; missing: string[] } {
  const parts: FigureLayer[] = [];
  const missing: string[] = [];
  const hidden = new Set<string>();
  const chosen: { type: string; set: FigureData['sets'][string]; colors: number[] }[] = [];
  for (const token of figure.split('.')) {
    const [type, id, ...colors] = token.split('-');
    if (!type || !id) continue;
    const set = data.sets[`${type}:${id}`];
    if (!set) {
      missing.push(token);
      continue;
    }
    for (const h of set.hide ?? []) hidden.add(h);
    chosen.push({ type, set, colors: colors.map(Number) });
  }
  for (const { set, colors } of chosen) {
    // Cabelo: a parte "grande" (hrb) é o cabelo de verdade; sem ela (escondida por chapéu ou
    // inexistente) desenha a curta (hr), que cabe por baixo do chapéu.
    const hasBig = set.parts.some(([t]) => t === 'hrb') && !hidden.has('hrb');
    for (const [type, id, colorable, colorIndex] of set.parts) {
      if (hidden.has(type) || (type === 'hr' && hasBig)) continue;
      const lib = data.partLib[`${type}:${id}`];
      if (!lib) {
        missing.push(`${type}:${id}`);
        continue;
      }
      const colorId = colorable ? (colors[colorIndex - 1] ?? colors[0]) : undefined;
      const hex =
        colorId !== undefined ? data.palettes[String(set.p)]?.[String(colorId)] : undefined;
      parts.push({
        type,
        id,
        lib,
        tint: hex ? hexRgb(hex) : null,
        ...(set.a ? { animated: true } : {}),
      });
    }
  }
  return { parts, libs: [...new Set(parts.map((p) => p.lib))], missing };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Partes sem desenho nas bibliotecas carregadas (o mapa do Habbo às vezes aponta uma parte para
 * uma biblioteca que não temos). Com alguma, quem chama usa o imager.
 */
export function partsWithoutArt(
  parts: readonly FigureLayer[],
  libs: ReadonlyMap<string, FigureLib>,
): FigureLayer[] {
  return parts.filter((p) => {
    // Mangas declaradas sem desenho são comuns (o Habbo simplesmente não desenha).
    if (SLEEVES.has(p.type)) return false;
    const lib = libs.get(p.lib);
    // Basta existir em alguma pose: há partes que só aparecem em algumas (manga só ao acenar).
    return !lib || !partsIn(lib).has(`${p.type}_${p.id}`);
  });
}

const SLEEVES = new Set(['ls', 'rs', 'lc', 'rc']);
const partIndex = new WeakMap<FigureLib, Set<string>>();
/** Partes (`tipo_id`) que a biblioteca desenha em qualquer pose. */
function partsIn(lib: FigureLib): Set<string> {
  let set = partIndex.get(lib);
  if (!set) {
    set = new Set();
    for (const name of Object.keys(lib.assets)) {
      const m = /^h_[a-z]+_([a-z]+)_(\d+)_/.exec(name);
      if (m) set.add(`${m[1]}_${m[2]}`);
    }
    partIndex.set(lib, set);
  }
  return set;
}

/** Postura do corpo inteiro. */
export type FigurePosture = 'std' | 'wlk' | 'sit' | 'lay';
/** Gesto de um braço: acenar, beijo, mão levantada, beber, carregar, placa. */
export type FigureGesture = 'wav' | 'blw' | 'respect' | 'drk' | 'crr' | 'sig';
/** Expressão do rosto (`eyb` = olhos fechados: piscar ou dormindo). */
export type FigureExpression = 'sml' | 'sad' | 'agr' | 'srp' | 'eyb';

/** Grupos do corpo que uma animação move cada um do seu jeito (como as danças do Habbo). */
export type BodyGroup = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'legs';
export const BODY_GROUPS: readonly BodyGroup[] = ['head', 'torso', 'leftArm', 'rightArm', 'legs'];

/**
 * Pose de um grupo do corpo num quadro de animação (Fase 54). A arte do Habbo não tem palmas,
 * pulo ou reverência: os movimentos novos combinam os desenhos que existem, parte por parte.
 */
export interface PartPose {
  /** Ação do desenho (`std`, `wlk`, `wav`, `respect`, `sig`, `blw`, `drk`, `crr`…). */
  action?: string;
  frame?: number;
  /** Deslocamento em px, no desenho virado para a direita (o espelho inverte o x). */
  dx?: number;
  dy?: number;
  /** Giro em relação ao corpo, em direções (−1, +1…), como a cabeça do Habbo. */
  dd?: number;
}

export interface FigurePose {
  direction: number;
  posture?: FigurePosture;
  /** Quadro da postura (andar tem 4). */
  frame?: number;
  gesture?: FigureGesture;
  gestureFrame?: number;
  /** Falando: boca e cabeça mexem (2 quadros). */
  talk?: boolean;
  talkFrame?: number;
  expression?: FigureExpression;
  /** Item na mão (id do Habbo em `hh_human_item`); aparece carregando ou bebendo. */
  handItem?: number;
  /**
   * Braço direito com o item, junto com um gesto do braço esquerdo (acenar segurando o copo).
   * Sem gesto, `gesture: 'crr' | 'drk'` faz o mesmo.
   */
  handGesture?: 'crr' | 'drk';
  /** Quadro das roupas animadas (cresce sem parar; cada peça usa o resto pelo seu total). */
  clothingFrame?: number;
  /** Pose por grupo do corpo (emotes e danças da Fase 54): vale antes do gesto e da postura. */
  parts?: Partial<Record<BodyGroup, PartPose>>;
}

const TORSO_PARTS = new Set(['bd', 'ch', 'cp', 'cc', 'ca', 'wa', 'mc', 'mco', 'pt', 'ptl', 'ptr']);
const LEG_PARTS = new Set(['lg', 'sh']);

/** Grupo de cada parte (a sombra e o resto não se mexem com a animação). */
export function bodyGroupOf(type: string): BodyGroup | null {
  if (HEAD_PARTS.has(type)) return 'head';
  if (LEFT_ARM.has(type) || type === 'li') return 'leftArm';
  if (RIGHT_ARM_ITEM.has(type)) return 'rightArm';
  if (LEG_PARTS.has(type)) return 'legs';
  if (TORSO_PARTS.has(type)) return 'torso';
  return null;
}

/**
 * Deitado só existe de lado: direita (2) ou, espelhado, esquerda (4). Uma regra só para o
 * servidor, a montagem e o deslocamento na cama (antes cada um arredondava de um jeito).
 */
export function layFacing(dir: number): 2 | 4 {
  return dir >= 3 && dir <= 6 ? 4 : 2;
}

/** Sentado só existe nas direções pares: uma ímpar arredonda para a anterior. */
export function sitFacing(dir: number): number {
  return dir & ~1;
}

/** Quadros de cada animação no Habbo (o resto tem um só). */
export const POSE_FRAMES = { wlk: 4, wav: 2, blw: 2, respect: 2, spk: 2 } as const;

const LEFT_ARM = new Set(['lh', 'ls', 'lc', 'mcl']);
const RIGHT_ARM = new Set(['rh', 'rs', 'rc', 'mcr']);
/** Carregar e beber: o braço direito e o item na mão (`ri`, da biblioteca `hh_human_item`). */
const RIGHT_ARM_ITEM = new Set(['rh', 'rs', 'rc', 'mcr', 'ri']);
/**
 * Mangas e acessórios sem desenho de alguns gestos (joinha, placa, beijo): usam o desenho mais
 * parecido em vez de ficar na pose do corpo (a mão faz o gesto e a manga não).
 */
const SLEEVE_ALIAS: Partial<Record<FigureGesture, FigureGesture>> = {
  respect: 'wav',
  sig: 'wav',
  blw: 'drk',
};
const GESTURE_SLEEVES = new Set(['ls', 'lc', 'rs', 'rc', 'mcl', 'mcr']);
/**
 * Espelho das direções 4–6: como no Habbo, cada parte de um lado usa o desenho da parte do
 * outro lado (o braço esquerdo espelhado da direção 2 é o direito da 4). Sem a troca, os dois
 * braços desenhados eram os de trás e o da frente sumia (segurando copo, acenando).
 */
const FLIPPED_TYPE: Record<string, string> = {
  lh: 'rh',
  rh: 'lh',
  ls: 'rs',
  rs: 'ls',
  lc: 'rc',
  rc: 'lc',
  li: 'ri',
  ri: 'li',
  mcl: 'mcr',
  mcr: 'mcl',
  ptl: 'ptr',
  ptr: 'ptl',
};
const flippedType = (type: string) => FLIPPED_TYPE[type] ?? type;
/** Ações de fala: quadro que falta cai na pose parada, não no quadro 0 da fala (deslocado). */
const TALK_ACTIONS = new Set(['spk', 'lsp']);
/** Que braço cada gesto usa. */
const GESTURE_ARM: Record<FigureGesture, Set<string>> = {
  wav: LEFT_ARM,
  respect: LEFT_ARM,
  sig: LEFT_ARM,
  blw: RIGHT_ARM,
  drk: RIGHT_ARM_ITEM,
  crr: RIGHT_ARM_ITEM,
};
/** Deitado, as expressões têm versões próprias. */
const LAY_FACE: Record<FigureExpression, string> = {
  sml: 'lsm',
  sad: 'lsa',
  agr: 'lag',
  srp: 'lsr',
  eyb: 'ley',
};

/** Ações a tentar para uma parte (a primeira que tiver desenho vence) e o quadro de cada uma. */
function actionsFor(type: string, pose: FigurePose): [string, number][] {
  const posture = pose.posture ?? 'std';
  const lay = posture === 'lay';
  const talk = pose.talk ? (pose.talkFrame ?? 0) : -1;
  const list: [string, number][] = [];
  // Pose do grupo na animação (Fase 54) vem antes de tudo; manga sem o desenho usa o parecido.
  const group = bodyGroupOf(type);
  const own = group ? pose.parts?.[group]?.action : undefined;
  if (own && !lay && !(HEAD_PARTS.has(type) && (type === 'ey' || type === 'fc'))) {
    list.push([own, pose.parts![group!]!.frame ?? 0]);
    const alias = GESTURE_SLEEVES.has(type) ? SLEEVE_ALIAS[own as FigureGesture] : undefined;
    if (alias) list.push([alias, 0]);
  }
  if (type === 'ey') {
    if (pose.expression) list.push([lay ? LAY_FACE[pose.expression] : pose.expression, 0]);
  } else if (type === 'fc') {
    if (talk >= 0) list.push([lay ? 'lsp' : 'spk', talk]);
    if (pose.gesture === 'blw' && !lay) list.push(['blw', 0]);
    if (pose.expression && pose.expression !== 'eyb') {
      list.push([lay ? LAY_FACE[pose.expression] : pose.expression, 0]);
    }
  } else if (HEAD_PARTS.has(type)) {
    if (talk >= 0) list.push([lay ? 'lsp' : 'spk', talk]);
  } else if (!lay) {
    // Deitado não há desenho de gesto (o braço ficava em pé, no ar): só o rosto muda.
    const gesture = pose.gesture;
    if (gesture && GESTURE_ARM[gesture].has(type)) {
      list.push([gesture, pose.gestureFrame ?? 0]);
      const alias = GESTURE_SLEEVES.has(type) ? SLEEVE_ALIAS[gesture] : undefined;
      if (alias) list.push([alias, 0]);
    }
    // Segurando o item enquanto o outro braço faz um gesto (acenar com o copo na mão).
    const hand = pose.handGesture;
    if (hand && RIGHT_ARM_ITEM.has(type) && !(gesture && GESTURE_ARM[gesture].has(type))) {
      list.push([hand, 0]);
    }
  }
  if (HEAD_PARTS.has(type)) list.push([lay ? 'lay' : 'std', 0]);
  else list.push([posture, pose.frame ?? 0]);
  list.push(['std', 0]);
  return list;
}

/**
 * Monta um quadro 64×110 RGBA na pose pedida. Cada parte usa a imagem da sua ação (gesto,
 * fala, expressão ou postura) e, sem ela, a pose em pé. As direções 4–6 são o espelho de 2–0,
 * como no Habbo, a não ser que a parte tenha desenho próprio para a direção (alguns gestos).
 */
export function composeFigure(
  parts: readonly FigureLayer[],
  libs: ReadonlyMap<string, FigureLib>,
  pose: FigurePose,
  canvas: FigureCanvas = STAND_CANVAS,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  // Deitado só existe de lado (2, e a 4 espelhada); sentado, nas pares. Com outra direção
  // (chegou de lado, virou), a pose antes caía no desenho em pé.
  const wanted =
    pose.posture === 'lay'
      ? layFacing(pose.direction)
      : pose.posture === 'sit'
        ? sitFacing(pose.direction)
        : pose.direction;
  const mirror = wanted >= 4 && wanted <= 6;
  const dir = mirror ? 6 - wanted : wanted;
  const order = ORDER[dir] ?? ORDER[2]!;
  // Deitado não há pose por parte: só o rosto muda (o braço ficava em pé, no ar).
  const groups = pose.posture === 'lay' ? undefined : pose.parts;
  const all =
    pose.handItem && libs.has('hh_human_item')
      ? [...parts, { type: 'ri', id: pose.handItem, lib: 'hh_human_item', tint: null }]
      : parts;
  // No espelho, cada parte ocupa o lugar (e a camada) da parte do outro lado.
  const layer = (type: string) => rank(order, mirror ? flippedType(type) : type);
  const sorted = [...all].sort((a, b) => layer(a.type) - layer(b.type));
  for (const part of sorted) {
    const lib = libs.get(part.lib);
    if (!lib) continue;
    const group = bodyGroupOf(part.type);
    const pp = group ? groups?.[group] : undefined;
    // Giro do grupo (a cabeça olhando para o lado): direção e espelho próprios da parte.
    const pWanted = pp?.dd ? (((wanted + pp.dd) % 8) + 8) % 8 : wanted;
    const pMirror = pWanted >= 4 && pWanted <= 6;
    const pDir = pMirror ? 6 - pWanted : pWanted;
    let found: { key: string; flip: boolean } | null = null;
    for (const [act, f] of actionsFor(part.type, pose)) {
      // Roupa animada: na pose em pé, o quadro da animação (pelo total de quadros da peça).
      const frame =
        part.animated && act === 'std' && f === 0 && pose.clothingFrame
          ? pose.clothingFrame % animFrames(lib, part, pDir)
          : f;
      const base = `h_${act}_${part.type}_${part.id}_`;
      // Quadro de fala que falta: vai para a próxima ação (a pose parada), não para o quadro 0.
      const zero = TALK_ACTIONS.has(act) && frame > 0 ? null : 0;
      const tries: [string, boolean][] = [];
      // Desenho próprio da direção pedida (alguns gestos e itens nas direções 4–6): sem espelho.
      if (pMirror) tries.push([`${base}${pWanted}_${frame}`, false]);
      if (pMirror && zero !== null) tries.push([`${base}${pWanted}_0`, false]);
      if (pMirror) {
        // Espelho com a parte do outro lado; se o conjunto não tiver, a própria (como antes).
        const other = `h_${act}_${flippedType(part.type)}_${part.id}_`;
        tries.push([`${other}${pDir}_${frame}`, true]);
        if (zero !== null) tries.push([`${other}${pDir}_0`, true]);
      }
      tries.push([`${base}${pDir}_${frame}`, pMirror]);
      if (zero !== null) tries.push([`${base}${pDir}_0`, pMirror]);
      const hit = tries.find(([k]) => lib.assets[k]);
      if (hit) {
        found = { key: hit[0], flip: hit[1] };
        break;
      }
    }
    if (!found) continue;
    const asset = lib.assets[found.key]!;
    const rect = lib.frames[asset.source ?? found.key] ?? lib.frames[found.key];
    if (!rect) continue;
    // O deslocamento vale no desenho virado para a direita: no espelho, o x inverte junto.
    blit(
      out,
      canvas,
      lib,
      rect,
      canvas.regX - asset.x + (pp?.dx ?? 0),
      canvas.regY - asset.y + (pp?.dy ?? 0),
      found.flip,
      part.tint,
    );
  }
  return out;
}

/** Chave de cache de uma pose (só o que muda o desenho). */
export function poseKey(p: FigurePose): string {
  return [
    p.direction,
    p.posture ?? 'std',
    p.frame ?? 0,
    p.gesture ?? '',
    p.gesture ? (p.gestureFrame ?? 0) : '',
    p.talk ? `t${p.talkFrame ?? 0}` : '',
    p.expression ?? '',
    p.handItem ?? '',
    p.handGesture ?? '',
    p.clothingFrame ?? '',
    partsKey(p.parts),
  ].join('|');
}

function partsKey(parts: FigurePose['parts']): string {
  if (!parts) return '';
  return BODY_GROUPS.map((g) => {
    const pp = parts[g];
    return pp
      ? `${pp.action ?? ''},${pp.frame ?? 0},${pp.dx ?? 0},${pp.dy ?? 0},${pp.dd ?? 0}`
      : '';
  }).join(';');
}

/**
 * Depois de quantos quadros as roupas animadas de uma figura se repetem, numa direção (MMC dos
 * quadros de cada peça animada). Quem guarda poses usa para não montar a mesma de novo.
 */
export function clothingPeriod(
  parts: readonly FigureLayer[],
  libs: ReadonlyMap<string, FigureLib>,
  direction: number,
): number {
  const dir = direction >= 4 && direction <= 6 ? 6 - direction : direction;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let period = 1;
  for (const part of parts) {
    const lib = part.animated ? libs.get(part.lib) : undefined;
    if (!lib) continue;
    const n = animFrames(lib, part, dir);
    period = Math.min(840, (period * n) / gcd(period, n));
  }
  return period;
}

/** Quantos quadros a pose em pé da peça tem (roupas animadas). */
function animFrames(lib: FigureLib, part: FigureLayer, dir: number): number {
  let n = 1;
  while (n < 32 && lib.assets[`h_std_${part.type}_${part.id}_${dir}_${n}`]) n++;
  return n;
}

function rank(order: string[], type: string): number {
  const i = order.indexOf(type);
  return i < 0 ? order.length : i;
}

/** Copia um recorte para o quadro, multiplicando pela cor e misturando pela transparência. */
function blit(
  out: Uint8ClampedArray,
  canvas: FigureCanvas,
  lib: FigureLib,
  rect: { x: number; y: number; w: number; h: number },
  left: number,
  top: number,
  mirror: boolean,
  tint: [number, number, number] | null,
): void {
  const src = lib.pixels;
  for (let y = 0; y < rect.h; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= canvas.height) continue;
    for (let x = 0; x < rect.w; x++) {
      const si = ((rect.y + y) * lib.width + rect.x + x) * 4;
      const alpha = src[si + 3]!;
      if (!alpha) continue;
      const mx = left + x;
      // Espelho em volta do centro do quadro em pé (o mesmo eixo em qualquer tamanho de quadro).
      const dx = mirror ? 2 * canvas.regX + STAND_CANVAS.width - 1 - mx : mx;
      if (dx < 0 || dx >= canvas.width) continue;
      let r = src[si]!;
      let g = src[si + 1]!;
      let b = src[si + 2]!;
      if (tint) {
        r = (r * tint[0]) / 255;
        g = (g * tint[1]) / 255;
        b = (b * tint[2]) / 255;
      }
      const di = (dy * canvas.width + dx) * 4;
      const k = alpha / 255;
      out[di] = r * k + out[di]! * (1 - k);
      out[di + 1] = g * k + out[di + 1]! * (1 - k);
      out[di + 2] = b * k + out[di + 2]! * (1 - k);
      out[di + 3] = Math.min(255, alpha + out[di + 3]! * (1 - k));
    }
  }
}
