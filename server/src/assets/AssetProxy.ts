import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  avatarImageUrl,
  clothingSetImageUrl,
  figureSchema,
  HABBOASSETS_CDN,
  SHEET_FORMAT,
  type FigureData,
  furniImageUrl,
  furniSwfUrl,
} from '@office/shared';
import { buildFurniVisual } from './furniVisual.js';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UpstreamError, type HabboAssetsClient } from './HabboAssetsClient.js';
import { buildFigureSheet, parseEffectAnimation, readSwf } from './swfFigure.js';
import { readFileSync, statSync } from 'node:fs';
import { ROOT_DIR } from '../config.js';

/** URLs sem revisão fixada podem mudar; o cache em disco delas expira em 1 dia. */
const UNPINNED_TTL_MS = 24 * 60 * 60 * 1000;
/** Miniaturas de roupa quase nunca mudam: 30 dias. */
const CLOTHING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const dir = z.coerce.number().int().min(0).max(7);
const avatarQuery = z.object({
  figure: figureSchema,
  direction: dir.optional(),
  head_direction: dir.optional(),
  size: z.enum(['n', 'l']).optional(),
});
const furniQuery = z.object({
  direction: dir.optional(),
  color: z.coerce.number().int().min(0).max(99).optional(),
  state: z.coerce.number().int().min(0).max(99).optional(),
  size: z.coerce
    .number()
    .pipe(z.union([z.literal(32), z.literal(64)]))
    .optional(),
  revision: z.coerce.number().int().positive().optional(),
});
const classname = z
  .string()
  .regex(/^[a-z0-9_]+(\*\d{1,2})?$/i)
  .max(80);

/**
 * Proxy com cache em disco para o imager da HabboAssets, servido same-origin em `/hh/*`.
 * Assim só o servidor consome a cota de renders, e cada imagem é baixada uma única vez.
 *
 *   GET /hh/avatar.png?figure=…&direction=…
 *   GET /hh/furniture/{classname}.png?revision=…&direction=…
 */
