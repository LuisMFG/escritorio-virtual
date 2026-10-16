import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Application } from 'express';
import { createAssetRouter } from '../assets/AssetProxy.js';
import { HabboAssetsClient } from '../assets/HabboAssetsClient.js';
import type { Config } from '../config.js';
import type { Services } from '../services/index.js';
import { KeyedRateLimiter } from '../util/rateLimiter.js';
import { createSession } from './session.js';

/** Rotas HTTP: sessão, proxy de assets, healthcheck e (em produção) o cliente compilado. */
export function configureApp(app: Application, cfg: Config, svc: Services): void {
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
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

  const habbo = new HabboAssetsClient({ apiKey: cfg.habboAssetsApiKey });
  app.use('/hh', createAssetRouter(habbo, cfg.assetCacheDir));

  if (cfg.isProduction && existsSync(cfg.clientDistDir)) {
    app.use(express.static(cfg.clientDistDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(join(cfg.clientDistDir, 'index.html')));
  }
}
