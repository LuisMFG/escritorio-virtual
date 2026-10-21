import type { IceServer } from '@office/shared';

/** TURN da Cloudflare (Realtime): id da chave e token de API (`.env`). */
export interface TurnConfig {
  keyId: string;
  apiToken: string;
}

/** Sempre: STUN público da Cloudflare (descobre o endereço; não repassa áudio). */
export const STUN_ONLY: IceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
];

/** Quanto vale cada credencial gerada (s) e quando renovar antes de vencer. */
const TTL_S = 12 * 3600;
const RENEW_MS = 6 * 3600_000;

/**
 * Servidores ICE para as chamadas (Fase 49). Sem configuração, só STUN (funciona entre redes de
 * casa). Com a chave do TURN da Cloudflare, gera credenciais temporárias pela API e guarda por
 * algumas horas (todos os participantes usam as mesmas; o token de API nunca vai ao navegador).
 */
export class TurnService {
  private cached: { servers: IceServer[]; until: number } | null = null;
  private pending: Promise<IceServer[]> | null = null;

  constructor(
    private readonly config: TurnConfig | undefined,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config);
  }

  async iceServers(): Promise<IceServer[]> {
    if (!this.config) return STUN_ONLY;
    if (this.cached && this.cached.until > this.now()) return this.cached.servers;
    this.pending ??= this.generate()
      .then((servers) => {
        this.cached = { servers, until: this.now() + RENEW_MS };
        return servers;
      })
      .catch((err: Error) => {
        console.warn('[turn] sem credenciais da Cloudflare agora:', err.message);
        return STUN_ONLY;
      })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  private async generate(): Promise<IceServer[]> {
    const { keyId, apiToken } = this.config!;
    const res = await this.http(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_S }),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers?: IceServer | IceServer[] };
    const list = Array.isArray(body.iceServers)
      ? body.iceServers
      : body.iceServers
        ? [body.iceServers]
        : [];
    if (!list.some((s) => s.username && s.credential)) throw new Error('resposta sem TURN');
    return [...STUN_ONLY, ...list];
  }
}
