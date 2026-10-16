import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Application } from 'express';
import { createAssetRouter } from '../assets/AssetProxy.js';
import { HabboAssetsClient } from '../assets/HabboAssetsClient.js';
import type { Config } from '../config.js';
import type { Services } from '../services/index.js';
import { KeyedRateLimiter } from '../util/rateLimiter.js';
import { getBearerToken } from '@colyseus/core';
import type { PresenceResponse } from '@office/shared';
import { createSession } from './session.js';

/**
 * Política de conteúdo em produção: tudo da própria origem, mais as imagens da HabboAssets
 * (o cliente cai para o imager direto se o proxy falhar). Estilos inline são usados nas
 * amostras de cor do editor; scripts só os do build.
 */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://www.habboassets.com https://cdn.habboassets.com",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Rotas HTTP: sessão, proxy de assets, healthcheck e (em produção) o cliente compilado. */
export function configureApp(app: Application, cfg: Config, svc: Services): void {
  app.disable('x-powered-by');
  // Atrás de um proxy reverso (Caddy/Nginx/Fly), o IP real vem do X-Forwarded-For.
  app.set('trust proxy', cfg.isProduction ? 1 : 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (cfg.isProduction) res.setHeader('Content-Security-Policy', CSP);
    next();
  });
  app.use('/api', express.json({ limit: '16kb' }));

  // 10 tentativas de entrada por minuto por IP: evita adivinhar o código de convite.
  const sessionLimiter = new KeyedRateLimiter(10, 10 / 60);
  app.post('/api/session', (req, res) => {
    if (!sessionLimiter.tryTake(req.ip ?? 'desconhecido')) {
      return void res
        .status(429)
        .json({ error: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde um minuto.' });
    }
    const result = createSession(req.body, {
      inviteCode: cfg.inviteCode,
      avatarManifest: svc.avatarManifest,
      users: svc.users,
      presence: svc.presence,
    });
    res.status(result.status).json(result.body);
  });

  app.get('/healthz', (_req, res) => void res.json({ ok: true }));

  // Quem está em cada sala (para a lista de pessoas). Só para quem tem sessão válida.
  app.get('/api/presence', (req, res) => {
    if (!svc.users.findByToken(getBearerToken(req.headers.authorization ?? ''))) {
      return void res.status(401).json({ error: 'INVALID_SESSION', message: 'Sessão inválida.' });
    }
    const online = svc.presence.list();
    const body: PresenceResponse = {
      rooms: svc.rooms.list().map((r) => ({
        roomId: r.id,
        name: r.name,
        people: online.filter((e) => e.roomId === r.id).map((e) => ({ name: e.name })),
      })),
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  const habbo = new HabboAssetsClient({ apiKey: cfg.habboAssetsApiKey });
  app.use('/hh', createAssetRouter(habbo, cfg.assetCacheDir));

  if (cfg.isProduction && existsSync(cfg.clientDistDir)) {
    app.use(express.static(cfg.clientDistDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(join(cfg.clientDistDir, 'index.html')));
  }
}
