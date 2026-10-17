import { defineRoom, defineServer } from '@colyseus/core';
import { LOBBY_ROOM, OFFICE_ROOM } from '@office/shared';
import { config } from './config.js';
import { openDatabase } from './db/client.js';
import { configureApp } from './http/app.js';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { OfficeRoom } from './rooms/OfficeRoom.js';
import { createServices, setServices } from './services/index.js';
import { MeetingScheduler } from './services/MeetingScheduler.js';

const services = createServices(
  openDatabase(config.databasePath),
  { inviteCode: config.inviteCode },
  config.spotify,
);
if (config.spotify) console.log('[spotify] integração ligada');
setServices(services);

const server = defineServer({
  rooms: {
    [OFFICE_ROOM]: defineRoom(OfficeRoom).filterBy(['officeRoomId']),
    [LOBBY_ROOM]: defineRoom(LobbyRoom),
  },
  express: (app) => configureApp(app, config, services),
  greet: false,
});

await server.listen(config.port);
// Lembretes de reunião e placas "Em reunião" (a cada 30 s).
new MeetingScheduler(services.meetings, services.dms).start();
services.activity.start();
services.spotifyPoller.start();
console.log(`[servidor] escritório no ar em http://localhost:${config.port}`);
console.log(`[servidor] banco: ${config.databasePath}`);
console.log(
  `[servidor] token HabboAssets: ${config.habboAssetsApiKey ? 'configurado' : 'não configurado'}`,
);
