import { defineRoom, defineServer } from '@colyseus/core';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import {
  ClientMessage,
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

describe('OfficeRoom', () => {
  it('recusa entrar sem token válido', async () => {
    await expect(
      colyseus.sdk.joinOrCreate(OFFICE_ROOM, { officeRoomId: RECEPTION.id, token: 'inventado' }),
    ).rejects.toThrow(/sessão/i);
  });

  it('dois usuários na mesma sala se veem; o layout chega ao entrar', async () => {
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
  });

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
});
