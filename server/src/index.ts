import { defineRoom, defineServer } from '@colyseus/core';
import { LOBBY_ROOM, OFFICE_ROOM } from '@office/shared';
import { config } from './config.js';
import { openDatabase } from './db/client.js';
import { configureApp } from './http/app.js';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { OfficeRoom } from './rooms/OfficeRoom.js';
import { createServices, setServices } from './services/index.js';
import { MeetingScheduler } from './services/MeetingScheduler.js';
import { BackupScheduler } from './services/BackupService.js';
import { loadSecretKey } from './util/secretBox.js';
import { HabboAssetsClient } from './assets/HabboAssetsClient.js';
import { imagerMeasure, offlineMeasure } from './services/FurniDefService.js';

/** Tamanho máximo de uma mensagem do WebSocket (a oferta WebRTC tem uns 5–8 KB). */
const WS_MAX_PAYLOAD = 32 * 1024;

const services = createServices(
  openDatabase(config.databasePath),
  { inviteCode: config.inviteCode, jiraSite: config.jiraSite },
  config.spotify,
  { dir: config.backupDir, keep: config.backupKeep },
  config.uploadDir,
  {
    secretKey: loadSecretKey(config.secretKey, config.secretKeyFile),
    turn: config.turn,
    // Testes de ponta a ponta: sem depender do imager pela internet.
    measureFurni:
      process.env.FURNI_MEASURE === 'offline'
        ? offlineMeasure()
        : imagerMeasure(new HabboAssetsClient(), config.assetCacheDir),
  },
);
if (config.spotify) console.log('[spotify] integração ligada');
console.log(config.turn ? '[chamadas] TURN da Cloudflare ligado' : '[chamadas] só STUN (sem TURN)');
setServices(services);

const server = defineServer({
  rooms: {
    [OFFICE_ROOM]: defineRoom(OfficeRoom).filterBy(['officeRoomId']),
    [LOBBY_ROOM]: defineRoom(LobbyRoom),
  },
  express: (app) => configureApp(app, config, services),
  greet: false,
  // Opções do transporte WebSocket (repassadas pelo Colyseus): a oferta WebRTC das chamadas
  // (Fase 49) passa dos 4 KB padrão.
  ...({ maxPayload: WS_MAX_PAYLOAD } as object),
});

await server.listen(config.port);
// Lembretes de reunião e placas "Em reunião" (a cada 30 s).
new MeetingScheduler(services.meetings, services.dms).start();
services.activity.start();
services.spotifyPoller.start();
services.jiraPoller.start();
services.focus.startTimer();
new BackupScheduler(services.backups).start();
// Anexos enviados e nunca mandados (ou de mensagens que saíram do histórico): limpa a cada hora.
setInterval(() => services.uploads.cleanup(), 60 * 60_000).unref();
console.log(`[servidor] escritório no ar em http://localhost:${config.port}`);
console.log(`[servidor] banco: ${config.databasePath}`);
console.log(
  `[servidor] token HabboAssets: ${config.habboAssetsApiKey ? 'configurado' : 'não configurado'}`,
);
