import { HABBOASSETS_API, HABBOASSETS_IMAGER, habboApiHeaders } from '@office/shared';
import { TokenBucket } from '../util/rateLimiter.js';

/** A Cloudflare da HabboAssets recusa User-Agents genéricos de script; nos identificamos. */
const USER_AGENT = 'escritorio-virtual/0.1 (projeto pessoal, nao comercial)';
const TIMEOUT_MS = 10_000;

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface HabboAssetsClientOptions {
  apiKey?: string;
  /** Requisições REST por minuto (limite da API: 240). */
  restPerMinute?: number;
  /** Renders do imager por minuto (limite de renders não cacheados: 60/IP). */
  imagerPerMinute?: number;
  fetchFn?: typeof fetch;
}

/**
 * Único ponto do projeto que fala com a HabboAssets. Usa metade dos limites públicos,
 * respeita `Retry-After` em 429 e só envia o token nos endpoints de móveis.
 */
export class HabboAssetsClient {
  private readonly rest: TokenBucket;
  private readonly imager: TokenBucket;
  private readonly fetchFn: typeof fetch;
  /** Serializa a espera por fichas para requisições concorrentes não estourarem o limite. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: HabboAssetsClientOptions = {}) {
    const restPerMin = options.restPerMinute ?? 120;
    const imagerPerMin = options.imagerPerMinute ?? 30;
    this.rest = new TokenBucket(Math.min(20, restPerMin), restPerMin / 60);
    this.imager = new TokenBucket(Math.min(10, imagerPerMin), imagerPerMin / 60);
    this.fetchFn = options.fetchFn ?? fetch;
  }

  get hasApiKey(): boolean {
    return Boolean(this.options.apiKey);
  }

  /** Baixa uma imagem do imager (URL absoluta em www.habboassets.com/imaging). */
  async fetchImage(url: string): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.request(url, this.imager, {
      'User-Agent': USER_AGENT,
      Accept: 'image/png',
    });
    const contentType = res.headers.get('content-type') ?? 'image/png';
    if (!contentType.startsWith('image/'))
      throw new UpstreamError(502, 'Resposta do imager não é imagem');
    return { body: Buffer.from(await res.arrayBuffer()), contentType };
  }

  /** GET de JSON no host do imager (ex. `/info/clothing/hh_human_hair`). */
  async getImagerJson<T>(path: string): Promise<T> {
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
    const res = await this.request(`${HABBOASSETS_IMAGER}${path}`, this.rest, headers);
    return (await res.json()) as T;
  }

  /** GET na API REST v2 (`path` relativo, ex. `/furniture/chair_norja`). */
  async getJson<T>(path: string, opts: { auth?: boolean } = {}): Promise<T> {
    const headers = {
      ...habboApiHeaders(opts.auth ? this.options.apiKey : undefined),
      'User-Agent': USER_AGENT,
    };
    const res = await this.request(`${HABBOASSETS_API}${path}`, this.rest, headers);
    return (await res.json()) as T;
  }

  private acquire(bucket: TokenBucket): Promise<void> {
    const turn = this.queue.then(async () => {
      const wait = bucket.msUntil();
      if (wait > 5_000)
        throw new UpstreamError(503, 'Limite local de requisições à HabboAssets atingido');
      if (wait > 0) await sleep(wait);
      bucket.tryTake();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async request(
    url: string,
    bucket: TokenBucket,
    headers: Record<string, string>,
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.acquire(bucket);

      let res: Response;
      try {
        res = await this.fetchFn(url, {
          headers,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'follow',
        });
      } catch (err) {
        throw new UpstreamError(502, `Falha ao acessar a HabboAssets: ${(err as Error).message}`);
      }
      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '2');
        if (retryAfter <= 10) {
          await sleep(retryAfter * 1000);
          continue;
        }
      }
      if (!res.ok) throw new UpstreamError(res.status, `HabboAssets respondeu ${res.status}`);
      return res;
    }
    throw new UpstreamError(429, 'HabboAssets limitou as requisições (429)');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
