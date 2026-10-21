import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';

/** Capa guardada por um mês (a do YouTube quase nunca muda). */
const MAX_AGE_S = 30 * 24 * 3600;
/** Capas maiores que isso não são do YouTube. */
const MAX_BYTES = 512 * 1024;

/**
 * Capas dos vídeos da TV (Fase 51), servidas pela própria origem: `GET /api/tv/thumb/{id}.jpg`.
 * Assim a tela da TV na sala pode desenhar a capa (o navegador não deixa usar imagem de outro
 * site num canvas sem CORS) e a política de conteúdo continua só com `'self'` para imagens.
 */
export function createTvThumbRouter(
  cacheDir: string,
  opts: { offline?: boolean; fetchFn?: typeof fetch } = {},
): Router {
  const fetchFn = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const dir = join(cacheDir, 'tv');
  const router = Router();
  router.get('/api/tv/thumb/:file', async (req: Request, res: Response) => {
    const m = /^([\w-]{11})\.jpg$/.exec(String(req.params.file));
    if (!m) return void res.status(400).end();
    const id = m[1]!;
    const file = join(dir, `${id}.jpg`);
    const send = (body: Buffer) => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', `public, max-age=${MAX_AGE_S}, immutable`);
      res.end(body);
    };
    try {
      if (existsSync(file)) return send(await readFile(file));
      if (opts.offline) return void res.status(404).end();
      const up = await fetchFn(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, {
        signal: AbortSignal.timeout(5000),
      });
      const type = up.headers.get('content-type') ?? '';
      if (!up.ok || !type.startsWith('image/')) return void res.status(404).end();
      const body = Buffer.from(await up.arrayBuffer());
      if (body.length > MAX_BYTES) return void res.status(502).end();
      await mkdir(dir, { recursive: true });
      await writeFile(file, body);
      send(body);
    } catch {
      if (!res.headersSent) res.status(502).end();
    }
  });
  return router;
}
