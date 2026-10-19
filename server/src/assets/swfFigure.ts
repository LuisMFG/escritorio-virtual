import type { EffectAnimation, FigureSheet } from '@office/shared';
import { PNG } from 'pngjs';
import { inflateSync } from 'node:zlib';

/**
 * Converte uma biblioteca de roupa do Habbo (SWF) numa folha de sprites + JSON para montar o
 * avatar no navegador. Usamos o SWF original (e não o `.nitro` derivado) porque o `.nitro`
 * corta as bordas transparentes das imagens sem corrigir os deslocamentos, e as partes saem
 * fora do lugar (cabelos, principalmente).
 */

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA não pré-multiplicado. */
  rgba: Uint8Array;
}

interface SwfContents {
  manifest: string;
  /** Animação dos efeitos (`<animation>`), quando houver. */
  animation: string;
  /** Nome da classe (`hh_human_hair_h_std_hr_1_2_0`) → imagem. */
  bitmaps: Map<string, Bitmap>;
  /** Nome da classe → texto dos dados binários (XMLs dos móveis: `_assets`, `_visualization`…). */
  binaries: Map<string, string>;
  /** Os mesmos dados binários, crus (paletas dos pets). */
  raw: Map<string, Buffer>;
}

/** Lê as tags do SWF que interessam: imagens sem perda, nomes das classes e o manifesto. */
export function readSwf(file: Buffer): SwfContents {
  const sig = file.subarray(0, 3).toString('latin1');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Não é um SWF');
  const body = sig === 'CWS' ? inflateSync(file.subarray(8)) : file.subarray(8);
  const nbits = body[0]! >> 3;
  let p = Math.ceil((5 + nbits * 4) / 8) + 4;
  const images = new Map<number, Bitmap>();
  const texts = new Map<number, string>();
  const raws = new Map<number, Buffer>();
  const names = new Map<string, number>();
  let manifest = '';
  let animation = '';
  while (p + 2 <= body.length) {
    const code = body.readUInt16LE(p);
    p += 2;
    const type = code >> 6;
    let len = code & 0x3f;
    if (len === 0x3f) {
      len = body.readUInt32LE(p);
      p += 4;
    }
    const data = body.subarray(p, p + len);
    p += len;
    if (type === 0) break;
    if (type === 20 || type === 36) {
      const id = data.readUInt16LE(0);
      images.set(id, decodeLossless(data, type === 36));
    } else if (type === 76) {
      // SymbolClass: id → nome da classe.
      const count = data.readUInt16LE(0);
      let q = 2;
      for (let i = 0; i < count; i++) {
        const id = data.readUInt16LE(q);
        q += 2;
        const end = data.indexOf(0, q);
        names.set(data.subarray(q, end).toString('utf8'), id);
        q = end + 1;
      }
    } else if (type === 87) {
      const text = data.subarray(6).toString('utf8');
      texts.set(data.readUInt16LE(0), text);
      raws.set(data.readUInt16LE(0), data.subarray(6));
      if (text.includes('<manifest')) manifest = text;
      else if (text.includes('<animation')) animation = text;
    }
  }
  const bitmaps = new Map<string, Bitmap>();
  const binaries = new Map<string, string>();
  const raw = new Map<string, Buffer>();
  for (const [name, id] of names) {
    const img = images.get(id);
    if (img) bitmaps.set(name, img);
    const text = texts.get(id);
    if (text !== undefined) binaries.set(name, text);
    const bytes = raws.get(id);
    if (bytes) raw.set(name, bytes);
  }
  return { manifest, animation, bitmaps, binaries, raw };
}

/** DefineBitsLossless(2): formato 3 (paleta) ou 5 (32 bits, ARGB pré-multiplicado no 2). */
function decodeLossless(data: Buffer, withAlpha: boolean): Bitmap {
  const format = data[2]!;
  const width = data.readUInt16LE(3);
  const height = data.readUInt16LE(5);
  const rgba = new Uint8Array(width * height * 4);
  if (format === 5) {
    const px = inflateSync(data.subarray(7));
    for (let i = 0; i < width * height; i++) {
      const a = withAlpha ? px[i * 4]! : 255;
      const un = (v: number) =>
        withAlpha && a > 0 && a < 255 ? Math.min(255, Math.round((v * 255) / a)) : v;
      rgba[i * 4] = un(px[i * 4 + 1]!);
      rgba[i * 4 + 1] = un(px[i * 4 + 2]!);
      rgba[i * 4 + 2] = un(px[i * 4 + 3]!);
      rgba[i * 4 + 3] = a;
    }
  } else if (format === 3) {
    const colors = data[7]! + 1;
    const px = inflateSync(data.subarray(8));
    const entry = withAlpha ? 4 : 3;
    const stride = (width + 3) & ~3;
    const table = px.subarray(0, colors * entry);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const k = px[colors * entry + y * stride + x]!;
        const i = (y * width + x) * 4;
        const a = withAlpha ? table[k * 4 + 3]! : 255;
        const un = (v: number) =>
          withAlpha && a > 0 && a < 255 ? Math.min(255, Math.round((v * 255) / a)) : v;
        rgba[i] = un(table[k * entry]!);
        rgba[i + 1] = un(table[k * entry + 1]!);
        rgba[i + 2] = un(table[k * entry + 2]!);
        rgba[i + 3] = a;
      }
  }
  return { width, height, rgba };
}

