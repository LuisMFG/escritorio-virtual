import { defineRoom, defineServer } from '@colyseus/core';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import {
  ClientMessage,
  COFFEE_ITEM,
  FRIDGE_ITEMS,
  OFFICE_ROOM,
  OfficeState,
  MEETING,
  RECEPTION,
  ServerMessage,
  STEP_MS,
  type ChatMessage,
  type EmoteMessage,
  type Furni,
  type PresenceResponse,
  type RoomTransferMessage,
  type ErrorMessage,
  type RoomLayoutMessage,
  type FurniManifestEntry,
  hasWall,
  parseHeightmap,
} from '@office/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { openDatabase } from '../db/client.js';
import { configureApp } from '../http/app.js';
import { createServices, setServices, type Services } from '../services/index.js';
import { OfficeRoom } from './OfficeRoom.js';

let colyseus: ColyseusTestServer;
let svc: Services;

beforeAll(async () => {
  svc = createServices(openDatabase(':memory:'));
  setServices(svc);
  const server = defineServer({
    rooms: { [OFFICE_ROOM]: defineRoom(OfficeRoom).filterBy(['officeRoomId']) },
    express: (app) => configureApp(app, testConfig, svc),
    greet: false,
    gracefullyShutdown: false,
  });
  colyseus = await boot(server);
});

afterEach(async () => colyseus.cleanup());
afterAll(async () => colyseus.shutdown());

function newUser(name: string) {
  return svc.users.create(name, 'hd-180-1.ch-210-66.lg-270-82');
}

const testConfig: Config = {
  port: 0,
  inviteCode: 'segredo',
  adminUsernames: [],
  databasePath: ':memory:',
  assetCacheDir: '/tmp/escritorio-teste-cache',
  habboAssetsApiKey: undefined,
  clientDistDir: '/nao-existe',
  isProduction: false,
  backupDir: '/tmp/escritorio-teste-backups',
  backupKeep: 7,
  uploadDir: '/tmp/escritorio-teste-uploads',
  secretKey: undefined,
  secretKeyFile: '/tmp/escritorio-teste-secret.key',
  loginRateLimit: 10,
};

async function join(token: string, roomId = RECEPTION.id, ticket?: string) {
  const room = await colyseus.sdk.joinOrCreate(
    OFFICE_ROOM,
    { officeRoomId: roomId, token, ticket },
    OfficeState,
  );
  await room.waitForInitialState();
  return room;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Espera a condição valer (ou falha depois de `ms`). */
async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condição não aconteceu a tempo');
    await wait(50);
  }
}

