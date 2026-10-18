import type { FigureData } from '@office/shared';
import { AVATAR_CURATION } from './avatarManifest.js';

/** Bibliotecas com as partes do avatar: as do editor mais o rosto (olhos e boca). */
export const FIGURE_LIBRARIES = [
  ...new Set([...AVATAR_CURATION.flatMap((c) => c.libraries), 'hh_human_face']),
];

/** O que o `/imaging/info/clothing/{lib}` devolve e usamos aqui. */
export interface FigureLibInfo {
  library: string;
  latest: string | number;
  figuremap: string;
  figuredata: { json: { type: string; paletteid: number; set: OneOrMany<RawSet> } }[];
  palettes?: Record<string, { id: number; hex: string }[]>;
}
type OneOrMany<T> = T | T[];
interface RawSet {
  id: number;
  part: OneOrMany<{ id: number; type: string; colorable: number; colorindex: number }>;
  hiddenlayers?: { layer: OneOrMany<{ parttype: string }> };
}

const many = <T>(x: OneOrMany<T> | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : []);

/**
 * Junta os dados de montagem das bibliotecas: onde está cada parte, as partes de cada conjunto
 * (com cor e camadas escondidas) e as paletas.
 */
export function buildFigureData(
  infos: readonly FigureLibInfo[],
  swfUrls: Readonly<Record<string, string>>,
): FigureData {
  const data: FigureData = { libs: {}, swf: {}, partLib: {}, sets: {}, palettes: {} };
  const setLib = new Map<string, string>();
  for (const info of infos) {
    data.libs[info.library] = Number(info.latest);
    const swf = swfUrls[info.library];
    if (!swf) throw new Error(`SWF de ${info.library} não encontrado`);
    data.swf[info.library] = swf;
    for (const m of info.figuremap.matchAll(/<part id="(\d+)" type="(\w+)"/g)) {
      // A primeira biblioteca que declara a parte vence (as básicas vêm primeiro).
      data.partLib[`${m[2]}:${m[1]}`] ??= info.library;
    }
    for (const [palette, colors] of Object.entries(info.palettes ?? {})) {
      const into = (data.palettes[palette] ??= {});
      for (const c of colors) into[String(c.id)] = c.hex.toUpperCase();
    }
    for (const fd of info.figuredata) {
      for (const set of many(fd.json.set)) {
        const key = `${fd.json.type}:${set.id}`;
        if (data.sets[key]) continue;
        const hide = many(set.hiddenlayers?.layer).map((l) => l.parttype);
        data.sets[key] = {
          p: fd.json.paletteid,
          parts: many(set.part).map((p) => [
            p.type,
            Number(p.id),
            p.colorable ? 1 : 0,
            Number(p.colorindex) || 1,
          ]),
          ...(hide.length ? { hide } : {}),
        };
        setLib.set(key, info.library);
      }
    }
  }
  // O mapa de partes do Habbo às vezes omite uma parte (ex.: `hrb` de um cabelo cujo `hr`
  // está listado): ela fica na mesma biblioteca das irmãs do conjunto.
  for (const [key, set] of Object.entries(data.sets)) {
    for (const [type, id] of set.parts) {
      const k = `${type}:${id}`;
      if (data.partLib[k]) continue;
      const sibling = set.parts.map(([t, i]) => data.partLib[`${t}:${i}`]).find(Boolean);
      data.partLib[k] = sibling ?? setLib.get(key)!;
    }
  }
  return data;
}
