import type { LinkPreview } from '@office/shared';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/** Redes internas: a prévia nunca busca nelas (evita usar o servidor para olhar a rede da VM). */
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv6');
}

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return PRIVATE.check(mapped[1]!, 'ipv4');
  const v = isIP(ip);
  if (v === 4) return PRIVATE.check(ip, 'ipv4');
  if (v === 6) return PRIVATE.check(ip, 'ipv6');
  return true;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;
const CACHE_MS = 60 * 60_000;

/** Busca um endereço depois de conferir que todos os IPs dele são públicos (e fixa o IP conferido). */
export type SafeGet = (
  url: URL,
) => Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>;

export const safeGet: SafeGet = async (url) => {
  const addrs = await lookup(url.hostname, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Endereço interno não é permitido.');
  }
  const pinned = addrs[0]!;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(
      url,
      {
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': 'EscritorioVirtual/1.0 (previa de link)', Accept: 'text/html' },
        // Usa o IP já conferido (sem uma segunda consulta de DNS que poderia mudar de resposta).
        lookup: (_host, _opts, cb) => cb(null, pinned.address, pinned.family),
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('close', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('Demorou demais.')));
    req.on('error', reject);
  });
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};
function decode(s: string): string {
  return s
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code =
          e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Título, descrição e nome do site a partir do HTML (Open Graph primeiro). */
export function parsePreview(url: string, html: string): LinkPreview {
  const head = html.slice(0, 200_000);
  const meta = (key: string) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      'i',
    );
    const m = re.exec(head);
    return decode(m?.[1] ?? m?.[2] ?? '');
  };
  const title = meta('og:title') || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ?? '');
  return {
    url,
    title: title.slice(0, 160),
    description: (meta('og:description') || meta('description')).slice(0, 240),
    site: (meta('og:site_name') || new URL(url).hostname.replace(/^www\./, '')).slice(0, 60),
  };
}

/** Prévia de links com cache de 1 h (e sem buscar endereços internos). */
export class LinkPreviewService {
  private readonly cache = new Map<string, { at: number; value: LinkPreview | null }>();

  constructor(
    private readonly get: SafeGet = safeGet,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async preview(raw: string): Promise<LinkPreview | null> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const hit = this.cache.get(url.href);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.value;
    let value: LinkPreview | null = null;
    try {
      let current = url;
      for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const res = await this.get(current);
        if (res.status >= 300 && res.status < 400 && res.headers.location) {
          current = new URL(res.headers.location, current);
          if (current.protocol !== 'http:' && current.protocol !== 'https:') break;
          continue;
        }
        const type = String(res.headers['content-type'] ?? '');
        if (res.status === 200 && type.includes('text/html'))
          value = parsePreview(url.href, res.body);
        break;
      }
    } catch {
      value = null;
    }
    if (value && !value.title) value = null;
    this.cache.set(url.href, { at: this.now(), value });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}
