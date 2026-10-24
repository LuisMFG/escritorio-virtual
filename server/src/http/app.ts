import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Application, type Request, type Response } from 'express';
import { createAssetRouter } from '../assets/AssetProxy.js';
import { HabboAssetsClient } from '../assets/HabboAssetsClient.js';
import { createTvThumbRouter } from './tvThumbs.js';
import type { Config } from '../config.js';
import type { Services } from '../services/index.js';
import { KeyedRateLimiter } from '../util/rateLimiter.js';
import { getBearerToken } from '@colyseus/core';
import type { PresenceResponse } from '@office/shared';
import * as admin from './admin.js';
import * as roomRoutes from './rooms.js';
import * as meetingRoutes from './meetings.js';
import * as petRoutes from './pets.js';
import * as achievementRoutes from './achievements.js';
import * as activityRoutes from './activity.js';
import * as spotifyRoutes from './spotify.js';
import * as announcementRoutes from './announcements.js';
import * as kudosRoutes from './kudos.js';
import * as mapRoutes from './map.js';
import * as uploadRoutes from './uploads.js';
import * as jiraRoutes from './jira.js';
import * as effectRoutes from './effects.js';
import * as lookRoutes from './looks.js';
import * as furniRoutes from './furni.js';
import * as teleportRoutes from './teleports.js';
import { UPLOAD_MAX_BYTES } from '@office/shared';
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
 * amostras de cor do editor; scripts só os do build e o player do YouTube da TV.
 */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://www.habboassets.com https://cdn.habboassets.com",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // TV com YouTube (Fase 51): a API do player e o próprio player (num iframe). O desfoque de
  // fundo da chamada roda o modelo de recorte em WebAssembly (só compilar, sem eval de JS).
  "script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com https://s.ytimg.com",
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
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
    // Chamadas (Fase 49): microfone, câmera e captura de tela só para o próprio site.
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
    );
    if (cfg.isProduction) res.setHeader('Content-Security-Policy', CSP);
    next();
  });
  app.use('/api', express.json({ limit: '16kb' }));

  const auth: meetingRoutes.MeetingDeps &
    petRoutes.PetDeps &
    achievementRoutes.AchievementDeps &
    activityRoutes.ActivityDeps &
    spotifyRoutes.SpotifyDeps &
    announcementRoutes.AnnouncementDeps &
    kudosRoutes.KudosDeps &
    uploadRoutes.UploadDeps &
    jiraRoutes.JiraDeps &
    effectRoutes.EffectDeps &
    lookRoutes.LookDeps &
    furniRoutes.FurniDeps &
    teleportRoutes.TeleportDeps = {
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
    furniCatalog: svc.furniCatalog,
    meetings: svc.meetings,
    pets: svc.pets,
    achievements: svc.achievements,
    apiTokens: svc.apiTokens,
    activity: svc.activity,
    spotify: svc.spotify,
    spotifyPoller: svc.spotifyPoller,
    backups: svc.backups,
    announcements: svc.announcements,
    kudos: svc.kudos,
    uploads: svc.uploads,
    linkPreviews: svc.linkPreviews,
    search: svc.search,
    jira: svc.jira,
    jiraPoller: svc.jiraPoller,
    db: svc.db,
  };
  const send = <T>(res: Response, result: Result<T>) =>
    void res.status(result.status).json(result.body);

  // LOGIN_RATE_LIMIT (padrão 10) tentativas de entrada/cadastro por minuto por IP: evita adivinhar
  // convite e senhas.
  const loginLimiter = new KeyedRateLimiter(cfg.loginRateLimit, cfg.loginRateLimit / 60);
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

  // Conquistas e emblemas exibidos.
  app.get(
    '/api/achievements/me',
    withCaller((c, _req, res) => send(res, achievementRoutes.myAchievements(c, auth))),
  );
  app.put(
    '/api/achievements/showcase',
    withCaller((c, req, res) => send(res, achievementRoutes.setShowcase(c, req.body, auth))),
  );

  // Atividade (integrações): privacidade, tokens pessoais e o sinal das extensões dos editores.
  app.get(
    '/api/activity/settings',
    withCaller((c, _req, res) => send(res, activityRoutes.getSettings(c, auth))),
  );
  app.put(
    '/api/activity/settings',
    withCaller((c, req, res) => send(res, activityRoutes.setCodeShare(c, req.body, auth))),
  );
  app.post(
    '/api/activity/tokens',
    withCaller((c, req, res) => send(res, activityRoutes.createToken(c, req.body, auth))),
  );
  app.delete(
    '/api/activity/tokens/:id',
    withCaller((c, req, res) => send(res, activityRoutes.revokeToken(c, Number(id(req)), auth))),
  );
  // Um sinal por minuto por extensão; folga para várias janelas e editores.
  const heartbeatLimiter = new KeyedRateLimiter(20, 20 / 60);
  app.post('/api/activity/editor', (req, res) => {
    const token = getBearerToken(req.headers.authorization ?? '');
    if (!heartbeatLimiter.tryTake(token || req.ip || '?')) {
      return void res.status(429).json({ error: 'RATE_LIMIT', message: 'Muitos sinais.' });
    }
    send(res, activityRoutes.editorHeartbeat(token, req.body, auth));
  });

  // Spotify: ligar a conta (OAuth com PKCE), esconder a música e desconectar.
  app.get(
    '/api/spotify/status',
    withCaller((c, _req, res) => send(res, spotifyRoutes.spotifyStatus(c, auth))),
  );
  app.post(
    '/api/spotify/connect',
    withCaller((c, _req, res) => send(res, spotifyRoutes.spotifyConnect(c, auth))),
  );
  app.get('/api/spotify/callback', async (req, res) => {
    res.redirect(await spotifyRoutes.spotifyCallback(req.query, auth));
  });
  app.put(
    '/api/spotify/settings',
    withCaller((c, req, res) => send(res, spotifyRoutes.spotifySettings(c, req.body, auth))),
  );
  app.delete(
    '/api/spotify',
    withCaller((c, _req, res) => send(res, spotifyRoutes.spotifyDisconnect(c, auth))),
  );

  // Avisos da diretoria: todos leem; só admins publicam e apagam.
  app.get(
    '/api/announcements',
    withCaller((c, _req, res) => send(res, announcementRoutes.listAnnouncements(c, auth))),
  );
  app.get(
    '/api/announcements/unread',
    withCaller((c, _req, res) => send(res, announcementRoutes.unreadAnnouncements(c, auth))),
  );
  app.post(
    '/api/announcements',
    withCaller((c, req, res) =>
      send(res, announcementRoutes.createAnnouncement(c, req.body, auth)),
    ),
  );
  app.put(
    '/api/announcements/:id/read',
    withCaller((c, req, res) =>
      send(res, announcementRoutes.readAnnouncement(c, Number(id(req)), auth)),
    ),
  );
  app.delete(
    '/api/announcements/:id',
    withCaller((c, req, res) =>
      send(res, announcementRoutes.deleteAnnouncement(c, Number(id(req)), auth)),
    ),
  );

  // Minimapa: salas e portas.
  app.get(
    '/api/map',
    withCaller((c, _req, res) => send(res, mapRoutes.officeMap(c, auth))),
  );

  // Elogios entre colegas.
  app.get(
    '/api/kudos',
    withCaller((c, req, res) => send(res, kudosRoutes.kudosWall(c, req.query, auth))),
  );
  app.post(
    '/api/kudos',
    withCaller((c, req, res) => send(res, kudosRoutes.giveKudos(c, req.body, auth))),
  );

  // Anexos do chat: envio (corpo cru até 10 MB), download só para quem pode ver a mensagem.
  const uploadLimiter = new KeyedRateLimiter(10, 10 / 60);
  app.post(
    '/api/uploads',
    // Confere a sessão antes de ler os 10 MB do corpo.
    (req, res, next) => {
      if (svc.users.findByToken(getBearerToken(req.headers.authorization ?? ''))) return next();
      res.status(401).json({ error: 'INVALID_SESSION', message: 'Sessão inválida.' });
    },
    express.raw({ type: () => true, limit: UPLOAD_MAX_BYTES }),
    withCaller((c, req, res) => {
      if (!uploadLimiter.tryTake(c.user.id)) {
        return void res
          .status(429)
          .json({ error: 'RATE_LIMIT', message: 'Muitos envios. Aguarde um pouco.' });
      }
      send(
        res,
        uploadRoutes.uploadFile(c, req.get('x-file-name'), req.get('content-type'), req.body, auth),
      );
    }),
  );
  app.get(
    '/api/uploads/:id',
    withCaller((c, req, res) => {
      const file = uploadRoutes.uploadFor(c, id(req), auth);
      if (!file.ok) return send(res, file);
      const { path, name, mime, image } = file.body;
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=86400');
      // Imagens aparecem no chat; o resto sempre baixa (nunca abre como página).
      res.attachment(name);
      if (image)
        res.setHeader(
          'Content-Disposition',
          res.get('Content-Disposition')!.replace(/^attachment/, 'inline'),
        );
      res.sendFile(path);
    }),
  );
  const previewLimiter = new KeyedRateLimiter(30, 30 / 60);
  app.get(
    '/api/link-preview',
    withCaller(async (c, req, res) => {
      if (!previewLimiter.tryTake(c.user.id))
        return void res.status(429).json({ error: 'RATE_LIMIT', message: 'Aguarde.' });
      send(res, await uploadRoutes.linkPreview(c, req.query, auth));
    }),
  );
  app.get(
    '/api/search',
    withCaller((c, req, res) => send(res, uploadRoutes.searchChat(c, req.query, auth))),
  );

  // Jira Cloud: cada pessoa liga a conta (e-mail + token de API); o quadro junta as demandas.
  const jiraLimiter = new KeyedRateLimiter(5, 5 / 60);
  app.get(
    '/api/jira/status',
    withCaller((c, _req, res) => send(res, jiraRoutes.jiraStatus(c, auth))),
  );
  app.post(
    '/api/jira/connect',
    withCaller(async (c, req, res) => {
      if (!jiraLimiter.tryTake(c.user.id)) {
        return void res
          .status(429)
          .json({ error: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde um minuto.' });
      }
      send(res, await jiraRoutes.jiraConnect(c, req.body, auth));
    }),
  );
  app.put(
    '/api/jira/settings',
    withCaller((c, req, res) => send(res, jiraRoutes.jiraSettings(c, req.body, auth))),
  );
  app.delete(
    '/api/jira',
    withCaller((c, _req, res) => send(res, jiraRoutes.jiraDisconnect(c, auth))),
  );
  app.get(
    '/api/jira/board',
    withCaller((c, _req, res) => send(res, jiraRoutes.jiraBoard(c, auth))),
  );
  app.put(
    '/api/admin/jira',
    withCaller((c, req, res) => send(res, admin.setJiraSite(c, req.body, auth))),
  );

  // Catálogo completo de móveis (Fase 36): definições medidas na primeira vez que alguém usa.
  // Medir custa ~4 imagens no imager: 20 móveis novos por minuto por pessoa.
  const furniLimiter = new KeyedRateLimiter(20, 20 / 60);
  app.get(
    '/api/furni/config',
    withCaller((_c, _req, res) => send(res, furniRoutes.furniConfig(auth))),
  );
  app.get(
    '/api/furni/defs',
    withCaller((_c, _req, res) => send(res, furniRoutes.measuredDefs(auth))),
  );
  app.get(
    '/api/furni/defs/:id',
    withCaller(async (c, req, res) => {
      const defId = String(req.params.id).slice(0, 80);
      if (!svc.furniDefs.has(defId) && !furniLimiter.tryTake(c.user.id)) {
        return void res.status(429).json({
          error: 'RATE_LIMIT',
          message: 'Muitos móveis novos de uma vez. Aguarde um pouco.',
        });
      }
      send(res, await furniRoutes.furniDef(defId, auth));
    }),
  );
  // Teleportes (Fase 37): ligar dois teleportes, mesmo em salas diferentes.
  app.get(
    '/api/teleports',
    withCaller((_c, _req, res) => send(res, teleportRoutes.listTeleports(auth))),
  );
  app.put(
    '/api/teleports/:id/link',
    withCaller((c, req, res) =>
      send(res, teleportRoutes.linkTeleport(c, String(req.params.id), req.body, auth)),
    ),
  );
  app.put(
    '/api/admin/furni-categories',
    withCaller((c, req, res) => send(res, furniRoutes.setHiddenCategories(c, req.body, auth))),
  );

  // Efeitos (Fase 34): os liberados e o que a pessoa usa.
  app.get(
    '/api/effects',
    withCaller((c, _req, res) => send(res, effectRoutes.myEffects(c, auth))),
  );
  app.put(
    '/api/effects',
    withCaller((c, req, res) => send(res, effectRoutes.setEffect(c, req.body, auth))),
  );

  // Looks salvos (Fase 35): até 5 visuais por pessoa.
  app.get(
    '/api/looks',
    withCaller((c, _req, res) => send(res, lookRoutes.myLooks(c, auth))),
  );
  app.put(
    '/api/looks/:slot',
    withCaller((c, req, res) =>
      send(res, lookRoutes.saveLook(c, Number(req.params.slot), req.body, auth)),
    ),
  );
  app.delete(
    '/api/looks/:slot',
    withCaller((c, req, res) => send(res, lookRoutes.deleteLook(c, Number(req.params.slot), auth))),
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
  // Backups do banco (só admin).
  app.get(
    '/api/admin/backups',
    withCaller((c, _req, res) => send(res, admin.listBackups(c, auth))),
  );
  app.post(
    '/api/admin/backups',
    withCaller(async (c, _req, res) => send(res, await admin.createBackup(c, auth))),
  );
  app.get(
    '/api/admin/backups/:name',
    withCaller((c, req, res) => {
      const file = admin.backupFile(c, String(req.params.name), auth);
      if (!file.ok) return send(res, file);
      res.download(file.body);
    }),
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

  // Capas dos vídeos da TV (Fase 51).
  app.use(createTvThumbRouter(cfg.assetCacheDir, { offline: process.env.TV_OEMBED === 'offline' }));

  const habbo = new HabboAssetsClient({ apiKey: cfg.habboAssetsApiKey });
  app.use(
    '/hh',
    createAssetRouter(habbo, cfg.assetCacheDir, undefined, (c) => svc.furniCatalog.swfRevisions(c)),
  );

  if (cfg.isProduction && existsSync(cfg.clientDistDir)) {
    app.use(express.static(cfg.clientDistDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(join(cfg.clientDistDir, 'index.html')));
  }
}
