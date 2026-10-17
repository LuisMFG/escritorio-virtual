import type { PetSpecies } from '@office/shared';
import { Texture } from 'pixi.js';

/**
 * Arte própria dos pets, desenhada por código (pixel art 16×12, de perfil virado para a
 * direita; a cena espelha para a esquerda). O imager da HabboAssets não renderiza pets, então
 * não há arquivo de imagem nem licença para registrar.
 *
 * Letras: `b` corpo, `l` claro (barriga/focinho), `d` escuro (orelhas/patas), `e` olho,
 * `n` nariz (ou bico/pés do pintinho), `.` vazio. O contorno é gerado em volta.
 */
export type PetPose = 'stand' | 'walkA' | 'walkB' | 'sit' | 'lie';

interface SpeciesArt {
  stand: string[];
  /** Linhas 9–11 trocadas nos dois quadros da caminhada. */
  walkA: string[];
  walkB: string[];
  sit: string[];
  lie: string[];
  palettes: { b: string; l: string; d: string; n: string }[];
}

const EMPTY = '................';
const pad = (rows: string[]) => [...Array(12 - rows.length).fill(EMPTY), ...rows];

const ART: Record<PetSpecies, SpeciesArt> = {
  dog: {
    stand: [
      EMPTY,
      '...........dd...',
      '..........dbbd..',
      '..........bbeb..',
      '.d........bbbbn.',
      '..d.......bbbl..',
      '..dbbbbbbbbbb...',
      '...bbbbbbbbbb...',
      '...bllllllbbb...',
      '...bb.....bb....',
      '...bb.....bb....',
      '...dd.....dd....',
    ],
    walkA: ['..bb.......bb...', '.bb.........bb..', '.dd.........dd..'],
    walkB: ['....bb...bb.....', '....bb...bb.....', '....dd...dd.....'],
    sit: [
      '..........dd....',
      '.........dbbd...',
      '.........bbeb...',
      '.........bbbbn..',
      '.........bbbl...',
      '.......bbbbb....',
      '......bbbbbb....',
      '.d...bbbbllb....',
      '..d.bbbbbllb....',
      '..dbbbbbbllb....',
      '...bbbbbb.bb....',
      '...ddddd..dd....',
    ],
    lie: pad([
      '...........dd...',
      '..........dbbd..',
      '..........bbeb..',
      '.dd.bbbbbbbbbbn.',
      '...bbbbbbbbbbl..',
      '..ddbbbbbbbbdd..',
    ]),
    palettes: [
      { b: '#b5793f', l: '#e8c59a', d: '#6b4423', n: '#2b1d14' },
      { b: '#e0b25a', l: '#f6e2b0', d: '#a8742c', n: '#3a2a18' },
      { b: '#4b4f58', l: '#c9ccd3', d: '#2b2e35', n: '#111216' },
    ],
  },
  cat: {
    stand: [
      '..........d..d..',
      '.d........bbbb..',
      '.d........bebbl.',
      '..d.......bbbbn.',
      '..d.......lbbl..',
      '...d.....bbbb...',
      '...bbbbbbbbbb...',
      '...bbbbbbbbbb...',
      '...bllllllllb...',
      '...b.b....b.b...',
      '...b.b....b.b...',
      '...d.d....d.d...',
    ],
    walkA: ['..b..b....b..b..', '.b...b....b...b.', '.d...d....d...d.'],
    walkB: ['....bb....bb....', '....bb....bb....', '....dd....dd....'],
    sit: [
      '..........d..d..',
      '..........bbbb..',
      '..........bebbl.',
      '..........bbbbn.',
      '..........lbbl..',
      '.........bbbb...',
      '........bbbbb...',
      '.......bbbllb...',
      '..dd..bbbbllb...',
      '....dbbbbbllb...',
      '.....bbbbbbbb...',
      '.....dddd.d.d...',
    ],
    lie: pad([
      '...........d..d.',
      '...........bbbb.',
      '...........bebbn',
      '..dd.bbbbbbbbbb.',
      '....bbbbbbbbbbl.',
      '....dbbbbbbbbd..',
    ]),
    palettes: [
      { b: '#e8913a', l: '#fbd9b0', d: '#b4601c', n: '#e86a7a' },
      { b: '#9aa0a8', l: '#e3e6ea', d: '#5f656d', n: '#e86a7a' },
      { b: '#3a3a42', l: '#d9d9de', d: '#1c1c20', n: '#e86a7a' },
    ],
  },
  bunny: {
    stand: [
      '...........dd...',
      '...........bd...',
      '..........bbd...',
      '..........bbb...',
      '.........bbbbb..',
      '.........bbebbn.',
      '....bbbbbbbbbb..',
      '...lbbbbbbbbbl..',
      '...lbbbbbbbbb...',
      '....bllllllbb...',
      '....bb....bb....',
      '....dd....dd....',
    ],
    walkA: ['....bllllllbb...', '...bb......bb...', '..dd........dd..'],
    walkB: ['....bllllllbb...', '.....bb..bb.....', '.....dd..dd.....'],
    sit: [
      '..........dd....',
      '..........bd....',
      '.........bbd....',
      '.........bbb....',
      '........bbbbb...',
      '........bbebbn..',
      '......bbbbbbb...',
      '.....lbbbbbbb...',
      '.....lbbbbllb...',
      '......bbbbllb...',
      '......bbbbbbb...',
      '......ddd..dd...',
    ],
    lie: pad([
      '..........dddd..',
      '.........bbbbb..',
      '....bbbbbbbebbn.',
      '...lbbbbbbbbbb..',
      '...ldbbbbbbbbd..',
    ]),
    palettes: [
      { b: '#f2f2f2', l: '#ffd6e0', d: '#c9b8bd', n: '#f08ca0' },
      { b: '#a9825d', l: '#f0dcc4', d: '#6e5237', n: '#f08ca0' },
      { b: '#8d9097', l: '#e6e7ea', d: '#5a5d63', n: '#f08ca0' },
    ],
  },
  chick: {
    stand: pad([
      '..........bbb...',
      '.........bbbbb..',
      '.........bbebbnn',
      '....b....bbbbb..',
      '....bbbbbbbbb...',
      '....bbbbllbbb...',
      '.....bbllllbb...',
      '......bbbbbb....',
      '.......n..n.....',
    ]),
    walkA: ['.....bbllllbb...', '......bbbbbb....', '......n....n....'],
    walkB: ['.....bbllllbb...', '......bbbbbb....', '........nn......'],
    sit: pad([
      '..........bbb...',
      '.........bbbbb..',
      '.........bbebbnn',
      '....bbbbbbbbbb..',
      '....bbbbllllbb..',
      '.....bbbbbbbb...',
    ]),
    lie: pad([
      '..........bbb...',
      '.........bbbbb..',
      '.........bbebbnn',
      '....bbbbbbbbbb..',
      '....bbbbllllbb..',
      '.....bbbbbbbb...',
    ]),
    palettes: [
      { b: '#ffd84a', l: '#fff1a8', d: '#e0a800', n: '#f28c28' },
      { b: '#f7f7f2', l: '#ffffff', d: '#d6d6cc', n: '#f28c28' },
      { b: '#c98b4a', l: '#ecc89a', d: '#8a5a2b', n: '#f28c28' },
    ],
  },
};