export function createAssetRouter(
  client: HabboAssetsClient,
  cacheDir: string,
  figureData: () => Pick<FigureData, 'libs' | 'swf' | 'effects'> | null = loadFigureData,
  /** Revisões conhecidas do SWF de um móvel (vazio = móvel desconhecido, não baixa). */
  furniRevisions: (classname: string) => ReadonlySet<number> = () => new Set(),
): Router {
  const router = Router();
  const inflight = new Map<string, Promise<Buffer>>();

  async function serve(
    res: Response,
    upstreamUrl: string,
    pinned: boolean,
    ttlMs = UNPINNED_TTL_MS,
  ): Promise<void> {
    const key = cacheKey(upstreamUrl);
    const file = cacheFileFor(cacheDir, upstreamUrl);
    try {
      let body = await readCached(file, pinned ? Infinity : ttlMs);
      let hit = true;
      if (!body) {
        hit = false;
        let pending = inflight.get(key);
        if (!pending) {
          pending = client
            .fetchImage(upstreamUrl)
            .then((i) => i.body)
            .then(async (body) => {
              await writeAtomic(file, body);
              return body;
            })
            .finally(() => inflight.delete(key));
          inflight.set(key, pending);
        }
        body = await pending;
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Asset-Cache', hit ? 'HIT' : 'MISS');
      res.setHeader(
        'Cache-Control',
        pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      );
      res.end(body);
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : 500;
      res
        .status(status >= 400 && status < 600 ? status : 502)
        .json({ error: (err as Error).message });
    }
  }

  router.get('/avatar.png', (req: Request, res: Response) => {
    const q = avatarQuery.safeParse(req.query);
    if (!q.success) return void res.status(400).json({ error: 'Parâmetros inválidos' });
    const url = avatarImageUrl(q.data.figure, {
      direction: q.data.direction,
      headDirection: q.data.head_direction,
      size: q.data.size,
    });
    // O render de uma figure string não muda: pode ser cacheado para sempre.
    void serve(res, url, true);
  });

  router.get('/furniture/:file', (req: Request, res: Response) => {
    const name = String(req.params.file ?? '').replace(/\.png$/, '');
    const q = furniQuery.safeParse(req.query);
    if (!classname.safeParse(name).success || !q.success) {
      return void res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    const url = furniImageUrl(name, q.data);
    void serve(res, url, q.data.revision !== undefined);
  });

  router.get('/clothing/set/:file', (req: Request, res: Response) => {
    const id = String(req.params.file ?? '').replace(/\.png$/, '');
    const q = z.object({ direction: dir.optional() }).safeParse(req.query);
    if (!/^\d{1,6}$/.test(id) || !q.success)
      return void res.status(400).json({ error: 'Parâmetros inválidos' });
    void serve(res, clothingSetImageUrl(Number(id), q.data), false, CLOTHING_TTL_MS);
  });

  // Bibliotecas de roupa (Fase 31) e efeitos (Fase 34): o SWF original vira folha de sprites +
  // JSON, uma vez só (cache em disco e imutável, pela revisão).
  const sheets = new Map<string, Promise<{ png: Buffer; json: Buffer }>>();
  const sheetFor = (kind: 'figure' | 'effect', lib: string, revision: number, swf: string) => {
    const key = `${kind}-v${SHEET_FORMAT}-${lib}-${revision}`;
    let pending = sheets.get(key);
    if (!pending) {
      const base = join(cacheDir, 'figure', key);
      pending = (async () => {
        const [png, json] = await Promise.all([
          readCached(`${base}.png`, Infinity),
          readCached(`${base}.json`, Infinity),
        ]);
        if (png && json) return { png, json };
        const contents = readSwf(await client.fetchSwf(swf));
        const built = buildFigureSheet(lib, contents);
        const sheet =
          kind === 'effect'
            ? { ...built.sheet, animation: parseEffectAnimation(contents.animation) }
            : built.sheet;
        const out = { png: built.png, json: Buffer.from(JSON.stringify(sheet)) };
        await writeAtomic(`${base}.png`, out.png);
        await writeAtomic(`${base}.json`, out.json);
        return out;
      })();
      pending.catch(() => sheets.delete(key));
      sheets.set(key, pending);
    }
    return pending;
  };
  const sheetRoute = (kind: 'figure' | 'effect') => async (req: Request, res: Response) => {
    const m = /^([A-Za-z0-9_]{1,60})\.(png|json)$/.exec(String(req.params.file ?? ''));
    const revision = z.coerce.number().int().positive().safeParse(req.query.revision);
    const data = figureData();
    const name = m?.[1] ?? '';
    const known =
      kind === 'figure'
        ? data && data.swf[name] && { revision: data.libs[name], swf: data.swf[name] }
        : data?.effects?.[name];
    // Só bibliotecas conhecidas, na revisão dos dados (nada de baixar qualquer coisa da CDN).
    if (!m || !revision.success || !known || known.revision !== revision.data) {
      return void res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    try {
      const sheet = await sheetFor(kind, name, revision.data, known.swf!);
      res.setHeader('Content-Type', m[2] === 'png' ? 'image/png' : 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(m[2] === 'png' ? sheet.png : sheet.json);
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : 502;
      res
        .status(status >= 400 && status < 600 ? status : 502)
        .json({ error: (err as Error).message });
    }
  };
  router.get('/figure/:file', sheetRoute('figure'));

  // Prévia de uma roupa (Fase 35): arquivo estático da CDN, por biblioteca e revisão conhecidas.
  router.get('/clothing/preview/:lib/:file', async (req: Request, res: Response) => {
    const lib = String(req.params.lib ?? '');
    const m = /^set_(\d{1,6})\.png$/.exec(String(req.params.file ?? ''));
    const revision = z.coerce.number().int().positive().safeParse(req.query.revision);
    const data = figureData();
    if (!m || !revision.success || !data?.swf[lib] || data.libs[lib] !== revision.data) {
      return void res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    const url = `${HABBOASSETS_CDN}/derived/clothing/${lib}/${revision.data}/set_${m[1]}.png`;
    const file = cacheFileFor(cacheDir, url);
    try {
      let body = await readCached(file, Infinity);
      if (!body) {
        body = await client.fetchCdnImage(url);
        await writeAtomic(file, body);
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(body);
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : 502;
      res
        .status(status >= 400 && status < 600 ? status : 502)
        .json({ error: (err as Error).message });
    }
  });
  router.get('/effect/:file', sheetRoute('effect'));

  // Móveis por camadas (Fase 37): o SWF do móvel vira folha + dados de desenho e animação.
  const furniSheets = new Map<string, Promise<{ png: Buffer; json: Buffer }>>();
  router.get('/furni/:file', async (req: Request, res: Response) => {
    const m = /^([A-Za-z0-9_.-]{1,80})\.(png|json)$/.exec(String(req.params.file ?? ''));
    const revision = z.coerce.number().int().positive().safeParse(req.query.revision);
    const name = m?.[1] ?? '';
    if (!m || !revision.success || !furniRevisions(name).has(revision.data)) {
      return void res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    const key = `furni-v${SHEET_FORMAT}-${name}-${revision.data}`;
    let pending = furniSheets.get(key);
    if (!pending) {
      const base = join(cacheDir, 'furni', key);
      pending = (async () => {
        const [png, json] = await Promise.all([
          readCached(`${base}.png`, Infinity),
          readCached(`${base}.json`, Infinity),
        ]);
        if (png && json) return { png, json };
        const built = buildFurniVisual(
          name,
          readSwf(await client.fetchSwf(furniSwfUrl(name, revision.data))),
        );
        const out = { png: built.png, json: Buffer.from(JSON.stringify(built.visual)) };
        await writeAtomic(`${base}.png`, out.png);
        await writeAtomic(`${base}.json`, out.json);
        return out;
      })();
      pending.catch(() => furniSheets.delete(key));
      furniSheets.set(key, pending);
    }
    try {
      const sheet = await pending;
      res.setHeader('Content-Type', m[2] === 'png' ? 'image/png' : 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(m[2] === 'png' ? sheet.png : sheet.json);
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : 502;
      res
        .status(status >= 400 && status < 600 ? status : 502)
        .json({ error: (err as Error).message });
    }
  });

  return router;
}

/** `figuredata.json` (em dev em client/public; em produção também copiado para client/dist). */
let figureCache: { mtime: number; data: Pick<FigureData, 'libs' | 'swf' | 'effects'> } | null =
  null;
/** Relê quando o arquivo muda (rodar o `assets:figure` não exige reiniciar o servidor). */
function loadFigureData(): Pick<FigureData, 'libs' | 'swf' | 'effects'> | null {
  for (const dir of ['public', 'dist']) {
    const file = join(ROOT_DIR, 'client', dir, 'assets', 'figure', 'figuredata.json');
    try {
      const mtime = statSync(file).mtimeMs;
      if (figureCache?.mtime !== mtime) {
        figureCache = { mtime, data: JSON.parse(readFileSync(file, 'utf8')) as FigureData };
      }
      return figureCache.data;
    } catch {
      // tenta a próxima
    }
  }
  return null;
}

function cacheKey(upstreamUrl: string): string {
  return createHash('sha256').update(upstreamUrl).digest('hex');
}

/** Caminho do arquivo em cache para uma URL do imager (usado também pelo `assets:sync`). */
export function cacheFileFor(cacheDir: string, upstreamUrl: string): string {
  const key = cacheKey(upstreamUrl);
  return join(cacheDir, key.slice(0, 2), `${key}.png`);
}

async function readCached(file: string, ttlMs: number): Promise<Buffer | null> {
  try {
    if (ttlMs !== Infinity) {
      const s = await stat(file);
      if (Date.now() - s.mtimeMs > ttlMs) return null;
    }
    return await readFile(file);
  } catch {
    return null;
  }
}

export async function writeAtomic(file: string, body: Buffer): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, file);
}
