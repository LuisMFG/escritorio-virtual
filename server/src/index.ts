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
import { guarded, logError } from './util/guard.js';
import { HabboAssetsClient } from './assets/HabboAssetsClient.js';
import { imagerMeasure, offlineMeasure } from './services/FurniDefService.js';
import { OfflineTvMeta } from './services/TvService.js';

/** Tamanho máximo de uma mensagem do WebSocket. */
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
    media: config.media ? { config: config.media } : undefined,
    // Testes de ponta a ponta: sem depender do imager pela internet.
    measureFurni:
      process.env.FURNI_MEASURE === 'offline'
        ? offlineMeasure()
        : imagerMeasure(new HabboAssetsClient(), config.assetCacheDir),
    // TV (Fase 51): nos testes, sem buscar o título no YouTube.
    ...(process.env.TV_OEMBED === 'offline' ? { tvMeta: new OfflineTvMeta() } : {}),
  },
);
if (config.spotify) console.log('[spotify] integração ligada');
console.log(config.turn ? '[chamadas] TURN da Cloudflare ligado' : '[chamadas] só STUN (sem TURN)');
console.log(
  config.media
    ? `[chamadas] servidor de mídia: ${config.media.url}`
    : '[chamadas] sem servidor de mídia (defina LIVEKIT_API_KEY e LIVEKIT_API_SECRET)',
);
setServices(services);

// Promessa rejeitada sem tratamento em algum canto: registra, sem derrubar todas as salas.
process.on('unhandledRejection', (err) => logError('servidor', err));

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
setInterval(
  guarded('anexos', () => services.uploads.cleanup()),
  60 * 60_000,
).unref();
console.log(`[servidor] escritório no ar em http://localhost:${config.port}`);
console.log(`[servidor] banco: ${config.databasePath}`);
console.log(
  `[servidor] token HabboAssets: ${config.habboAssetsApiKey ? 'configurado' : 'não configurado'}`,
);
