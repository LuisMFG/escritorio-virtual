import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { avatarImageUrl, figureSchema, furniImageUrl } from '@office/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UpstreamError, type HabboAssetsClient } from './HabboAssetsClient.js';

/** URLs sem revisão fixada podem mudar; o cache em disco delas expira em 1 dia. */
const UNPINNED_TTL_MS = 24 * 60 * 60 * 1000;

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
export function createAssetRouter(client: HabboAssetsClient, cacheDir: string): Router {
  const router = Router();
  const inflight = new Map<string, Promise<Buffer>>();

  async function serve(res: Response, upstreamUrl: string, pinned: boolean): Promise<void> {
    const key = createHash('sha256').update(upstreamUrl).digest('hex');
    const file = join(cacheDir, key.slice(0, 2), `${key}.png`);
    try {
      let body = await readCached(file, pinned ? Infinity : UNPINNED_TTL_MS);
      let hit = true;
      if (!body) {
        hit = false;
        let pending = inflight.get(key);
        if (!pending) {
          pending = client
            .fetchImage(upstreamUrl)
            .then(async (img) => {
              await writeAtomic(file, img.body);
              return img.body;
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

  return router;
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

async function writeAtomic(file: string, body: Buffer): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, file);
}
