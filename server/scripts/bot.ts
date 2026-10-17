/**
 * Robô para testar o tempo real sozinho: entra na Recepção, passeia por tiles aleatórios
 * e de vez em quando fala alguma coisa no chat, faz um emote ou menciona alguém da sala.
 *
 *   npm run bot                 # um robô chamado "Robô"
 *   npm run bot -- Bia 3        # três robôs: "Bia 1", "Bia 2", "Bia 3"
 *
 * Usa o mesmo fluxo do navegador: entra com a conta `bot.<nome>` (ou cria, com o INVITE_CODE)
 * e depois abre o WebSocket.
 */
import { Client } from '@colyseus/sdk';
import {
  ClientMessage,
  LOBBY_ROOM,
  LobbyClientMessage,
  LobbyServerMessage,
  LobbyState,
  type DirectMessage,
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

const BOT_PASSWORD = 'robo-de-teste';

async function post(path: string, body: unknown) {
  const res = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as SessionResponse & { message?: string } };
}

/** Entra com a conta do robô; se ainda não existe, cria. */
async function botSession(name: string): Promise<SessionResponse> {
  const username = `bot.${name
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()}`;
  const login = await post('/api/login', { username, password: BOT_PASSWORD });
  if (login.res.ok) return login.body;
  const created = await post('/api/register', {
    inviteCode: config.inviteCode,
    username,
    password: BOT_PASSWORD,
    name,
    gender: 'M',
    figure: randomFigure(avatarManifest, 'M'),
  });
  if (!created.res.ok) throw new Error(`${name}: ${created.body.message}`);
  return created.body;
}

async function startBot(name: string): Promise<void> {
  const session = await botSession(name);
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
  room.onMessage('room.transfer', () => undefined);
  room.onMessage('chat.deleted', () => undefined);
  room.onMessage('chat.reactions', () => undefined);
  room.onMessage('board.changed', () => undefined);
  room.onMessage('room.layoutChanged', () => undefined);
  for (const t of ['wb.stroke', 'wb.draft', 'wb.removed', 'wb.cleared'])
    room.onMessage(t, () => undefined);
  room.onMessage('moderation.kicked', (m: { scope: string; message: string }) => {
    console.log(`[bot] ${name}: ${m.message}`);
    if (m.scope === 'office') process.exit(0);
  });

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

  // Mensagens privadas: o robô responde a quem escrever para ele.
  const lobby = await client.joinOrCreate(LOBBY_ROOM, { token: session.token }, LobbyState);
  lobby.onMessage(LobbyServerMessage.Error, () => undefined);
  lobby.onMessage(LobbyServerMessage.DmReadReceipt, () => undefined);
  lobby.onMessage('achievement.unlocked', () => undefined);
  lobby.onMessage(LobbyServerMessage.DmReactions, () => undefined);
  for (const t of ['meetings.changed', 'meeting.invited', 'meeting.reminder']) {
    lobby.onMessage(t, () => undefined);
  }
  lobby.onMessage(LobbyServerMessage.DmMessage, (m: DirectMessage) => {
    if (m.fromUserId === session.userId) return;
    setTimeout(() => lobby.send(LobbyClientMessage.DmRead, { withUserId: m.fromUserId }), 800);
    setTimeout(
      () =>
        lobby.send(LobbyClientMessage.DmSend, {
          toUserId: m.fromUserId,
          text: `Oi! Sou o robô ${name}. Você disse: “${m.text.slice(0, 80)}”`,
        }),
      1800,
    );
  });
  process.on('SIGINT', () => void room.leave().then(() => process.exit(0)));
}

for (let i = 1; i <= count; i++) {
  await startBot(count === 1 ? baseName : `${baseName} ${i}`);
}
