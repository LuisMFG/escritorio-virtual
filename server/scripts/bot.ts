/**
 * Robô para testar o tempo real sozinho: entra na Recepção, passeia por tiles aleatórios
 * e de vez em quando fala alguma coisa no chat, faz um emote ou menciona alguém da sala.
 *
 *   npm run bot                 # um robô chamado "Robô"
 *   npm run bot -- Bia 3        # três robôs: "Bia 1", "Bia 2", "Bia 3"
 *
 * Usa o mesmo fluxo do navegador: POST /api/session (com INVITE_CODE) e depois o WebSocket.
 */
import { Client } from '@colyseus/sdk';
import {
  ClientMessage,
  EMOTE_IDS,
  OFFICE_ROOM,
  OfficeState,
  parseHeightmap,
  randomFigure,
  RECEPTION,
  tileHeight,
  type SessionResponse,
} from '@office/shared';
import { config } from '../src/config.js';
import { loadAvatarManifest } from '../src/services/RoomRepository.js';

const [baseName = 'Robô', countArg = '1'] = process.argv.slice(2);
const count = Math.max(1, Math.min(9, Number(countArg) || 1));
const endpoint = `http://localhost:${config.port}`;
const map = parseHeightmap(RECEPTION.heightmap);
const avatarManifest = loadAvatarManifest();
const PHRASES = [
  'Bom dia, pessoal!',
  'Alguém quer café?',
  'Reunião em 5 minutos na sala de reunião.',
  'Esse escritório ficou bonito, hein',
  'Vou pegar uma água, já volto',
  'Quem mexeu no meu grampeador?',
];
const MENTION_PHRASES = [
  'tudo certo?',
  'bora tomar um café?',
  'viu meu e-mail?',
  'valeu pela ajuda!',
];

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
      gender: 'M',
      figure: randomFigure(avatarManifest, 'M'),
    }),
  });
  const session = (await res.json()) as SessionResponse & { message?: string };
  if (!res.ok) throw new Error(`${name}: ${session.message}`);

  const client = new Client(endpoint);
  const room = await client.joinOrCreate(
    OFFICE_ROOM,
    { officeRoomId: RECEPTION.id, token: session.token },
    OfficeState,
  );
  console.log(`[bot] ${name} entrou (${room.sessionId})`);
  room.onMessage('error', (e: { message: string }) => console.log(`[bot] ${name}: ${e.message}`));
  room.onMessage('chat.message', () => undefined);
  room.onMessage('emote.played', () => undefined);

  /** Às vezes cita alguém que está na sala, para testar as menções. */
  const phrase = () => {
    const others = [...room.state.players.values()].map((p) => p.name).filter((n) => n !== name);
    if (others.length > 0 && Math.random() < 0.4) {
      const who = others[Math.floor(Math.random() * others.length)]!;
      return `@${who}, ${MENTION_PHRASES[Math.floor(Math.random() * MENTION_PHRASES.length)]!}`;
    }
    return PHRASES[Math.floor(Math.random() * PHRASES.length)]!;
  };

  const wander = () => {
    room.send(ClientMessage.Move, randomTile());
    if (Math.random() < 0.2) {
      room.send(ClientMessage.Emote, {
        emote: EMOTE_IDS[Math.floor(Math.random() * EMOTE_IDS.length)]!,
      });
    } else if (Math.random() < 0.35) {
      room.send(ClientMessage.Chat, { text: phrase() });
    }
    setTimeout(wander, 2500 + Math.random() * 4000);
  };
  setTimeout(wander, 1000);
  process.on('SIGINT', () => void room.leave().then(() => process.exit(0)));
}

for (let i = 1; i <= count; i++) {
  await startBot(count === 1 ? baseName : `${baseName} ${i}`);
}
