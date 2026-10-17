import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Application, type Request, type Response } from 'express';
import { createAssetRouter } from '../assets/AssetProxy.js';
import { HabboAssetsClient } from '../assets/HabboAssetsClient.js';
import type { Config } from '../config.js';
import type { Services } from '../services/index.js';
import { KeyedRateLimiter } from '../util/rateLimiter.js';
import { getBearerToken } from '@colyseus/core';
import type { PresenceResponse } from '@office/shared';
import * as admin from './admin.js';
import * as roomRoutes from './rooms.js';
import * as meetingRoutes from './meetings.js';
import * as petRoutes from './pets.js';
import {
  changePassword,
  claim,
  login,
  logout,
  me,
  register,
  team,
  updateProfile,
  type Caller,
  type Result,
} from './auth.js';

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

  const auth: meetingRoutes.MeetingDeps & petRoutes.PetDeps = {
    inviteCode: () => svc.settings.inviteCode(),
    adminUsernames: cfg.adminUsernames,
    avatarManifest: svc.avatarManifest,
    users: svc.users,
    presence: svc.presence,
    audit: svc.audit,
    settings: svc.settings,
    rooms: svc.rooms,
    moderation: svc.moderation,
    furni: svc.furni,
    furniDefs: svc.furniDefs,
    meetings: svc.meetings,
    pets: svc.pets,
  };
  const send = <T>(res: Response, result: Result<T>) =>
    void res.status(result.status).json(result.body);

  // 10 tentativas de entrada/cadastro por minuto por IP: evita adivinhar convite e senhas.
  const loginLimiter = new KeyedRateLimiter(10, 10 / 60);
  const limited = (req: Request, res: Response): boolean => {
    if (loginLimiter.tryTake(req.ip ?? 'desconhecido')) return false;
    res.status(429).json({ error: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde um minuto.' });
    return true;
  };
  app.post('/api/register', async (req, res) => {
    if (!limited(req, res)) send(res, await register(req.body, auth));
  });
  app.post('/api/login', async (req, res) => {
    if (!limited(req, res)) send(res, await login(req.body, auth));
  });

  /** Rotas que exigem sessão: `Authorization: Bearer <token>`. */
  const withCaller =
    (handler: (caller: Caller, req: Request, res: Response) => unknown) =>
    async (req: Request, res: Response) => {
      const token = getBearerToken(req.headers.authorization ?? '');
      const user = svc.users.findByToken(token);
      res.setHeader('Cache-Control', 'no-store');
      if (!user || !token) {
        return void res.status(401).json({ error: 'INVALID_SESSION', message: 'Sessão inválida.' });
      }
      await handler({ user, token }, req, res);
    };

  app.get(
    '/api/me',
    withCaller((c, _req, res) => send(res, me(c, auth))),
  );
  app.patch(
    '/api/me',
    withCaller((c, req, res) => send(res, updateProfile(c, req.body, auth))),
  );
  app.post(
    '/api/me/claim',
    withCaller(async (c, req, res) => {
      if (!limited(req, res)) send(res, await claim(c, req.body, auth));
    }),
  );
  app.post(
    '/api/me/password',
    withCaller(async (c, req, res) => {
      if (!limited(req, res)) send(res, await changePassword(c, req.body, auth));
    }),
  );
  app.post(
    '/api/logout',
    withCaller((c, req, res) => send(res, logout(c, req.body?.all === true, auth))),
  );
  app.get(
    '/api/team',
    withCaller((_c, _req, res) => send(res, team(auth))),
  );
  app.put(
    '/api/users/:id/cargo',
    withCaller((c, req, res) =>
      send(res, admin.assignCargo(c, String(req.params.id), req.body, auth)),
    ),
  );

  // Painel Admin (cada função confere se quem chama é admin).
  const id = (req: Request) => String(req.params.id);
  app.get(
    '/api/admin',
    withCaller((c, _req, res) => send(res, admin.overview(c, auth))),
  );
  app.get(
    '/api/admin/audit',
    withCaller((c, _req, res) => send(res, admin.auditList(c, auth))),
  );
  app.put(
    '/api/admin/invite',
    withCaller((c, req, res) => send(res, admin.setInvite(c, req.body, auth))),
  );
  app.put(
    '/api/admin/rooms/:id',
    withCaller((c, req, res) => send(res, admin.setRoom(c, id(req), req.body, auth))),
  );
  app.patch(
    '/api/admin/users/:id',
    withCaller((c, req, res) => send(res, admin.updateUser(c, id(req), req.body, auth))),
  );
  app.post(
    '/api/admin/users/:id/password',
    withCaller(async (c, req, res) => send(res, await admin.resetPassword(c, id(req), auth))),
  );
  app.post(
    '/api/admin/users/:id/kick',
    withCaller((c, req, res) => send(res, admin.kick(c, id(req), req.body, auth))),
  );
  app.post(
    '/api/admin/cargos',
    withCaller((c, req, res) => send(res, admin.createCargo(c, req.body, auth))),
  );
  app.put(
    '/api/admin/cargos/order',
    withCaller((c, req, res) => send(res, admin.reorderCargos(c, req.body, auth))),
  );
  app.patch(
    '/api/admin/cargos/:id',
    withCaller((c, req, res) => send(res, admin.updateCargo(c, Number(id(req)), req.body, auth))),
  );
  // Agenda de reuniões.
  app.get(
    '/api/meetings',
    withCaller((_c, req, res) => send(res, meetingRoutes.listMeetings(req.query, auth))),
  );
  app.post(
    '/api/meetings',
    withCaller((c, req, res) => send(res, meetingRoutes.createMeeting(c, req.body, auth))),
  );
  app.put(
    '/api/meetings/:id/response',
    withCaller((c, req, res) =>
      send(res, meetingRoutes.respondMeeting(c, Number(id(req)), req.body, auth)),
    ),
  );
  app.delete(
    '/api/meetings/:id',
    withCaller((c, req, res) => send(res, meetingRoutes.cancelMeeting(c, Number(id(req)), auth))),
  );

  // Pet de cada pessoa.
  app.get(
    '/api/pets/me',
    withCaller((c, _req, res) => send(res, petRoutes.getMyPet(c, auth))),
  );
  app.put(
    '/api/pets/me',
    withCaller((c, req, res) => send(res, petRoutes.saveMyPet(c, req.body, auth))),
  );
  app.delete(
    '/api/pets/me',
    withCaller((c, _req, res) => send(res, petRoutes.releaseMyPet(c, auth))),
  );

  // Salas (admins e quem pode editar salas).
  app.get(
    '/api/rooms',
    withCaller((_c, _req, res) => send(res, roomRoutes.listRooms(auth))),
  );
  app.get(
    '/api/rooms/:id',
    withCaller((c, req, res) => send(res, roomRoutes.getRoom(c, id(req), auth))),
  );
  app.post(
    '/api/rooms',
    withCaller((c, req, res) => send(res, roomRoutes.createRoom(c, req.body, auth))),
  );
  app.put(
    '/api/rooms/:id',
    withCaller((c, req, res) => send(res, roomRoutes.updateRoom(c, id(req), req.body, auth))),
  );
  app.delete(
    '/api/rooms/:id',
    withCaller((c, req, res) => send(res, roomRoutes.deleteRoom(c, id(req), auth))),
  );
  app.delete(
    '/api/admin/cargos/:id',
    withCaller((c, req, res) => send(res, admin.deleteCargo(c, Number(id(req)), auth))),
  );

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
