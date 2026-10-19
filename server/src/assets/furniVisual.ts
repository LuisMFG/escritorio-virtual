import type {
  FurniVisual,
  FurniVisualAnimLayer,
  FurniVisualAsset,
  FurniVisualLayer,
} from '@office/shared';
import { PNG } from 'pngjs';
import { packBitmaps, type SheetCut, type readSwf } from './swfFigure.js';

type SwfContents = ReturnType<typeof readSwf>;

const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}=["']([^"']*)["']`).exec(tag)?.[1];
const num = (tag: string, name: string) => {
  const v = attr(tag, name);
  return v === undefined || v === '' ? undefined : Number(v);
};

/** Corpo de um elemento (`<tag …>corpo</tag>`), ou '' se ele fechar sozinho. */
function blocks(xml: string, tag: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${tag}>)`, 'g');
  for (const m of xml.matchAll(re)) out.push({ attrs: m[1]!, body: m[3] ?? '' });
  return out;
}

/**
 * Lê a visualização de 64 px do móvel (`{classname}_visualization`): camadas, ajustes por direção,
 * animações por estado e cores.
 */
export function parseFurniVisualization(
  xml: string,
): Omit<FurniVisual, 'classname' | 'assets' | 'frames'> {
  const vis = blocks(xml, 'visualization').find((b) => attr(b.attrs, 'size') === '64');
  if (!vis) throw new Error('Móvel sem visualização de 64 px');
  const layerCount = num(vis.attrs, 'layerCount') ?? 1;

  const layers: Record<string, FurniVisualLayer> = {};
  const layersBlock = blocks(vis.body, 'layers')[0]?.body ?? '';
  for (const l of blocks(layersBlock, 'layer')) {
    const id = attr(l.attrs, 'id');
    if (id === undefined) continue;
    const layer: FurniVisualLayer = {};
    const ink = attr(l.attrs, 'ink');
    if (ink === 'ADD') layer.ink = 33;
    const alpha = num(l.attrs, 'alpha');
    if (alpha !== undefined) layer.alpha = alpha;
    if (attr(l.attrs, 'ignoreMouse') === '1') layer.ignoreMouse = 1;
    const z = num(l.attrs, 'z');
    if (z) layer.z = z;
    layers[id] = layer;
  }

  const directions: FurniVisual['directions'] = {};
  const dirBlock = blocks(vis.body, 'directions')[0]?.body ?? '';
  for (const d of blocks(dirBlock, 'direction')) {
    const id = attr(d.attrs, 'id');
    if (id === undefined) continue;
    const per: Record<string, { x?: number; y?: number; z?: number }> = {};
    for (const l of blocks(d.body, 'layer')) {
      const lid = attr(l.attrs, 'id');
      if (lid === undefined) continue;
      const o: { x?: number; y?: number; z?: number } = {};
      for (const k of ['x', 'y', 'z'] as const) {
        const v = num(l.attrs, k);
        if (v) o[k] = v;
      }
      per[lid] = o;
    }
    directions[id] = per;
  }

  const colors: FurniVisual['colors'] = {};
  const colorBlock = blocks(vis.body, 'colors')[0]?.body ?? '';
  for (const c of blocks(colorBlock, 'color')) {
    const id = attr(c.attrs, 'id');
    if (id === undefined) continue;
    const per: Record<string, number> = {};
    for (const l of blocks(c.body, 'colorLayer')) {
      const lid = attr(l.attrs, 'id');
      const hex = attr(l.attrs, 'color');
      if (lid !== undefined && hex) per[lid] = parseInt(hex, 16);
    }
    colors[id] = per;
  }

  const animations: FurniVisual['animations'] = {};
  const animBlock = blocks(vis.body, 'animations')[0]?.body ?? '';
  for (const a of blocks(animBlock, 'animation')) {
    const id = attr(a.attrs, 'id');
    if (id === undefined) continue;
    const per: Record<string, FurniVisualAnimLayer> = {};
    for (const al of blocks(a.body, 'animationLayer')) {
      const lid = attr(al.attrs, 'id');
      if (lid === undefined) continue;
      const layer: FurniVisualAnimLayer = { frames: [] };
      const repeat = num(al.attrs, 'frameRepeat');
      if (repeat && repeat > 1) layer.frameRepeat = repeat;
      const loops = num(al.attrs, 'loopCount');
      if (loops) layer.loopCount = loops;
      if (attr(al.attrs, 'random') === '1') layer.random = 1;
      // Várias sequências viram uma só, em ordem.
      for (const seq of blocks(al.body, 'frameSequence')) {
        if (attr(seq.attrs, 'random') === '1') layer.random = 1;
        for (const f of blocks(seq.body, 'frame')) {
          const frame: { id: number; x?: number; y?: number } = { id: num(f.attrs, 'id') ?? 0 };
          const x = num(f.attrs, 'x');
          const y = num(f.attrs, 'y');
          if (x) frame.x = x;
          if (y) frame.y = y;
          layer.frames.push(frame);
        }
      }
      per[lid] = layer;
    }
    animations[id] = per;
  }
  return { layerCount, layers, directions, animations, colors };
}

/** Lê `{classname}_assets`: deslocamento, apelido e espelhamento de cada asset de 64 px. */
export function parseFurniAssets(xml: string): Record<string, FurniVisualAsset> {
  const out: Record<string, FurniVisualAsset> = {};
  for (const m of xml.matchAll(/<asset\b([^>]*?)\/?>/g)) {
    const tag = m[1]!;
    const name = attr(tag, 'name');
    if (!name || !/_64_/.test(name)) continue;
    const a: FurniVisualAsset = { x: num(tag, 'x') ?? 0, y: num(tag, 'y') ?? 0 };
    const source = attr(tag, 'source');
    if (source) a.source = source;
    if (attr(tag, 'flipH') === '1') a.flip = 1;
    out[name] = a;
  }
  return out;
}

/**
 * Converte o SWF de um móvel na folha de sprites (só as imagens de 64 px, sem cortar, para o
 * espelhamento continuar certo) e nos dados de desenho.
 */
export function buildFurniVisual(
  classname: string,
  swf: SwfContents,
): { visual: FurniVisual; png: Buffer } {
  const visXml = swf.binaries.get(`${classname}_${classname}_visualization`);
  const assetsXml = swf.binaries.get(`${classname}_${classname}_assets`);
  if (!visXml || !assetsXml) throw new Error('SWF de móvel sem visualização');
  const assets = parseFurniAssets(assetsXml);
  const prefix = `${classname}_`;
  const cuts: SheetCut[] = [];
  for (const [cls, img] of swf.bitmaps) {
    if (!cls.startsWith(prefix)) continue;
    const name = cls.slice(prefix.length);
    if (!/_64_/.test(name)) continue;
    cuts.push({ name, img, x0: 0, y0: 0, w: img.width, h: img.height });
  }
  const { png, frames } = packBitmaps(cuts);
  // Apelido de um apelido: aponta direto para a imagem.
  for (const a of Object.values(assets)) {
    if (a.source && !frames[a.source] && assets[a.source]?.source)
      a.source = assets[a.source]!.source;
  }
  const visual: FurniVisual = {
    classname,
    ...parseFurniVisualization(visXml),
    assets,
    frames,
  };
  return { visual, png: PNG.sync.write(png) };
}