/**
 * Monta a folha: cada imagem é cortada nas bordas transparentes e o deslocamento é corrigido
 * pelo corte. Apelidos do manifesto (`alias`) viram `source` apontando para a imagem original.
 */
export function buildFigureSheet(
  lib: string,
  swf: SwfContents,
): { sheet: FigureSheet; png: Buffer } {
  const offsets = new Map<string, [number, number]>();
  for (const m of swf.manifest.matchAll(
    // Os manifestos usam aspas simples ou duplas, conforme a biblioteca.
    /<asset name=["']([^"']+)["'][^>]*>\s*<param key=["']offset["'] value=["'](-?\d+),(-?\d+)["']/g,
  )) {
    offsets.set(m[1]!, [Number(m[2]), Number(m[3])]);
  }
  const prefix = `${lib}_`;
  const cuts: SheetCut[] = [];
  for (const [cls, img] of swf.bitmaps) {
    if (!cls.startsWith(prefix)) continue;
    const name = cls.slice(prefix.length);
    if (!offsets.has(name)) continue;
    let x0 = img.width;
    let y0 = img.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        if (!img.rgba[(y * img.width + x) * 4 + 3]) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    if (x1 < 0) continue;
    cuts.push({ name, img, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  const { png, frames } = packBitmaps(cuts);
  const sheet: FigureSheet = { assets: {}, frames };
  for (const c of cuts) {
    const [ox, oy] = offsets.get(c.name)!;
    // O deslocamento do Habbo vale para a imagem inteira; cortando, ele anda junto.
    sheet.assets[c.name] = { x: ox - c.x0, y: oy - c.y0 };
  }
  for (const m of swf.manifest.matchAll(
    /<alias name=["']([^"']+)["'] link=["']([^"']+)["'] fliph=["'](\d)["']/g,
  )) {
    const [, name, link, flip] = m;
    const target = sheet.assets[link!];
    if (!target || flip === '1' || sheet.assets[name!]) continue;
    sheet.assets[name!] = { ...target, source: link };
  }
  return { sheet, png: PNG.sync.write(png) };
}

/** Recorte de uma imagem a colocar na folha. */
export interface SheetCut {
  name: string;
  img: Bitmap;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** Empacota os recortes em prateleiras de até 1024 px de largura (mais altos primeiro). */
export function packBitmaps(cuts: SheetCut[]): {
  png: PNG;
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
} {
  const sorted = [...cuts].sort((a, b) => b.h - a.h);
  const WIDTH = 1024;
  let x = 0;
  let y = 0;
  let shelf = 0;
  const placed: (SheetCut & { px: number; py: number })[] = [];
  for (const c of sorted) {
    if (x + c.w > WIDTH) {
      x = 0;
      y += shelf + 1;
      shelf = 0;
    }
    placed.push({ ...c, px: x, py: y });
    x += c.w + 1;
    shelf = Math.max(shelf, c.h);
  }
  const png = new PNG({ width: WIDTH, height: Math.max(1, y + shelf) });
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const c of placed) {
    for (let yy = 0; yy < c.h; yy++) {
      const from = ((c.y0 + yy) * c.img.width + c.x0) * 4;
      png.data.set(c.img.rgba.subarray(from, from + c.w * 4), ((c.py + yy) * WIDTH + c.px) * 4);
    }
    frames[c.name] = { x: c.px, y: c.py, w: c.w, h: c.h };
  }
  return { png, frames };
}

/**
 * Animação de um efeito do Habbo: camadas (`sprite`: imagem base, brilho aditivo, na frente ou
 * atrás do corpo por direção) e a sequência de quadros (qual quadro de cada camada, com
 * deslocamento opcional).
 */
export function parseEffectAnimation(xml: string): EffectAnimation {
  const attr = (tag: string, name: string) => new RegExp(`${name}=["']([^"']*)["']`).exec(tag)?.[1];
  const sprites: EffectAnimation['sprites'] = [];
  for (const m of xml.matchAll(/<sprite\b([^>]*?)(?:\/>|>([\s\S]*?)<\/sprite>)/g)) {
    const id = attr(m[1]!, 'id');
    const member = attr(m[1]!, 'member');
    if (!id || !member) continue;
    const dz: Record<string, number> = {};
    for (const d of (m[2] ?? '').matchAll(/<direction\b([^>]*)\/?>/g)) {
      const dir = attr(d[1]!, 'id');
      if (dir !== undefined) dz[dir] = Number(attr(d[1]!, 'dz') ?? 0);
    }
    sprites.push({ id, member, ink: Number(attr(m[1]!, 'ink') ?? 0), dz });
  }
  const frames: EffectAnimation['frames'] = [];
  for (const f of xml.matchAll(/<frame\b[^>]*>([\s\S]*?)<\/frame>/g)) {
    const layers: EffectAnimation['frames'][number] = [];
    for (const fx of f[1]!.matchAll(/<fx\b([^>]*)\/?>/g)) {
      const id = attr(fx[1]!, 'id');
      if (!id) continue;
      layers.push({
        id,
        frame: Number(attr(fx[1]!, 'frame') ?? 0),
        dx: Number(attr(fx[1]!, 'dx') ?? 0),
        dy: Number(attr(fx[1]!, 'dy') ?? 0),
      });
    }
    frames.push(layers);
  }
  return { sprites, frames };
}