/** Tamanho de cada "pixel" da arte na tela. */
export const PET_PIXEL = 3;
const W = 16;
const H = 12;
const OUTLINE = '#1f1a17';
const EYE = '#111111';

function rowsFor(species: PetSpecies, pose: PetPose): string[] {
  const art = ART[species];
  if (pose === 'walkA' || pose === 'walkB') return [...art.stand.slice(0, 9), ...art[pose]];
  return art[pose];
}

const cache = new Map<string, Texture>();

/** Textura de um pet numa pose (cacheada). Pés no meio da borda de baixo. */
export function petTexture(species: PetSpecies, color: number, pose: PetPose): Texture {
  const key = `${species}:${color}:${pose}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const art = ART[species];
  const pal = art.palettes[color] ?? art.palettes[0]!;
  const rows = rowsFor(species, pose);
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && rows[y]![x] !== '.';
  // 1 pixel de folga em volta para o contorno.
  const canvas = document.createElement('canvas');
  canvas.width = (W + 2) * PET_PIXEL;
  canvas.height = (H + 2) * PET_PIXEL;
  const ctx = canvas.getContext('2d')!;
  const put = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect((x + 1) * PET_PIXEL, (y + 1) * PET_PIXEL, PET_PIXEL, PET_PIXEL);
  };
  for (let y = -1; y <= H; y++) {
    for (let x = -1; x <= W; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
        put(x, y, OUTLINE);
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y]![x]!;
      if (ch === '.') continue;
      // Deitado: olhos fechados (cochilando).
      const c =
        ch === 'e' ? (pose === 'lie' ? pal.d : EYE) : (pal[ch as 'b' | 'l' | 'd' | 'n'] ?? pal.b);
      put(x, y, c);
    }
  }
  const tex = Texture.from({ resource: canvas, scaleMode: 'nearest' });
  cache.set(key, tex);
  return tex;
}

/** Miniatura (para o perfil): canvas com o pet em pé, ampliado. */
export function petPreview(species: PetSpecies, color: number, scale = 3): HTMLCanvasElement {
  const src = petTexture(species, color, 'stand').source.resource as HTMLCanvasElement;
  const out = document.createElement('canvas');
  out.width = src.width * scale;
  out.height = src.height * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

export const PET_SWATCH = (species: PetSpecies, color: number) =>
  ART[species].palettes[color]?.b ?? '#888';