describe('OfficeRoom', () => {
  it('recusa entrar sem token válido', async () => {
    await expect(
      colyseus.sdk.joinOrCreate(OFFICE_ROOM, { officeRoomId: RECEPTION.id, token: 'inventado' }),
    ).rejects.toThrow(/sessão/i);
  });

  it(
    'dois usuários na mesma sala se veem; o layout chega ao entrar',
    { timeout: 15_000 },
    async () => {
      const ana = newUser('Ana');
      const beto = newUser('Beto');
      const a = await join(ana.token);
      const layout = (await a.request(ClientMessage.GetLayout)) as RoomLayoutMessage;
      expect(layout.name).toBe('Recepção');
      expect(a.state.furni.size).toBeGreaterThan(0);

      const b = await join(beto.token);
      expect(b.roomId).toBe(a.roomId);
      await a.waitForNextPatch();
      const names = [...a.state.players.values()].map((p) => p.name).sort();
      expect(names).toEqual(['Ana', 'Beto']);
      expect(svc.presence.list()).toHaveLength(2);

      // O segundo não nasce em cima do primeiro.
      const [pa, pb] = [a.state.players.get(a.sessionId)!, b.state.players.get(b.sessionId)!];
      expect(pa.x === pb.x && pa.y === pb.y).toBe(false);
    },
  );

  it('movimento é calculado e sincronizado pelo servidor', { timeout: 15_000 }, async () => {
    const a = await join(newUser('Ana').token);
    const b = await join(newUser('Beto').token);
    a.send(ClientMessage.Move, { x: 4, y: 4 });
    await wait(STEP_MS * 12);
    const seenByB = b.state.players.get(a.sessionId)!;
    expect(seenByB).toMatchObject({ x: 4, y: 4, nextX: 4, nextY: 4, action: 'idle' });
  });

  it('destino impossível devolve erro e o avatar não sai do lugar', async () => {
    const a = await join(newUser('Ana').token);
    const before = { ...a.state.players.get(a.sessionId)!.toJSON() };
    a.send(ClientMessage.Move, { x: 200, y: 200 });
    const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
    expect(err.code).toBe('INVALID_MOVE');
    await wait(STEP_MS);
    expect(a.state.players.get(a.sessionId)!).toMatchObject({ x: before.x, y: before.y });
  });

  it('ao sair, some do estado e da presença', async () => {
    const a = await join(newUser('Ana').token);
    const b = await join(newUser('Beto').token);
    await b.leave();
    await wait(200);
    expect(a.state.players.size).toBe(1);
    expect(svc.presence.list().map((e) => e.name)).toEqual(['Ana']);
  });

  it('quedas mantêm o avatar como ausente; voltar numa conexão nova remove o fantasma', async () => {
    const ana = newUser('Ana');
    const observer = await join(newUser('Beto').token);
    const first = await join(ana.token);
    // Simula queda de rede (sem "tchau" para o servidor).
    first.connection.close(4999, 'queda simulada');
    await wait(300);
    const ghost = observer.state.players.get(first.sessionId);
    expect(ghost?.away).toBe(true);

    const second = await join(ana.token);
    await wait(300);
    const anas = [...observer.state.players.values()].filter((p) => p.name === 'Ana');
    expect(anas).toHaveLength(1);
    expect(observer.state.players.has(second.sessionId)).toBe(true);
  });

  it('avatar.update troca o visual para todos e persiste; visual inválido dá erro', async () => {
    const ana = newUser('Ana');
    const a = await join(ana.token);
    const b = await join(newUser('Beto').token);
    const figure = svc.avatarManifest.defaults.F;
    a.send(ClientMessage.UpdateAvatar, { figure, gender: 'F' });
    await wait(300);
    expect(b.state.players.get(a.sessionId)!.figure).toBe(figure);
    expect(svc.users.findById(ana.user.id)).toMatchObject({ figure, gender: 'F' });

    a.send(ClientMessage.UpdateAvatar, { figure: 'hd-180-1.ch-210-66.lg-270-82', gender: 'F' });
    const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
    expect(err.code).toBe('INVALID_FIGURE');
    expect(b.state.players.get(a.sessionId)!.figure).toBe(figure);
  });

  it('chat: só a mesma sala recebe, texto normalizado, histórico ao entrar e rate limit', async () => {
    const a = await join(newUser('Ana').token);
    const b = await join(newUser('Beto').token);
    const received = b.waitForMessage(ServerMessage.Chat);
    a.send(ClientMessage.Chat, { text: '  <b>oi</b>\n pessoal ' });
    const msg = (await received) as ChatMessage;
    expect(msg).toMatchObject({ name: 'Ana', text: '<b>oi</b> pessoal', sessionId: a.sessionId });

    const c = await join(newUser('Caio').token);
    const history = (await c.request(ClientMessage.GetChatHistory)) as ChatMessage[];
    expect(history.at(-1)?.text).toBe('<b>oi</b> pessoal');

    // Já gastou 1 de 3; mais 3 seguidas estouram o limite.
    for (let i = 0; i < 3; i++) a.send(ClientMessage.Chat, { text: `spam ${i}` });
    const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
    expect(err.code).toBe('RATE_LIMIT');
  });

  it('chat vazio ou longo demais é ignorado', async () => {
    const a = await join(newUser('Ana').token);
    const before = svc.chat.recent(RECEPTION.id, 1000).length;
    a.send(ClientMessage.Chat, { text: '   ' });
    a.send(ClientMessage.Chat, { text: 'x'.repeat(500) });
    await wait(200);
    expect(svc.chat.recent(RECEPTION.id, 1000)).toHaveLength(before);
  });

  it(
    'porta: pisar nela manda para a outra sala, que recebe a pessoa do lado de dentro',
    { timeout: 20_000 },
    async () => {
      const ana = newUser('Ana');
      const a = await join(ana.token);
      const door = RECEPTION.doors.find((d) => d.targetRoomId === MEETING.id)!;
      const transfer = a.waitForMessage(ServerMessage.RoomTransfer, 10_000);
      a.send(ClientMessage.Move, { x: door.x, y: door.y });
      const msg = (await transfer) as RoomTransferMessage;
      expect(msg.targetRoomId).toBe(MEETING.id);

      await a.leave();
      const m = await join(ana.token, MEETING.id, msg.ticket);
      expect(m.state.roomId).toBe(MEETING.id);
      expect(m.state.players.get(m.sessionId)).toMatchObject({
        x: door.targetX,
        y: door.targetY,
        dir: door.targetDir,
      });
      expect(svc.presence.list().find((e) => e.userId === ana.user.id)?.roomId).toBe(MEETING.id);

      // O ticket é de uso único: entrar de novo com ele cai no ponto de entrada padrão.
      await m.leave();
      const again = await join(ana.token, MEETING.id, msg.ticket);
      expect(again.state.players.get(again.sessionId)).toMatchObject({
        x: MEETING.spawn.x,
        y: MEETING.spawn.y,
      });
    },
  );

  it('chat de uma sala não chega na outra', async () => {
    const a = await join(newUser('Ana').token);
    const m = await join(newUser('Beto').token, MEETING.id);
    let leaked = false;
    m.onMessage(ServerMessage.Chat, () => (leaked = true));
    const own = a.waitForMessage(ServerMessage.Chat);
    a.send(ClientMessage.Chat, { text: 'só a recepção' });
    await own;
    await wait(200);
    expect(leaked).toBe(false);
  });

  it('GET /api/presence lista as pessoas por sala e exige sessão', async () => {
    const ana = newUser('Ana');
    await join(ana.token);
    await join(newUser('Beto').token, MEETING.id);
    const base = `http://127.0.0.1:${colyseus.server['port']}`;
    expect((await fetch(`${base}/api/presence`)).status).toBe(401);
    const res = await fetch(`${base}/api/presence`, {
      headers: { Authorization: `Bearer ${ana.token}` },
    });
    const body = (await res.json()) as PresenceResponse;
    const byRoom = Object.fromEntries(
      body.rooms.map((r) => [r.roomId, r.people.map((p) => p.name)]),
    );
    expect(byRoom).toEqual({ reception: ['Ana'], meeting: ['Beto'], pantry: [] });
  });

  describe('decorar', () => {
    const furniAt = (room: { state: { furni: Map<string, Furni> } }, x: number, y: number) =>
      [...room.state.furni.values()].find((f) => f.x === x && f.y === y);

    it('colocar, girar, mover e remover sincroniza com todos e persiste no banco', async () => {
      const a = await join(newUser('Ana').token);
      const b = await join(newUser('Beto').token);
      a.send(ClientMessage.FurniPlace, { defId: 'plant_yukka', x: 11, y: 9, rot: 0 });
      await wait(200);
      const placed = furniAt(b, 11, 9);
      expect(placed?.defId).toBe('plant_yukka');
      expect(svc.furni.list(RECEPTION.id).some((f) => f.id === placed!.id)).toBe(true);

      a.send(ClientMessage.FurniMove, { furniId: placed!.id, x: 10, y: 9, rot: 2 });
      await wait(200);
      expect(b.state.furni.get(placed!.id)).toMatchObject({ x: 10, y: 9, rot: 2 });
      expect(svc.furni.list(RECEPTION.id).find((f) => f.id === placed!.id)).toMatchObject({
        x: 10,
        rot: 2,
      });

      a.send(ClientMessage.FurniRemove, { furniId: placed!.id });
      await wait(200);
      expect(b.state.furni.has(placed!.id)).toBe(false);
      expect(svc.furni.list(RECEPTION.id).some((f) => f.id === placed!.id)).toBe(false);
    });

    it('recusa colocações inválidas com o motivo', async () => {
      const a = await join(newUser('Ana').token);
      const door = RECEPTION.doors[0]!;
      a.send(ClientMessage.FurniPlace, { defId: 'plant_yukka', x: door.x, y: door.y, rot: 0 });
      const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
      expect(err).toMatchObject({
        code: 'INVALID_PLACEMENT',
        message: 'Deixe a porta e a entrada livres.',
      });
      const before = a.state.furni.size;
      a.send(ClientMessage.FurniPlace, { defId: 'nao-existe', x: 11, y: 9, rot: 0 });
      a.send(ClientMessage.FurniPlace, { defId: 'plant_yukka', x: 11, y: 9, rot: 3 });
      await wait(200);
      expect(a.state.furni.size).toBe(before);
    });

    it('catálogo completo: parede, troca de cor e categorias escondidas', async () => {
      const defs = svc.furniDefs as Map<string, FurniManifestEntry>;
      const base = defs.get('plant_yukka')!;
      // Móveis "já medidos" (a medição de verdade usa o imager).
      defs.set('quadro_t', { ...base, id: 'quadro_t', wall: true, height: 0, directions: [2, 4] });
      defs.set('quadro_t*2', {
        ...base,
        id: 'quadro_t*2',
        wall: true,
        height: 0,
        directions: [2, 4],
      });
      defs.set('vaso_t*3', { ...base, id: 'vaso_t*3' });
      const a = await join(newUser('Ana').token);
      const ctx = { map: parseHeightmap(RECEPTION.heightmap), doors: RECEPTION.doors };
      let spot = { x: 0, y: 0 };
      for (let x = 1; x < 20 && !spot.x; x++) if (hasWall(ctx, x, 1, 2)) spot = { x, y: 1 };
      expect(spot.x).toBeGreaterThan(0);

      a.send(ClientMessage.FurniPlace, { defId: 'quadro_t', ...spot, rot: 0, z: 1 });
      const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
      expect(err.message).toBe('Isso vai na parede.');
      a.send(ClientMessage.FurniPlace, { defId: 'quadro_t', ...spot, rot: 2, z: 1.5 });
      await waitFor(() => [...a.state.furni.values()].some((f) => f.defId === 'quadro_t'));
      const pic = [...a.state.furni.values()].find((f) => f.defId === 'quadro_t')!;
      expect(pic.z).toBe(1.5);

      // Outra cor do mesmo móvel: troca no lugar; de outro móvel, não.
      a.send(ClientMessage.FurniColor, { furniId: pic.id, defId: 'vaso_t*3' });
      expect(((await a.waitForMessage(ServerMessage.Error)) as ErrorMessage).message).toMatch(
        /não é desse móvel/,
      );
      a.send(ClientMessage.FurniColor, { furniId: pic.id, defId: 'quadro_t*2' });
      await waitFor(() => a.state.furni.get(pic.id)?.defId === 'quadro_t*2');
      expect(svc.furni.list(RECEPTION.id).find((f) => f.id === pic.id)?.defId).toBe('quadro_t*2');

      // Categoria escondida pelo admin: não coloca (os curados continuam liberados).
      svc.settings.setHiddenCategories(['plant']);
      a.send(ClientMessage.FurniPlace, { defId: 'plant_yukka', x: 11, y: 9, rot: 0 });
      await waitFor(() => Boolean(furniAt(a, 11, 9)));
      svc.settings.setHiddenCategories(['games']);
      a.send(ClientMessage.FurniRemove, { furniId: pic.id });
      a.send(ClientMessage.FurniRemove, { furniId: furniAt(a, 11, 9)!.id });
      await wait(200);
    });

    it('a sala recriada carrega os móveis do banco', async () => {
      const ana = newUser('Ana');
      const a = await join(ana.token);
      a.send(ClientMessage.FurniPlace, { defId: 'plant_bonsai', x: 11, y: 8, rot: 0 });
      await wait(200);
      await a.leave();
      await colyseus.cleanup();
      const again = await join(ana.token);
      expect(furniAt(again, 11, 8)?.defId).toBe('plant_bonsai');
    });

    it(
      'sentar: anda até a cadeira, senta virado como ela; ninguém mexe na cadeira ocupada',
      { timeout: 20_000 },
      async () => {
        const a = await join(newUser('Ana').token);
        const chair = [...a.state.furni.values()].find((f) => f.id === 'r-chair-1')!;
        a.send(ClientMessage.Interact, { furniId: chair.id });
        await wait(STEP_MS * 14);
        const me = a.state.players.get(a.sessionId)!;
        expect(me).toMatchObject({ x: chair.x, y: chair.y, action: 'sit', dir: chair.rot });
        expect(me.z).toBeGreaterThan(0);

        a.send(ClientMessage.FurniRemove, { furniId: chair.id });
        const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
        expect(err.message).toBe('Tem alguém sentado aí.');

        // Andar de novo levanta.
        a.send(ClientMessage.Move, { x: 4, y: 6 });
        await wait(STEP_MS * 2);
        expect(a.state.players.get(a.sessionId)!.action).not.toBe('sit');
      },
    );
  });

  describe('status, digitando e emotes', () => {
    it('status e digitando aparecem para todos; valores inválidos são ignorados', async () => {
      const a = await join(newUser('Ana').token);
      const b = await join(newUser('Beto').token);
      expect(b.state.players.get(a.sessionId)).toMatchObject({
        status: 'available',
        typing: false,
      });

      a.send(ClientMessage.SetStatus, { status: 'busy' });
      a.send(ClientMessage.Typing, { on: true });
      await wait(200);
      expect(b.state.players.get(a.sessionId)).toMatchObject({ status: 'busy', typing: true });

      a.send(ClientMessage.SetStatus, { status: 'invisivel' });
      a.send(ClientMessage.Chat, { text: 'oi' });
      await wait(200);
      // Mandar mensagem encerra o "digitando".
      expect(b.state.players.get(a.sessionId)).toMatchObject({ status: 'busy', typing: false });
    });

    it('emote chega para a sala e tem limite de frequência', async () => {
      const a = await join(newUser('Ana').token);
      const b = await join(newUser('Beto').token);
      const seen = b.waitForMessage(ServerMessage.Emote);
      a.send(ClientMessage.Emote, { emote: 'wave' });
      expect((await seen) as EmoteMessage).toEqual({ sessionId: a.sessionId, emote: 'wave' });

      for (let i = 0; i < 3; i++) a.send(ClientMessage.Emote, { emote: 'dance' });
      const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
      expect(err.code).toBe('RATE_LIMIT');
    });
  });

  describe('perfil na sala', () => {
    it('cargo, nome e aniversário aparecem no avatar e mudam ao vivo', async () => {
      const ana = newUser('Ana');
      const a = await join(ana.token);
      const b = await join(newUser('Beto').token);
      expect(b.state.players.get(a.sessionId)).toMatchObject({
        cargo: '',
        role: 'member',
        birthday: false,
      });

      const ti = svc.users.listCargos().find((c) => c.name === 'Coordenador de TI')!;
      svc.users.update(ana.user.id, { cargoId: ti.id, name: 'Ana Lima' });
      await wait(150);
      expect(b.state.players.get(a.sessionId)).toMatchObject({
        name: 'Ana Lima',
        cargo: 'Coordenador de TI',
        cargoColor: ti.color,
      });
      expect(svc.presence.list().find((e) => e.userId === ana.user.id)?.name).toBe('Ana Lima');
    });

    it('a equipe só abre com sessão', async () => {
      const ana = newUser('Ana');
      const base = `http://127.0.0.1:${colyseus.server['port']}`;
      const res = await fetch(`${base}/api/team`, {
        headers: { Authorization: `Bearer ${ana.token}` },
      });
      expect(res.status).toBe(200);
      const anon = await fetch(`${base}/api/team`);
      expect(anon.status).toBe(401);
    });
  });

  describe('moderação', () => {
    const adminUser = (name: string) => {
      const u = newUser(name);
      svc.users.update(u.user.id, { role: 'admin' });
      return u;
    };

    it('tirar da sala manda para a Recepção com aviso', async () => {
      const beto = newUser('Beto');
      const b = await join(beto.token, MEETING.id);
      const kicked = b.waitForMessage(ServerMessage.Kicked);
      const transfer = b.waitForMessage(ServerMessage.RoomTransfer);
      svc.moderation.emit('kick', {
        userId: beto.user.id,
        scope: 'room',
        roomId: MEETING.id,
        byName: 'Ana',
      });
      expect(await kicked).toEqual({ scope: 'room', message: 'Ana tirou você da sala.' });
      expect(((await transfer) as RoomTransferMessage).targetRoomId).toBe(RECEPTION.id);
    });

    it('tirar do escritório desconecta todas as conexões da pessoa', async () => {
      const beto = newUser('Beto');
      const b = await join(beto.token);
      const left = new Promise<number>((resolve) => b.onLeave((code) => resolve(code)));
      const kicked = b.waitForMessage(ServerMessage.Kicked);
      svc.moderation.emit('kick', { userId: beto.user.id, scope: 'office', byName: 'Ana' });
      expect(((await kicked) as { scope: string }).scope).toBe('office');
      await left;
      await wait(100);
      expect(svc.presence.list().some((e) => e.userId === beto.user.id)).toBe(false);
    });

    it('decoração travada: membro recebe aviso, admin continua decorando', async () => {
      const ana = adminUser('Ana');
      const a = await join(ana.token, MEETING.id);
      const b = await join(newUser('Beto').token, MEETING.id);
      svc.rooms.setDecorLocked(MEETING.id, true);
      svc.moderation.emit('room', { roomId: MEETING.id, decorLocked: true });
      await wait(100);
      expect(b.state.decorLocked).toBe(true);

      const place = { defId: 'plant_yukka', x: 1, y: 1, rot: 0 };
      b.send(ClientMessage.FurniPlace, place);
      const err = (await b.waitForMessage(ServerMessage.Error)) as ErrorMessage;
      expect(err.code).toBe('DECOR_LOCKED');

      // O admin pode (se o lugar não servir, o erro é outro, nunca DECOR_LOCKED).
      const adminErrors: string[] = [];
      a.onMessage(ServerMessage.Error, (e: ErrorMessage) => adminErrors.push(e.code));
      a.send(ClientMessage.FurniPlace, place);
      await wait(150);
      expect(adminErrors).not.toContain('DECOR_LOCKED');
      svc.rooms.setDecorLocked(MEETING.id, false);
    });

    it('apagar mensagem: quem escreveu ou admin; some para todos', async () => {
      const ana = adminUser('Ana');
      const a = await join(ana.token);
      const b = await join(newUser('Beto').token);
      const c = await join(newUser('Caio').token);

      b.send(ClientMessage.Chat, { text: 'mensagem do Beto' });
      const msg = (await a.waitForMessage(ServerMessage.Chat)) as ChatMessage;

      // Caio (membro) não apaga a mensagem do Beto.
      c.send(ClientMessage.ChatDelete, { id: msg.id });
      expect(((await c.waitForMessage(ServerMessage.Error)) as ErrorMessage).code).toBe(
        'FORBIDDEN',
      );

      const deleted = b.waitForMessage(ServerMessage.ChatDeleted);
      a.send(ClientMessage.ChatDelete, { id: msg.id });
      expect(await deleted).toEqual({ id: msg.id });
      expect(svc.chat.find(msg.id)).toBeUndefined();
      expect(svc.audit.list(1)[0]).toMatchObject({ action: 'chat.delete', targetName: 'Beto' });
    });
  });

  describe('reações e respostas', () => {
    it('reação vai para todos na sala; resposta traz o trecho da original', async () => {
      const a = await join(newUser('Ana').token);
      const b = await join(newUser('Beto').token);
      a.send(ClientMessage.Chat, { text: 'alguém tem café?' });
      const original = (await b.waitForMessage(ServerMessage.Chat)) as ChatMessage;
      expect(original).toMatchObject({ reactions: [], replyTo: null });

      const update = a.waitForMessage(ServerMessage.ChatReactions);
      b.send(ClientMessage.ChatReact, { id: original.id, emoji: '😂' });
      expect(await update).toMatchObject({
        id: original.id,
        reactions: [{ emoji: '😂', users: [{ name: 'Beto' }] }],
      });

      const reply = a.waitForMessage(ServerMessage.Chat);
      b.send(ClientMessage.Chat, { text: 'tenho!', replyToId: original.id });
      expect(((await reply) as ChatMessage).replyTo).toMatchObject({
        id: original.id,
        name: 'Ana',
        text: 'alguém tem café?',
      });
    });

    it('emoji fora da lista é ignorado', async () => {
      const a = await join(newUser('Ana').token);
      a.send(ClientMessage.Chat, { text: 'oi' });
      const msg = (await a.waitForMessage(ServerMessage.Chat)) as ChatMessage;
      a.send(ClientMessage.ChatReact, { id: msg.id, emoji: '💩' });
      await wait(150);
      expect(svc.chat.recent(RECEPTION.id).at(-1)!.reactions).toEqual([]);
    });
  });

  describe('editor de salas', () => {
    it('sala editada com gente dentro: quem ficou fora do piso volta e o cliente é avisado', async () => {
      const { id } = svc.rooms.create('Sala nova', svc.furniDefs);
      const a = await join(newUser('Ana').token, id);
      a.send(ClientMessage.Move, { x: 8, y: 6 });
      await wait(STEP_MS * 9);
      expect(a.state.players.get(a.sessionId)).toMatchObject({ x: 8, y: 6 });

      const data = svc.rooms.editorData(id, 1)!;
      const heightmap = data.heightmap.map((r, y) => (y >= 5 ? r.slice(0, 5) + 'xxxx' : r));
      svc.rooms.update(id, { ...data, heightmap }, [], svc.furniDefs);
      const changed = a.waitForMessage(ServerMessage.LayoutChanged);
      svc.moderation.emit('layout', { roomId: id });
      await changed;
      const layout = (await a.request(ClientMessage.GetLayout)) as RoomLayoutMessage;
      expect(layout.heightmap[6]).toBe('x0000xxxx');
      await wait(150); // a posição chega no próximo patch do estado
      const p = a.state.players.get(a.sessionId)!;
      expect(p.x < 5 || p.y < 5).toBe(true);
    });
  });

  describe('móveis interativos', () => {
    /** Sala nova vazia (8×6), para não esbarrar nos móveis iniciais. */
    function emptyRoom() {
      return svc.rooms.create('Teste interativo', svc.furniDefs).id;
    }
    const owner = () => newUser('Dono').user.id;

    it('luminária: anda até o lado, acende, salva e apaga no clique seguinte', async () => {
      const roomId = emptyRoom();
      const lamp = svc.furni.add(
        roomId,
        { defId: 'lamp_basic', x: 6, y: 2, z: 0, rot: 0 },
        owner(),
      );
      const a = await join(newUser('Ana').token, roomId);
      a.send(ClientMessage.Interact, { furniId: lamp.id });
      await wait(STEP_MS * 8);
      const me = a.state.players.get(a.sessionId)!;
      expect(Math.max(Math.abs(me.x - 6), Math.abs(me.y - 2))).toBe(1);
      expect(a.state.furni.get(lamp.id)!.state).toBe(1);
      expect(svc.furni.list(roomId).find((f) => f.id === lamp.id)?.state).toBe(1);

      a.send(ClientMessage.Interact, { furniId: lamp.id });
      await wait(150);
      expect(a.state.furni.get(lamp.id)!.state).toBe(0);
    });

    it('máquina de café e geladeira: item na mão para todos verem; /largar solta', async () => {
      const roomId = emptyRoom();
      const m = svc.furni.add(
        roomId,
        { defId: 'sunsetcafe_c20_coffeemachine', x: 2, y: 4, z: 0, rot: 0 },
        owner(),
      );
      const fridge = svc.furni.add(roomId, { defId: 'fridge', x: 6, y: 4, z: 0, rot: 0 }, owner());
      const a = await join(newUser('Ana').token, roomId);
      const b = await join(newUser('Beto').token, roomId);
      const held = () => b.state.players.get(a.sessionId)!.handItem;
      a.send(ClientMessage.Interact, { furniId: m.id });
      await waitFor(() => held() === COFFEE_ITEM, STEP_MS * 12);
      a.send(ClientMessage.ItemDrop, {});
      await waitFor(() => held() === 0);
      a.send(ClientMessage.Interact, { furniId: fridge.id });
      await waitFor(() => (FRIDGE_ITEMS as readonly number[]).includes(held()), STEP_MS * 12);
    });

    it('comemoração: conquista nova faz o efeito aparecer para a sala', async () => {
      const ana = newUser('Ana');
      const a = await join(ana.token);
      const b = await join(newUser('Beto').token);
      const flash = b.waitForMessage(ServerMessage.EffectFlash);
      svc.achievements.unlock(ana.user.id, 'organizer');
      expect(await flash).toEqual({ sessionId: a.sessionId, effect: 'spotlight', ms: 6000 });
    });

    it('mural: prega, lista com nome, só autor ou admin tira', async () => {
      const roomId = emptyRoom();
      const board = svc.furni.add(
        roomId,
        { defId: 'noticeboard', x: 4, y: 1, z: 0, rot: 0 },
        owner(),
      );
      const ana = newUser('Ana');
      const a = await join(ana.token, roomId);
      const b = await join(newUser('Beto').token, roomId);

      const changed = b.waitForMessage(ServerMessage.BoardChanged);
      a.send(ClientMessage.BoardAdd, {
        furniId: board.id,
        text: '  Reunião às 15h ',
        color: 'pink',
      });
      expect(await changed).toEqual({ furniId: board.id });
      const notes = (await b.request(ClientMessage.BoardNotes, { furniId: board.id })) as {
        id: number;
        name: string;
        text: string;
        color: string;
      }[];
      expect(notes).toMatchObject([{ name: 'Ana', text: 'Reunião às 15h', color: 'pink' }]);

      b.send(ClientMessage.BoardRemove, { noteId: notes[0]!.id });
      expect(((await b.waitForMessage(ServerMessage.Error)) as ErrorMessage).code).toBe(
        'FORBIDDEN',
      );
      a.send(ClientMessage.BoardRemove, { noteId: notes[0]!.id });
      await wait(150);
      expect(svc.boards.notes(board.id)).toEqual([]);
    });
  });

  describe('quadro branco', () => {
    async function boardRoom() {
      const roomId = svc.rooms.create('Quadro', svc.furniDefs).id;
      const owner = newUser('Dono').user.id;
      const wb = svc.furni.add(
        roomId,
        { defId: 'uni_c23_whiteboard', x: 3, y: 2, z: 0, rot: 0 },
        owner,
      );
      return { roomId, wb };
    }
    const pen = { tool: 'pen', color: '#1f2937', width: 3, points: [10, 10, 50, 60, 90, 80] };

    it('traço é salvo e vai para todos; rascunho só para os outros', async () => {
      const { roomId, wb } = await boardRoom();
      const a = await join(newUser('Ana').token, roomId);
      const b = await join(newUser('Beto').token, roomId);

      const draft = b.waitForMessage(ServerMessage.WbDraft);
      const aDrafts: unknown[] = [];
      a.onMessage(ServerMessage.WbDraft, (m) => aDrafts.push(m));
      a.send(ClientMessage.WbDraft, {
        furniId: wb.id,
        draftId: 'd1',
        tool: 'pen',
        color: '#1f2937',
        width: 3,
        points: [10, 10, 50, 60],
      });
      expect(await draft).toMatchObject({ draftId: 'd1', sessionId: a.sessionId });

      const stroke = b.waitForMessage(ServerMessage.WbStroke);
      a.send(ClientMessage.WbStroke, { furniId: wb.id, stroke: pen, draftId: 'd1' });
      expect(await stroke).toMatchObject({ furniId: wb.id, draftId: 'd1', stroke: pen });
      expect(aDrafts).toEqual([]);
      const loaded = (await b.request(ClientMessage.WbLoad, { furniId: wb.id })) as unknown[];
      expect(loaded).toHaveLength(1);
    });

    it('desfazer tira só o último traço seu; limpar apaga tudo', async () => {
      const { roomId, wb } = await boardRoom();
      const a = await join(newUser('Ana').token, roomId);
      const b = await join(newUser('Beto').token, roomId);
      a.send(ClientMessage.WbStroke, { furniId: wb.id, stroke: pen });
      await wait(80);
      b.send(ClientMessage.WbStroke, { furniId: wb.id, stroke: { ...pen, color: '#dc2626' } });
      await wait(150);

      const removed = b.waitForMessage(ServerMessage.WbRemoved);
      a.send(ClientMessage.WbUndo, { furniId: wb.id });
      expect(((await removed) as { ids: number[] }).ids).toHaveLength(1);
      expect(svc.whiteboards.list(wb.id).map((s) => s.color)).toEqual(['#dc2626']);

      const cleared = a.waitForMessage(ServerMessage.WbCleared);
      b.send(ClientMessage.WbClear, { furniId: wb.id });
      expect(await cleared).toEqual({ furniId: wb.id });
      expect(svc.whiteboards.list(wb.id)).toEqual([]);
    });

    it('não desenha em móvel que não é quadro', async () => {
      const { roomId } = await boardRoom();
      const lamp = svc.furni.add(
        roomId,
        { defId: 'lamp_basic', x: 6, y: 5, z: 0, rot: 0 },
        newUser('Dono2').user.id,
      );
      const a = await join(newUser('Ana').token, roomId);
      a.send(ClientMessage.WbStroke, { furniId: lamp.id, stroke: pen });
      await wait(150);
      expect(svc.whiteboards.list(lamp.id)).toEqual([]);
    });
  });

  describe('mini-jogos', () => {
    it('/dado e /moeda são sorteados no servidor e chegam iguais para todos', async () => {
      const a = await join(newUser('Ana').token);
      const b = await join(newUser('Beto').token);
      const seen = b.waitForMessage(ServerMessage.Chat);
      a.send(ClientMessage.Chat, { text: '/Dado' });
      const roll = (await seen) as ChatMessage;
      expect(roll.kind).toBe('dice');
      expect(roll.text).toMatch(/^🎲 tirou [1-6] no dado$/);
      expect(svc.chat.recent(RECEPTION.id).at(-1)).toMatchObject({ kind: 'dice', text: roll.text });

      const coin = b.waitForMessage(ServerMessage.Chat);
      a.send(ClientMessage.Chat, { text: '/moeda' });
      expect(((await coin) as ChatMessage).text).toMatch(/deu (cara|coroa)$/);

      // Digitar o mesmo texto à mão não vira resultado "oficial".
      const fake = b.waitForMessage(ServerMessage.Chat);
      a.send(ClientMessage.Chat, { text: '🎲 tirou 6 no dado' });
      expect(((await fake) as ChatMessage).kind).toBe('text');
    });

    it('jogo da velha: dois jogam, vitória vai para o placar e o chat', async () => {
      const roomId = svc.rooms.create('Jogos', svc.furniDefs).id;
      const table = svc.furni.add(
        roomId,
        { defId: 'table_plasto_round', x: 3, y: 3, z: 0, rot: 0 },
        newUser('Dono').user.id,
      );
      const ana = newUser('Ana');
      const beto = newUser('Beto');
      const a = await join(ana.token, roomId);
      const b = await join(beto.token, roomId);
      const c = await join(newUser('Caio').token, roomId);

      a.send(ClientMessage.TttJoin, { furniId: table.id });
      await wait(100);
      b.send(ClientMessage.TttJoin, { furniId: table.id });
      await wait(150);
      const game = () => c.state.games.get(table.id)!;
      expect(game()).toMatchObject({ xName: 'Ana', oName: 'Beto', status: 'playing', turn: 'X' });

      // Terceira pessoa não entra nem joga.
      c.send(ClientMessage.TttJoin, { furniId: table.id });
      expect(((await c.waitForMessage(ServerMessage.Error)) as ErrorMessage).message).toMatch(
        /dois jogadores/,
      );
      // Fora da vez.
      b.send(ClientMessage.TttMove, { furniId: table.id, cell: 0 });
      expect(((await b.waitForMessage(ServerMessage.Error)) as ErrorMessage).message).toMatch(
        /vez/,
      );

      const result = c.waitForMessage(ServerMessage.Chat);
      for (const [who, cell] of [
        [a, 0],
        [b, 3],
        [a, 1],
        [b, 4],
        [a, 2],
      ] as const) {
        who.send(ClientMessage.TttMove, { furniId: table.id, cell });
        await wait(60);
      }
      expect(((await result) as ChatMessage).text).toBe('🏆 venceu Beto no jogo da velha');
      await wait(100);
      expect(game()).toMatchObject({ status: 'ended', winner: 'X', line: '0,1,2' });
      expect(svc.games.of('tictactoe', [ana.user.id, beto.user.id])).toMatchObject([
        { wins: 1, losses: 0 },
        { wins: 0, losses: 1 },
      ]);

      // Revanche: quem era O começa.
      b.send(ClientMessage.TttRematch, { furniId: table.id });
      await wait(150);
      expect(game()).toMatchObject({ status: 'playing', turn: 'O', board: '.........' });

      // Sair no meio: o outro vence por desistência; sair da sala também libera o lugar.
      const forfeit = c.waitForMessage(ServerMessage.Chat);
      b.send(ClientMessage.TttLeave, { furniId: table.id });
      expect(((await forfeit) as ChatMessage).text).toMatch(/desistência/);
      await wait(100);
      expect(game()).toMatchObject({ oSession: '', status: 'ended', winner: 'X' });
      const scores = (await c.request(ClientMessage.TttScores, { furniId: table.id })) as {
        top: { name: string; wins: number }[];
      };
      expect(scores.top[0]).toMatchObject({ name: 'Ana', wins: 2 });
      await a.leave();
      await wait(150);
      expect(c.state.games.has(table.id)).toBe(false);
    });
  });

  describe('pets', () => {
    it(
      'aparece junto do dono, segue, obedece e some quando é solto',
      { timeout: 20_000 },
      async () => {
        const roomId = svc.rooms.create('Pets', svc.furniDefs).id;
        const ana = newUser('Ana');
        svc.pets.save(ana.user.id, { name: 'Rex', species: 'dog', color: 0 });
        const a = await join(ana.token, roomId);
        const b = await join(newUser('Beto').token, roomId);
        await wait(100);
        const rex = () => b.state.pets.get(ana.user.id)!;
        const me = () => a.state.players.get(a.sessionId)!;
        expect(rex()).toMatchObject({ name: 'Rex', species: 'dog', ownerName: 'Ana' });
        const far = (p: { x: number; y: number }, q: { x: number; y: number }) =>
          Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
        expect(far(rex(), me())).toBeLessThanOrEqual(1);

        // Dono anda para longe: o pet vai atrás.
        const goal = me().x > 4 ? { x: 2, y: 2 } : { x: 7, y: 6 };
        a.send(ClientMessage.Move, goal);
        await wait(STEP_MS * 16);
        expect(far(rex(), goal)).toBeLessThanOrEqual(2);

        // Comandos: a fala aparece no chat e o pet obedece.
        const said = b.waitForMessage(ServerMessage.Chat);
        a.send(ClientMessage.Chat, { text: '/senta' });
        expect(((await said) as ChatMessage).text).toBe('Rex, senta!');
        await wait(STEP_MS * 3);
        expect(rex().action).toBe('sit');

        // Quem não tem pet recebe aviso.
        b.send(ClientMessage.Chat, { text: '/deita' });
        expect(((await b.waitForMessage(ServerMessage.Error)) as ErrorMessage).message).toMatch(
          /não tem um pet/,
        );

        // Soltar o pet (HTTP) tira ele da sala na hora.
        svc.pets.remove(ana.user.id);
        await wait(100);
        expect(b.state.pets.has(ana.user.id)).toBe(false);
        // Adotar de novo: aparece ao lado.
        svc.pets.save(ana.user.id, { name: 'Mimi', species: 'cat', color: 1 });
        await wait(100);
        expect(b.state.pets.get(ana.user.id)?.name).toBe('Mimi');
        await a.leave();
        await wait(150);
        expect(b.state.pets.size).toBe(0);
      },
    );
  });

  describe('conquistas', () => {
    it('ações na sala desbloqueiam; emblemas exibidos aparecem para os outros', async () => {
      const ana = newUser('Ana');
      const unlocked: string[] = [];
      const onUnlock = (userId: string, def: { id: string }) => {
        if (userId === ana.user.id) unlocked.push(def.id);
      };
      svc.achievements.events.on('unlocked', onUnlock);
      const a = await join(ana.token);
      const b = await join(newUser('Beto').token);
      const said = b.waitForMessage(ServerMessage.Chat);
      a.send(ClientMessage.Chat, { text: 'Bom dia!' });
      await said;
      expect(unlocked).toContain('first_message');
      expect(svc.achievements.get(ana.user.id).stats).toMatchObject({ chat: 1, streak: 1 });

      svc.achievements.setShowcase(ana.user.id, ['first_message']);
      await wait(100);
      expect(b.state.players.get(a.sessionId)!.badges).toBe('first_message');
      svc.achievements.events.off('unlocked', onUnlock);
    });
  });

  describe('atividade', () => {
    it('sinal do VS Code aparece no avatar para todos na sala', async () => {
      const ana = newUser('Ana');
      const a = await join(ana.token);
      const b = await join(newUser('Beto').token);
      svc.activity.editor(ana.user.id, { state: 'active', language: 'sql' });
      await wait(100);
      expect(b.state.players.get(a.sessionId)!.activity).toBe('💻 Codando em SQL no VS Code');
      svc.activity.editor(ana.user.id, { state: 'closed' });
      await wait(100);
      expect(b.state.players.get(a.sessionId)!.activity).toBe('');
    });
  });

  describe('enquetes', () => {
    it('cria por comando, vota, troca o voto, só quem criou encerra', async () => {
      const a = await join(newUser('Ana').token);
      const b = await join(newUser('Beto').token);
      const created = b.waitForMessage(ServerMessage.Chat);
      a.send(ClientMessage.Chat, {
        text: '/enquete Almoço onde? | Restaurante | Marmita | Delivery',
      });
      const msg = (await created) as ChatMessage;
      expect(msg.kind).toBe('poll');
      expect(msg.poll).toMatchObject({ question: 'Almoço onde?', total: 0, myVote: null });
      const pollId = msg.poll!.id;

      const seenByAna = a.waitForMessage(ServerMessage.PollUpdated);
      const ownFirst = b.waitForMessage(ServerMessage.PollUpdated);
      b.send(ClientMessage.PollVote, { pollId, option: 1 });
      expect(await seenByAna).toMatchObject({
        poll: {
          total: 1,
          myVote: null,
          options: [{ votes: 0 }, { votes: 1, voters: ['Beto'] }, { votes: 0 }],
        },
      });
      expect(await ownFirst).toMatchObject({ poll: { myVote: 1 } });
      const changed = b.waitForMessage(ServerMessage.PollUpdated);
      b.send(ClientMessage.PollVote, { pollId, option: 2 });
      expect(await changed).toMatchObject({ poll: { total: 1, myVote: 2 } });

      b.send(ClientMessage.PollClose, { pollId });
      expect(((await b.waitForMessage(ServerMessage.Error)) as ErrorMessage).message).toMatch(
        /quem criou/,
      );
      const closed = b.waitForMessage(ServerMessage.PollUpdated);
      a.send(ClientMessage.PollClose, { pollId });
      expect(await closed).toMatchObject({ poll: { closed: true } });
      b.send(ClientMessage.PollVote, { pollId, option: 0 });
      expect(((await b.waitForMessage(ServerMessage.Error)) as ErrorMessage).message).toMatch(
        /encerrada/,
      );

      // Histórico traz a enquete com o voto de quem pediu.
      const history = (await b.request(ClientMessage.GetChatHistory)) as ChatMessage[];
      expect(history.find((m) => m.kind === 'poll')?.poll).toMatchObject({
        myVote: 2,
        closed: true,
      });

      // Comando mal formado avisa.
      a.send(ClientMessage.Chat, { text: '/enquete só pergunta' });
      expect(((await a.waitForMessage(ServerMessage.Error)) as ErrorMessage).message).toMatch(
        /Use: \/enquete/,
      );
    });

    it('anônima não mostra nomes', async () => {
      const a = await join(newUser('Ana').token);
      const b = await join(newUser('Beto').token);
      const created = b.waitForMessage(ServerMessage.Chat);
      a.send(ClientMessage.PollCreate, {
        question: 'Nota da sprint?',
        options: ['Boa', 'Ruim'],
        anonymous: true,
      });
      const pollId = ((await created) as ChatMessage).poll!.id;
      const seen = a.waitForMessage(ServerMessage.PollUpdated);
      b.send(ClientMessage.PollVote, { pollId, option: 0 });
      expect(await seen).toMatchObject({
        poll: {
          anonymous: true,
          options: [
            { votes: 1, voters: [] },
            { votes: 0, voters: [] },
          ],
        },
      });
    });
  });

  describe('modo foco', () => {
    it('quem está na sala vê o 🍅; a própria pessoa recebe a fase', async () => {
      const ana = newUser('Ana');
      const a = await join(ana.token);
      const b = await join(newUser('Beto').token);
      const phase = a.waitForMessage(ServerMessage.FocusPhase);
      a.send(ClientMessage.FocusStart, { minutes: 25, breakMinutes: 5 });
      expect(await phase).toMatchObject({ kind: 'focus', finished: false });
      await wait(100);
      const seen = b.state.players.get(a.sessionId)!;
      expect(seen.focusKind).toBe('focus');
      expect(seen.focusUntil).toBeGreaterThan(Date.now() + 24 * 60_000);

      // Entra numa sala nova já com o foco (fica com a pessoa, não com a sala).
      const roomId = svc.rooms.create('Foco', svc.furniDefs).id;
      const c = await join(ana.token, roomId);
      expect(c.state.players.get(c.sessionId)!.focusKind).toBe('focus');

      const stopped = a.waitForMessage(ServerMessage.FocusPhase);
      a.send(ClientMessage.FocusStop, {});
      expect(await stopped).toMatchObject({ kind: null, finished: false });
      await wait(100);
      expect(b.state.players.get(a.sessionId)!.focusUntil).toBe(0);
      svc.focus.stop(ana.user.id);
    });
  });

  describe('sentar e deitar (Fase 33)', () => {
    it(
      'sofá de dois lugares: o segundo senta no outro lugar; o terceiro não cabe',
      { timeout: 25_000 },
      async () => {
        const a = await join(newUser('Ana').token);
        const b = await join(newUser('Beto').token);
        const c = await join(newUser('Caio').token);
        const sofa = [...a.state.furni.values()].find((f) => f.defId === 'couch_norja')!;
        a.send(ClientMessage.Interact, { furniId: sofa.id });
        await wait(STEP_MS * 8);
        b.send(ClientMessage.Interact, { furniId: sofa.id });
        await wait(STEP_MS * 10);
        const pa = a.state.players.get(a.sessionId)!;
        const pb = a.state.players.get(b.sessionId)!;
        expect([pa.action, pb.action]).toEqual(['sit', 'sit']);
        // Lugares vizinhos do mesmo sofá (o da semente fica girado).
        expect(Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y)).toBe(1);
        expect(Math.min(pa.x, pb.x)).toBe(sofa.x);
        expect(Math.min(pa.y, pb.y)).toBe(sofa.y);
        c.send(ClientMessage.Interact, { furniId: sofa.id });
        const err = (await c.waitForMessage(ServerMessage.Error)) as ErrorMessage;
        expect(err.message).toBe('Esse lugar está ocupado.');
      },
    );

    it('cama: deita na cabeceira, no sentido da cama', { timeout: 25_000 }, async () => {
      const a = await join(newUser('Ana').token);
      a.send(ClientMessage.FurniPlace, { defId: 'bed_polyfon', x: 9, y: 6, rot: 0 });
      await wait(300);
      const bed = [...a.state.furni.values()].find((f) => f.defId === 'bed_polyfon')!;
      expect(bed).toBeDefined();
      a.send(ClientMessage.Interact, { furniId: bed.id });
      await wait(STEP_MS * 16);
      const me = a.state.players.get(a.sessionId)!;
      // Cama no eixo y (rot 0): cabeceira em y = 6, deitado virado para a esquerda (4).
      expect(me).toMatchObject({ y: 6, action: 'lay', dir: 4 });
      expect([9, 10]).toContain(me.x);
      expect(me.z).toBeGreaterThan(0);
    });

    it(
      '/sentar e /deitar no chão, virar sentado, clicar do lado só vira, /levantar',
      { timeout: 20_000 },
      async () => {
        const a = await join(newUser('Ana').token);
        a.send(ClientMessage.Move, { x: 6, y: 6 });
        await wait(STEP_MS * 12);
        const me = () => a.state.players.get(a.sessionId)!;
        a.send(ClientMessage.Posture, { posture: 'sit' });
        await wait(150);
        expect(me().action).toBe('sit');
        expect(me().dir % 2).toBe(0);
        // Sentado só vira nas direções pares.
        a.send(ClientMessage.Turn, { dir: 3 });
        await wait(150);
        expect(me().dir).toBe(2);
        // Clicar num tile do lado só vira (não levanta).
        a.send(ClientMessage.Move, { x: 6, y: 5 });
        await wait(STEP_MS);
        expect(me()).toMatchObject({ x: 6, y: 6, action: 'sit', dir: 0 });
        a.send(ClientMessage.Posture, { posture: 'stand' });
        await wait(150);
        expect(me().action).toBe('idle');
        a.send(ClientMessage.Turn, { dir: 5 });
        await wait(150);
        expect(me().dir).toBe(5);
        a.send(ClientMessage.Posture, { posture: 'lay' });
        await wait(150);
        expect(me()).toMatchObject({ action: 'lay', dir: 4 });
        // Deitado não vira; andar levanta.
        a.send(ClientMessage.Turn, { dir: 1 });
        await wait(150);
        expect(me().dir).toBe(4);
        a.send(ClientMessage.Move, { x: 4, y: 6 });
        await wait(STEP_MS * 2);
        expect(me().action).not.toBe('lay');
      },
    );
  });
});
