/**
 * Robô para testar o tempo real sozinho: entra na Recepção e passeia por tiles aleatórios.
 *
 *   npm run bot                 # um robô chamado "Robô"
 *   npm run bot -- Bia 3        # três robôs: "Bia 1", "Bia 2", "Bia 3"
 *
 * Usa o mesmo fluxo do navegador: POST /api/session (com INVITE_CODE) e depois o WebSocket.
 */
import { Client } from '@colyseus/sdk';
import {
  ClientMessage,
  OFFICE_ROOM,
  OfficeState,
  parseHeightmap,
  RECEPTION,
  tileHeight,
  type SessionResponse,
} from '@office/shared';
import { config } from '../src/config.js';

const [baseName = 'Robô', countArg = '1'] = process.argv.slice(2);
const count = Math.max(1, Math.min(9, Number(countArg) || 1));
const endpoint = `http://localhost:${config.port}`;
const map = parseHeightmap(RECEPTION.heightmap);

function randomTile() {
  for (;;) {
    const x = Math.floor(Math.random() * map.width);
    const y = Math.floor(Math.random() * map.height);
    if (tileHeight(map, x, y) !== null) return { x, y };
  }
}

async function startBot(name: string): Promise<void> {
  const res = await fetch(`${endpoint}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      inviteCode: config.inviteCode,
      figure: 'hd-180-2.ch-215-82.lg-285-64.sh-300-64.hr-893-45',
    }),
  });
  const session = (await res.json()) as SessionResponse & { message?: string };
  if (!res.ok) throw new Error(`${name}: ${session.message}`);

  const client = new Client(endpoint);
  const room = await client.joinOrCreate(
    OFFICE_ROOM,
    { roomId: RECEPTION.id, token: session.token },
    OfficeState,
  );
  console.log(`[bot] ${name} entrou (${room.sessionId})`);
  room.onMessage('error', (e: { message: string }) => console.log(`[bot] ${name}: ${e.message}`));

  const wander = () => {
    room.send(ClientMessage.Move, randomTile());
    setTimeout(wander, 2500 + Math.random() * 4000);
  };
  setTimeout(wander, 1000);
  process.on('SIGINT', () => void room.leave().then(() => process.exit(0)));
}

for (let i = 1; i <= count; i++) {
  await startBot(count === 1 ? baseName : `${baseName} ${i}`);
}
