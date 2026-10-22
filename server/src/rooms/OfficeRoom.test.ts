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
  type HighFiveMessage,
  type Furni,
  type PresenceResponse,
  type RoomTransferMessage,
  type ErrorMessage,
  type RoomLayoutMessage,
  type FurniManifestEntry,
  type FurniResult,
  type PlacedFurni,
  hasWall,
  parseHeightmap,
  TvMessage,
  type TvScreens,
  type TvState,
} from '@office/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { openDatabase } from '../db/client.js';
import { configureApp } from '../http/app.js';
import { createServices, setServices, type Services } from '../services/index.js';
import { OfficeRoom } from './OfficeRoom.js';
import { arcadeTiming } from './arcade.js';
import { OfflineTvMeta } from '../services/TvService.js';

let colyseus: ColyseusTestServer;
let svc: Services;

beforeAll(async () => {
  // TV (Fase 51): títulos sem ir ao YouTube.
  svc = createServices(openDatabase(':memory:'), undefined, undefined, undefined, undefined, {
    tvMeta: new OfflineTvMeta(),
  });
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
      // O patch com o Beto pode não ser o próximo (a sala manda outros antes): espera ele chegar.
      for (let i = 0; i < 40 && a.state.players.size < 2; i++) await a.waitForNextPatch();
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
    expect(byRoom).toEqual({ reception: ['Ana'], meeting: ['Beto'], pantry: [], games: [] });
  });

  describe('decorar', () => {
    const furniAt = (room: { state: { furni: Map<string, Furni> } }, x: number, y: number) =>
      [...room.state.furni.values()].find((f) => f.x === x && f.y === y);

    it('colocar, girar, mover e remover sincroniza com todos e persiste no banco', async () => {
      const a = await join(newUser('Ana').token);
      const b = await join(newUser('Beto').token);
      a.send(ClientMessage.FurniPlace, { defId: 'plant_yukka', x: 15, y: 18, rot: 0 });
      await wait(200);
      const placed = furniAt(b, 15, 18);
      expect(placed?.defId).toBe('plant_yukka');
      expect(svc.furni.list(RECEPTION.id).some((f) => f.id === placed!.id)).toBe(true);

      a.send(ClientMessage.FurniMove, { furniId: placed!.id, x: 16, y: 18, rot: 2 });
      await wait(200);
      expect(b.state.furni.get(placed!.id)).toMatchObject({ x: 16, y: 18, rot: 2 });
      expect(svc.furni.list(RECEPTION.id).find((f) => f.id === placed!.id)).toMatchObject({
        x: 16,
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
      a.send(ClientMessage.FurniPlace, { defId: 'nao-existe', x: 15, y: 18, rot: 0 });
      a.send(ClientMessage.FurniPlace, { defId: 'plant_yukka', x: 15, y: 18, rot: 3 });
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
      a.send(ClientMessage.FurniPlace, { defId: 'plant_yukka', x: 15, y: 18, rot: 0 });
      await waitFor(() => Boolean(furniAt(a, 15, 18)));
      svc.settings.setHiddenCategories(['games']);
      a.send(ClientMessage.FurniRemove, { furniId: pic.id });
      a.send(ClientMessage.FurniRemove, { furniId: furniAt(a, 15, 18)!.id });
      await wait(200);
    });

    it(
      'dado rola e para num número; teleporte leva para o outro lado',
      { timeout: 20_000 },
      async () => {
        const defs = svc.furniDefs as Map<string, FurniManifestEntry>;
        const base = defs.get('plant_yukka')!;
        defs.set('dado_t', { ...base, id: 'dado_t', interaction: 'dice' });
        defs.set('tele_t', { ...base, id: 'tele_t', interaction: 'teleport', states: [0, 1] });
        const ana = newUser('Ana');
        const a = await join(ana.token);
        const me = () => a.state.players.get(a.sessionId)!;

        // Dado do lado de quem joga: rola (255) e para entre 1 e 6, com a mensagem no chat.
        const p0 = me();
        a.send(ClientMessage.FurniPlace, { defId: 'dado_t', x: p0.x + 1, y: p0.y, rot: 0 });
        await waitFor(() => [...a.state.furni.values()].some((f) => f.defId === 'dado_t'));
        const dice = [...a.state.furni.values()].find((f) => f.defId === 'dado_t')!;
        a.send(ClientMessage.Interact, { furniId: dice.id });
        await waitFor(() => a.state.furni.get(dice.id)!.state === 255);
        const chat = (await a.waitForMessage(ServerMessage.Chat, 3000)) as ChatMessage;
        expect(chat.text).toMatch(/tirou [1-6] no dado/);
        await waitFor(() => a.state.furni.get(dice.id)!.state !== 255);
        expect(a.state.furni.get(dice.id)!.state).toBeGreaterThanOrEqual(1);
        expect(a.state.furni.get(dice.id)!.state).toBeLessThanOrEqual(6);

        // Teleporte solto avisa; ligado na mesma sala, a pessoa aparece do lado do outro.
        a.send(ClientMessage.FurniPlace, { defId: 'tele_t', x: p0.x, y: p0.y + 1, rot: 0 });
        a.send(ClientMessage.FurniPlace, { defId: 'tele_t', x: 14, y: 18, rot: 0 });
        await waitFor(
          () => [...a.state.furni.values()].filter((f) => f.defId === 'tele_t').length === 2,
        );
        const [t1, t2] = [...a.state.furni.values()].filter((f) => f.defId === 'tele_t');
        const near = t1!.x === p0.x ? t1! : t2!;
        const far = near === t1 ? t2! : t1!;
        a.send(ClientMessage.Interact, { furniId: near.id });
        const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
        expect(err.message).toMatch(/não está ligado/);
        svc.furni.link(near.id, far.id);
        await wait(600);
        a.send(ClientMessage.Interact, { furniId: near.id });
        await waitFor(() => a.state.furni.get(near.id)!.state === 1);
        await waitFor(() => Math.abs(me().x - far.x) <= 1 && Math.abs(me().y - far.y) <= 1, 4000);

        // Ligado a um teleporte em outra sala: troca de sala com ticket.
        const other = svc.furni.add(
          MEETING.id,
          { defId: 'tele_t', x: 3, y: 3, z: 0, rot: 0 },
          ana.user.id,
        );
        svc.furni.link(far.id, other.id);
        await wait(600);
        a.send(ClientMessage.Interact, { furniId: far.id });
        const transfer = (await a.waitForMessage(
          ServerMessage.RoomTransfer,
          4000,
        )) as RoomTransferMessage;
        expect(transfer.targetRoomId).toBe(MEETING.id);
        const b = await join(ana.token, MEETING.id, transfer.ticket);
        const there = b.state.players.get(b.sessionId)!;
        expect(Math.abs(there.x - 3) <= 1 && Math.abs(there.y - 3) <= 1).toBe(true);
        // Não deixa móveis para os próximos testes.
        for (const id of [dice.id, near.id, far.id]) svc.furni.remove(RECEPTION.id, id);
        svc.furni.remove(MEETING.id, other.id);
      },
    );

    it('a sala recriada carrega os móveis do banco', async () => {
      const ana = newUser('Ana');
      const a = await join(ana.token);
      a.send(ClientMessage.FurniPlace, { defId: 'plant_bonsai', x: 16, y: 19, rot: 0 });
      await wait(200);
      await a.leave();
      await colyseus.cleanup();
      const again = await join(ana.token);
      expect(furniAt(again, 16, 19)?.defId).toBe('plant_bonsai');
    });

    it(
      'sentar: anda até a cadeira, senta virado como ela; ninguém mexe na cadeira ocupada',
      { timeout: 20_000 },
      async () => {
        const a = await join(newUser('Ana').token);
        const chair = [...a.state.furni.values()].find((f) => f.id === 'r-fila-1-cadeira')!;
        a.send(ClientMessage.Interact, { furniId: chair.id });
        await wait(STEP_MS * 14);
        const me = a.state.players.get(a.sessionId)!;
        expect(me).toMatchObject({ x: chair.x, y: chair.y, action: 'sit', dir: chair.rot });
        expect(me.z).toBeGreaterThan(0);

        a.send(ClientMessage.FurniRemove, { furniId: chair.id });
        const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
        expect(err.message).toBe('Tem alguém sentado aí.');

        // Andar de novo levanta.
        a.send(ClientMessage.Move, { x: 4, y: 4 });
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

      for (let i = 0; i < 3; i++) a.send(ClientMessage.Emote, { emote: 'clap' });
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
        svc.pets.save(ana.user.id, { name: 'Rex', species: 'dog', color: 0, tint: 'ffffff' });
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
        svc.pets.save(ana.user.id, { name: 'Mimi', species: 'cat', color: 1, tint: 'ffffff' });
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

  describe('minha mesa (Fase 42)', () => {
    it(
      'senta na estação, fica com ela (plaquinha), outro não pega, e "ir para minha mesa" senta',
      { timeout: 90_000 },
      async () => {
        const ana = newUser('Ana');
        const a = await join(ana.token);
        const b = await join(newUser('Beto').token);
        const seat = 'r-fila-2-cadeira';
        // Sem estar sentado nela, não dá.
        a.send(ClientMessage.ClaimDesk, { furniId: seat });
        const err = (await a.waitForMessage(ServerMessage.Error)) as ErrorMessage;
        expect(err.message).toMatch(/Sente na cadeira/);

        a.send(ClientMessage.Interact, { furniId: seat });
        await wait(STEP_MS * 20);
        expect(a.state.players.get(a.sessionId)!.action).toBe('sit');
        a.send(ClientMessage.ClaimDesk, { furniId: seat });
        await wait(200);
        expect(b.state.desks.get(seat)).toBe('Ana');
        expect(a.state.players.get(a.sessionId)!.desk).toBe(seat);
        expect(svc.users.findById(ana.user.id)?.desk).toBe(seat);

        // Beto senta na mesma cadeira depois que a Ana sai e tenta ficar com ela.
        a.send(ClientMessage.Move, { x: 14, y: 18 });
        await wait(STEP_MS * 30);
        b.send(ClientMessage.Interact, { furniId: seat });
        await wait(STEP_MS * 26);
        b.send(ClientMessage.ClaimDesk, { furniId: seat });
        const err2 = (await b.waitForMessage(ServerMessage.Error)) as ErrorMessage;
        expect(err2.message).toBe('Esta mesa já é de outra pessoa.');
        b.send(ClientMessage.Move, { x: 16, y: 18 });
        await wait(STEP_MS * 30);

        // "Ir para minha mesa": anda até lá e senta.
        a.send(ClientMessage.GoToDesk, {});
        await wait(STEP_MS * 30);
        expect(a.state.players.get(a.sessionId)!).toMatchObject({ action: 'sit', x: 6, y: 3 });

        // Largar: a plaquinha some.
        a.send(ClientMessage.ReleaseDesk, {});
        await wait(200);
        expect(b.state.desks.has(seat)).toBe(false);
      },
    );
  });

  describe('sentar e deitar (Fase 33)', () => {
    it(
      'sofá de dois lugares: o segundo senta no outro lugar; o terceiro não cabe',
      { timeout: 45_000 },
      async () => {
        const a = await join(newUser('Ana').token);
        const b = await join(newUser('Beto').token);
        const c = await join(newUser('Caio').token);
        const sofa = [...a.state.furni.values()].find((f) => f.id === 'r-sofa')!;
        a.send(ClientMessage.Interact, { furniId: sofa.id });
        await wait(STEP_MS * 26);
        b.send(ClientMessage.Interact, { furniId: sofa.id });
        await wait(STEP_MS * 28);
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

    it('cama: deita na cabeceira, no sentido da cama', { timeout: 45_000 }, async () => {
      const a = await join(newUser('Ana').token);
      a.send(ClientMessage.FurniPlace, { defId: 'bed_polyfon', x: 19, y: 17, rot: 0 });
      await wait(300);
      const bed = [...a.state.furni.values()].find((f) => f.defId === 'bed_polyfon')!;
      expect(bed).toBeDefined();
      a.send(ClientMessage.Interact, { furniId: bed.id });
      await wait(STEP_MS * 34);
      const me = a.state.players.get(a.sessionId)!;
      // Cama no eixo y (rot 0): cabeceira em y = 17, deitado virado para a esquerda (4).
      expect(me).toMatchObject({ y: 17, action: 'lay', dir: 4 });
      expect([19, 20]).toContain(me.x);
      expect(me.z).toBeGreaterThan(0);
    });

    it(
      '/sentar e /deitar no chão, virar sentado, clicar do lado só vira, /levantar',
      { timeout: 20_000 },
      async () => {
        const a = await join(newUser('Ana').token);
        a.send(ClientMessage.Move, { x: 5, y: 4 });
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
        a.send(ClientMessage.Move, { x: 5, y: 3 });
        await wait(STEP_MS);
        expect(me()).toMatchObject({ x: 5, y: 4, action: 'sit', dir: 0 });
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
        a.send(ClientMessage.Move, { x: 3, y: 4 });
        await wait(STEP_MS * 2);
        expect(me().action).not.toBe('lay');
      },
    );
  });

  describe('TV com YouTube (Fase 51)', () => {
    async function tvRoom() {
      const roomId = svc.rooms.create('Cinema', svc.furniDefs).id;
      const tv = svc.furni.add(
        roomId,
        { defId: 'hc_tv', x: 3, y: 2, z: 0, rot: 2 },
        newUser('Dono').user.id,
      );
      return { roomId, tv };
    }

    it('quem abre a TV recebe a fila; adicionar começa para todos e liga a tela', async () => {
      const { roomId, tv } = await tvRoom();
      const a = await join(newUser('Ana').token, roomId);
      const b = await join(newUser('Beto').token, roomId);
      const c = await join(newUser('Caio').token, roomId); // na sala, mas sem abrir a TV
      a.send(TvMessage.Open, { furniId: tv.id });
      b.send(TvMessage.Open, { furniId: tv.id });
      await wait(100);
      const atB = b.waitForMessage(TvMessage.State) as Promise<TvState>;
      const screen = c.waitForMessage(TvMessage.Screens) as Promise<TvScreens>;
      a.send(TvMessage.Add, { furniId: tv.id, videoIds: ['dQw4w9WgXcQ'] });
      const st = await atB;
      expect(st.playing?.item).toMatchObject({ videoId: 'dQw4w9WgXcQ', addedByName: 'Ana' });
      expect(st.viewers.map((v) => v.name).sort()).toEqual(['Ana', 'Beto']);
      expect(await screen).toEqual({ [tv.id]: 'dQw4w9WgXcQ' });
      await wait(50);
      expect(a.state.furni.get(tv.id)?.state).toBe(1);
      // Quem chega depois pergunta o que passa nas TVs.
      const d = await join(newUser('Duda').token, roomId);
      expect(await d.request(TvMessage.Screens)).toEqual({ [tv.id]: 'dQw4w9WgXcQ' });
    });

    it('pausar vale para todos; só quem assiste controla e vota', async () => {
      const { roomId, tv } = await tvRoom();
      const a = await join(newUser('Ana').token, roomId);
      const b = await join(newUser('Beto').token, roomId);
      a.send(TvMessage.Open, { furniId: tv.id });
      await wait(50);
      a.send(TvMessage.Add, { furniId: tv.id, videoIds: ['dQw4w9WgXcQ', 'jNQXAC9IVRw'] });
      await wait(100);
      // Beto não abriu a TV: o pause dele não conta.
      b.send(TvMessage.Control, { furniId: tv.id, action: 'pause', position: 3 });
      await wait(100);
      expect(svc.tv.state(tv.id).playing?.pausedAt).toBeNull();
      b.send(TvMessage.Open, { furniId: tv.id });
      await wait(50);
      const paused = a.waitForMessage(TvMessage.State) as Promise<TvState>;
      b.send(TvMessage.Control, { furniId: tv.id, action: 'pause', position: 3 });
      expect((await paused).playing?.pausedAt).toBe(3);
      // Beto vota (1 de 2); Ana adicionou e pula na hora.
      b.send(TvMessage.Skip, { furniId: tv.id });
      await wait(80);
      expect(svc.tv.state(tv.id).skipVotes).toHaveLength(1);
      const skipped = b.waitForMessage(TvMessage.State) as Promise<TvState>;
      a.send(TvMessage.Skip, { furniId: tv.id });
      expect((await skipped).playing?.item.videoId).toBe('jNQXAC9IVRw');
    });

    it('sair da sala fecha a TV; apagar a TV desliga a fila', async () => {
      const { roomId, tv } = await tvRoom();
      const a = await join(newUser('Ana').token, roomId);
      a.send(TvMessage.Open, { furniId: tv.id });
      await wait(50);
      a.send(TvMessage.Add, { furniId: tv.id, videoIds: ['dQw4w9WgXcQ'] });
      await wait(100);
      expect(svc.tv.viewerSessions(tv.id)).toEqual([a.sessionId]);
      a.send(ClientMessage.FurniRemove, { furniId: tv.id });
      await wait(100);
      expect(svc.tv.screen(tv.id)).toBeNull();
      await a.leave();
      await wait(50);
      expect(svc.tv.viewerSessions(tv.id)).toEqual([]);
    });
  });

  describe('interação sem bugs (Fase 52)', () => {
    /** Sala pequena (8×6, entrada em 1,4) com móveis colocados antes de entrar. */
    function smallRoom(furni: Omit<PlacedFurni, 'id'>[]) {
      const roomId = svc.rooms.create('Teste Fase 52', svc.furniDefs).id;
      const owner = newUser('Dono').user.id;
      const ids = furni.map((f) => svc.furni.add(roomId, f, owner).id);
      return { roomId, ids };
    }
    const at = (defId: string, x: number, y: number, rot = 0, z = 0) => ({ defId, x, y, z, rot });
    async function enter(name: string, roomId: string) {
      const room = await join(newUser(name).token, roomId);
      const me = () => room.state.players.get(room.sessionId)!;
      return { room, me };
    }

    it('cama encostada na parede: entra pelo pé da cama e deita no travesseiro', async () => {
      // Cabeceira na parede de cima, lateral na parede da esquerda e um vaso do outro lado:
      // os travesseiros só têm acesso pela própria cama (antes dava "Não dá para chegar").
      const { roomId, ids } = smallRoom([at('bed_polyfon', 1, 1), at('plant_yukka', 3, 1)]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(STEP_MS * 6);
      expect(me()).toMatchObject({ y: 1, action: 'lay', dir: 4 });
      expect([1, 2]).toContain(me().x);
      expect(me().z).toBeGreaterThan(0);
    });

    it('deitado na cama cercada, sai andando por cima dela (clique no chão e /levantar)', async () => {
      // Mesma cama no canto: do travesseiro, só a própria cama dá acesso ao chão.
      const { roomId, ids } = smallRoom([at('bed_polyfon', 1, 1), at('plant_yukka', 3, 1)]);
      const { room, me } = await enter('Ana', roomId);
      const bedTile = (p: { x: number; y: number }) => p.x >= 1 && p.x <= 2 && p.y >= 1 && p.y <= 3;
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(STEP_MS * 6);
      expect(me()).toMatchObject({ y: 1, action: 'lay' });

      // Clique num tile do chão: levanta e vai (antes: "Não dá para chegar nesse lugar").
      room.send(ClientMessage.Move, { x: 5, y: 3 });
      await wait(STEP_MS * 8);
      expect(me()).toMatchObject({ x: 5, y: 3, action: 'idle' });

      // Deita de novo e usa /levantar: sai da cama andando até o chão livre mais perto.
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(STEP_MS * 8);
      expect(me().action).toBe('lay');
      room.send(ClientMessage.Posture, { posture: 'stand' });
      await wait(STEP_MS * 6);
      expect(me().action).toBe('idle');
      expect(bedTile(me())).toBe(false);
      expect(me().z).toBe(0);
    }, 20_000);

    it('cama "com estados" do catálogo deita em vez de ligar/desligar', async () => {
      const bed = svc.furniDefs.get('bed_polyfon')!;
      (svc.furniDefs as Map<string, FurniManifestEntry>).set('cama_estados_teste', {
        ...bed,
        id: 'cama_estados_teste',
        interaction: 'toggle',
        states: [0, 1],
      });
      const { roomId, ids } = smallRoom([at('cama_estados_teste', 4, 2)]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(STEP_MS * 8);
      expect(me().action).toBe('lay');
      expect(room.state.furni.get(ids[0]!)?.state).toBe(0);
    });

    it('sentado, clicar na mesa à frente não deixa em pé dentro da cadeira', async () => {
      const { roomId, ids } = smallRoom([
        at('chair_norja', 3, 3, 2),
        at('table_plasto_square', 4, 3),
      ]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(STEP_MS * 5);
      expect(me()).toMatchObject({ x: 3, y: 3, action: 'sit' });
      room.send(ClientMessage.Move, { x: 4, y: 3 });
      await wait(STEP_MS * 4);
      // Ou continua sentado, ou levantou e saiu da cadeira — nunca "em pé" no tile da cadeira.
      const p = me();
      expect(p.x === 3 && p.y === 3 && p.action !== 'sit').toBe(false);
    });

    it('editar a sala não levanta quem está sentado', async () => {
      const { roomId, ids } = smallRoom([at('chair_norja', 4, 2, 4)]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(STEP_MS * 5);
      expect(me()).toMatchObject({ x: 4, y: 2, action: 'sit' });
      svc.moderation.emit('layout', { roomId });
      await wait(150);
      expect(me()).toMatchObject({ x: 4, y: 2, action: 'sit' });
    });

    it('lugar inalcançável: recusa sem dar passo e os comandos continuam funcionando', async () => {
      // Cadeira no canto cercada por vasos.
      const { roomId, ids } = smallRoom([
        at('chair_norja', 8, 6),
        at('plant_yukka', 7, 6),
        at('plant_yukka', 8, 5),
        at('plant_yukka', 7, 5),
      ]);
      const { room, me } = await enter('Ana', roomId);
      const err = room.waitForMessage(ServerMessage.Error) as Promise<ErrorMessage>;
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      expect((await err).message).toBe('Não dá para chegar nesse lugar.');
      await wait(STEP_MS * 2);
      expect(me()).toMatchObject({ x: 1, y: 4 });
      expect([me().nextX, me().nextY]).toEqual([1, 4]);
      room.send(ClientMessage.Posture, { posture: 'sit' });
      await wait(150);
      expect(me().action).toBe('sit');
    });

    it('o último comando vale: ir pegar café e depois clicar na cadeira senta (sem café)', async () => {
      const { roomId, ids } = smallRoom([
        at('sunsetcafe_c20_coffeemachine', 6, 1, 4),
        at('chair_norja', 3, 4, 2),
      ]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(60);
      room.send(ClientMessage.Interact, { furniId: ids[1]! });
      await wait(STEP_MS * 6);
      expect(me()).toMatchObject({ x: 3, y: 4, action: 'sit' });
      expect(me().handItem ?? 0).toBe(0);
    });

    it('computador em cima da mesa: usa do lado da mesa, sem andar', async () => {
      const { roomId, ids } = smallRoom([
        at('table_norja_med', 4, 2),
        at('computer_flatscreen', 5, 3, 2, 0.8),
      ]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Move, { x: 3, y: 2 });
      await wait(STEP_MS * 5);
      expect(me()).toMatchObject({ x: 3, y: 2 });
      room.send(ClientMessage.Interact, { furniId: ids[1]! });
      await wait(200);
      expect(room.state.furni.get(ids[1]!)?.state).not.toBe(0);
      expect(me()).toMatchObject({ x: 3, y: 2 });
    });

    it('sentado, usar um móvel na diagonal não gira o corpo; duplo clique usa uma vez', async () => {
      const { roomId, ids } = smallRoom([at('chair_norja', 3, 3, 2), at('lamp_basic', 4, 4)]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(STEP_MS * 5);
      expect(me()).toMatchObject({ action: 'sit', dir: 2 });
      room.send(ClientMessage.Interact, { furniId: ids[1]! });
      room.send(ClientMessage.Interact, { furniId: ids[1]! });
      await wait(200);
      expect(room.state.furni.get(ids[1]!)?.state).toBe(1);
      expect(me()).toMatchObject({ action: 'sit', dir: 2 });
    });

    it('/levantar numa cadeira sai para o lado; dançar sentado é recusado', async () => {
      const { roomId, ids } = smallRoom([at('chair_norja', 4, 2, 4)]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(STEP_MS * 5);
      expect(me()).toMatchObject({ x: 4, y: 2, action: 'sit' });
      const err = room.waitForMessage(ServerMessage.Error) as Promise<ErrorMessage>;
      room.send(ClientMessage.Dance, { dance: 'macarena' });
      expect((await err).message).toBe('Levante para dançar.');
      room.send(ClientMessage.Posture, { posture: 'stand' });
      await wait(150);
      expect(me().action).toBe('idle');
      expect(me().x === 4 && me().y === 2).toBe(false);
      expect(Math.max(Math.abs(me().x - 4), Math.abs(me().y - 2))).toBe(1);
      expect(me().z).toBe(0);
    });

    it('cadeira movida no caminho: não senta no ar onde ela estava', async () => {
      const { roomId, ids } = smallRoom([at('chair_norja', 7, 2, 4)]);
      const { room, me } = await enter('Ana', roomId);
      room.send(ClientMessage.Interact, { furniId: ids[0]! });
      await wait(60);
      room.send(ClientMessage.FurniMove, { furniId: ids[0]!, x: 7, y: 6, rot: 4 });
      await wait(STEP_MS * 9);
      expect(me().action).not.toBe('sit');
    });
  });
  describe('Decorar com resposta (Fase 53)', () => {
    function smallRoom(furni: Omit<PlacedFurni, 'id'>[]) {
      const roomId = svc.rooms.create('Teste Fase 53', svc.furniDefs).id;
      const owner = newUser('Dono').user.id;
      const ids = furni.map((f) => svc.furni.add(roomId, f, owner).id);
      return { roomId, ids };
    }
    const at = (defId: string, x: number, y: number, rot = 0, z = 0) => ({ defId, x, y, z, rot });
    /** Mesinha com tampo (e as cores dela): a `*2` sem tampo, a `*3` com o mesmo tampo. */
    function registerBase() {
      const defs = svc.furniDefs as Map<string, FurniManifestEntry>;
      const table = svc.furniDefs.get('table_plasto_square')!;
      const base = { ...table, id: 'base_teste', hasTop: true, stackHeight: 0.8 };
      defs.set('base_teste', base);
      defs.set('base_teste*2', { ...base, id: 'base_teste*2', hasTop: false });
      defs.set('base_teste*3', { ...base, id: 'base_teste*3' });
    }

    it('colocar, mover e remover respondem o resultado; a recusa vem com o motivo', async () => {
      const { roomId } = smallRoom([]);
      const room = await join(newUser('Ana').token, roomId);
      const placed = (await room.request(ClientMessage.FurniPlace, {
        defId: 'chair_norja',
        x: 4,
        y: 2,
        rot: 0,
      })) as FurniResult;
      expect(placed).toMatchObject({ ok: true, furni: { defId: 'chair_norja', x: 4, y: 2 } });
      const id = placed.ok ? placed.furni!.id : '';
      // A resposta chega antes da atualização do estado.
      await waitFor(() => room.state.furni.has(id));

      const moved = await room.request(ClientMessage.FurniMove, {
        furniId: id,
        x: 5,
        y: 2,
        rot: 2,
      });
      expect(moved).toMatchObject({ ok: true, furni: { id, x: 5, y: 2, rot: 2 } });

      // Na entrada não pode: a resposta traz o motivo (que também chega como erro).
      const refused = await room.request(ClientMessage.FurniPlace, {
        defId: 'chair_norja',
        x: 1,
        y: 4,
        rot: 0,
      });
      expect(refused).toEqual({ ok: false, reason: 'Deixe a porta e a entrada livres.' });

      expect(await room.request(ClientMessage.FurniRemove, { furniId: id })).toEqual({ ok: true });
      await waitFor(() => !room.state.furni.has(id));
    });

    it('trocar a cor de uma base com coisas em cima só vale com o mesmo tampo', async () => {
      registerBase();
      const { roomId, ids } = smallRoom([
        at('base_teste', 4, 2),
        at('computer_flatscreen', 4, 2, 0, 0.8),
      ]);
      const room = await join(newUser('Ana').token, roomId);
      const noTop = await room.request(ClientMessage.FurniColor, {
        furniId: ids[0]!,
        defId: 'base_teste*2',
      });
      expect(noTop).toMatchObject({ ok: false, reason: expect.stringContaining('tampo') });
      expect(room.state.furni.get(ids[0]!)?.defId).toBe('base_teste');
      const sameTop = await room.request(ClientMessage.FurniColor, {
        furniId: ids[0]!,
        defId: 'base_teste*3',
      });
      expect(sameTop).toMatchObject({ ok: true, furni: { defId: 'base_teste*3' } });
    });
  });
  describe('empilhamento avançado (Fase 56)', () => {
    function smallRoom(furni: Omit<PlacedFurni, 'id'>[]) {
      const roomId = svc.rooms.create('Teste Fase 56', svc.furniDefs).id;
      const owner = newUser('Dono').user.id;
      const ids = furni.map((f) => svc.furni.add(roomId, f, owner).id);
      return { roomId, ids };
    }
    const at = (defId: string, x: number, y: number, rot = 0, z = 0) => ({ defId, x, y, z, rot });
    const near = (z: number) => expect.closeTo(z, 3) as unknown as number;

    it('mover a base leva junto o que está em cima, girando com ela; e volta tudo', async () => {
      // Mesa Norja 2×2 (tampo 0,8) com um computador no canto da direita.
      const { roomId, ids } = smallRoom([
        at('table_norja_med', 3, 1),
        at('computer_flatscreen', 4, 1, 2, 0.8),
      ]);
      const [table, pc] = ids as [string, string];
      const room = await join(newUser('Ana').token, roomId);
      const move = (x: number, y: number, rot: number) =>
        room.request(ClientMessage.FurniMove, {
          furniId: table,
          x,
          y,
          rot,
        }) as Promise<FurniResult>;

      // Girando no lugar, o computador vai para o canto girado e gira junto.
      expect(await move(3, 1, 2)).toMatchObject({
        ok: true,
        furni: { id: table, rot: 2 },
        moved: [{ id: table }, { id: pc, x: 4, y: 2, z: near(0.8), rot: 4 }],
      });
      await waitFor(() => room.state.furni.get(pc)?.y === 2);
      expect(room.state.furni.get(pc)).toMatchObject({ x: 4, y: 2, z: near(0.8), rot: 4 });

      // Mudando de lugar, vai junto (e fica gravado).
      expect(await move(4, 2, 2)).toMatchObject({ ok: true, moved: [{}, { id: pc, x: 5, y: 3 }] });
      await waitFor(() => room.state.furni.get(pc)?.x === 5);
      expect(svc.furni.list(roomId).find((f) => f.id === pc)).toMatchObject({ x: 5, y: 3 });

      // Desfazer = mover a base de volta: tudo volta como era.
      expect(await move(3, 1, 0)).toMatchObject({ ok: true });
      await waitFor(() => room.state.furni.get(pc)?.x === 4 && room.state.furni.get(pc)?.y === 1);
      expect(room.state.furni.get(pc)).toMatchObject({ z: near(0.8), rot: 2 });
    });

    it('ajuste fino de altura: a base sobe com a pilha; os limites vêm com o motivo', async () => {
      const { roomId, ids } = smallRoom([
        at('table_plasto_square', 4, 2),
        at('computer_flatscreen', 4, 2, 0, 0.9),
      ]);
      const [table, pc] = ids as [string, string];
      const room = await join(newUser('Ana').token, roomId);
      const height = (furniId: string, z: number) =>
        room.request(ClientMessage.FurniHeight, { furniId, z }) as Promise<FurniResult>;

      expect(await height(table, 0.5)).toMatchObject({
        ok: true,
        furni: { id: table, z: near(0.5) },
        moved: [{ id: table }, { id: pc, z: near(1.4) }],
      });
      await waitFor(() => Math.abs(room.state.furni.get(pc)!.z - 1.4) < 0.01);
      expect(svc.furni.list(roomId).find((f) => f.id === table)!.z).toBeCloseTo(0.5, 3);

      // O computador sozinho: sobe, mas não afunda na mesa.
      expect(await height(pc, 1)).toEqual({ ok: false, reason: 'Está apoiado no móvel de baixo.' });
      expect(await height(pc, 2)).toMatchObject({ ok: true, moved: [{ id: pc, z: near(2) }] });
      // A pilha inteira até 6: a mesa a 5 levaria o computador a 6,5.
      expect(await height(table, 5)).toEqual({ ok: false, reason: 'Mais alto não dá (até 6).' });
      // De volta ao chão, o computador erguido continua na pilha.
      expect(await height(table, 0)).toMatchObject({ ok: true, moved: [{}, { z: near(1.5) }] });
    });

    it('cadeira em cima de uma plataforma: senta na altura do assento e levanta para o lado', async () => {
      const defs = svc.furniDefs as Map<string, FurniManifestEntry>;
      const chair = svc.furniDefs.get('chair_norja')!;
      // Plataforma 2×2 de pisar, altura 1 (como os blocos do catálogo).
      defs.set('plataforma_teste', {
        ...chair,
        id: 'plataforma_teste',
        width: 2,
        depth: 2,
        height: 1,
        canSit: false,
        sitHeight: 0,
        canWalk: true,
        directions: [0],
      });
      const { roomId, ids } = smallRoom([at('plataforma_teste', 4, 1)]);
      const room = await join(newUser('Ana').token, roomId);
      const me = () => room.state.players.get(room.sessionId)!;
      const placed = (await room.request(ClientMessage.FurniPlace, {
        defId: 'chair_norja',
        x: 5,
        y: 1,
        rot: 4,
      })) as FurniResult;
      // A cadeira empilha na plataforma.
      expect(placed).toMatchObject({ ok: true, furni: { x: 5, y: 1, z: near(1) } });
      const chairId = placed.ok ? placed.furni!.id : '';
      await waitFor(() => room.state.furni.has(chairId));

      room.send(ClientMessage.Interact, { furniId: chairId });
      await waitFor(() => me().action === 'sit', STEP_MS * 14);
      expect(me()).toMatchObject({ x: 5, y: 1, z: near(1.5), dir: 4 });
      // Ninguém mexe na plataforma (nem na cadeira) com alguém sentado em cima.
      for (const furniId of [ids[0]!, chairId]) {
        expect(await room.request(ClientMessage.FurniHeight, { furniId, z: 2 })).toMatchObject({
          ok: false,
          reason: 'Tem alguém em cima.',
        });
      }
      expect(
        await room.request(ClientMessage.FurniMove, { furniId: ids[0]!, x: 4, y: 3, rot: 0 }),
      ).toMatchObject({ ok: false, reason: 'Tem alguém sentado aí.' });

      room.send(ClientMessage.Posture, { posture: 'stand' });
      await waitFor(() => me().action === 'idle');
      expect(me().x === 5 && me().y === 1).toBe(false);
      expect(Math.max(Math.abs(me().x - 5), Math.abs(me().y - 1))).toBe(1);
      // Levantou em cima da plataforma (altura 1) ou no chão ao lado dela.
      const onPlatform = me().x >= 4 && me().x <= 5 && me().y >= 1 && me().y <= 2;
      expect(me().z).toBeCloseTo(onPlatform ? 1 : 0, 3);
    }, 15_000);
  });
  describe('Salão de Jogos: vagas, assistir e W.O. (Fase 57)', () => {
    /** Sala 8×6 (entrada em 1,4) com uma mesa de ping-pong em (3,2)–(4,2) e outra em (3,5). */
    function hall() {
      const roomId = svc.rooms.create('Teste Fase 57', svc.furniDefs).id;
      const owner = newUser('Dono').user.id;
      const add = (x: number, y: number) =>
        svc.furni.add(roomId, { defId: 'pingpong_table', x, y, z: 0, rot: 0 }, owner).id;
      return { roomId, table: add(3, 2), other: add(5, 5) };
    }
    async function enter(name: string, roomId: string) {
      const u = newUser(name);
      const room = await join(u.token, roomId);
      const me = () => room.state.players.get(room.sessionId)!;
      return { room, me, user: u.user, token: u.token };
    }
    type Reply = { ok: boolean; reason?: string };
    const ask = (room: Awaited<ReturnType<typeof join>>, type: string, msg: object) =>
      room.request(type, msg) as Promise<Reply>;

    it('entra na vaga e vai para a ponta da mesa; quem não joga assiste ao vivo', async () => {
      const { roomId, table, other } = hall();
      const ana = await enter('Ana', roomId);
      const beto = await enter('Beto', roomId);
      const carla = await enter('Carla', roomId);
      const game = () => carla.room.state.arcade.get(table);

      expect(await ask(ana.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'a1' })).toEqual(
        {
          ok: true,
        },
      );
      // Anda até a ponta do lado A (2,2) e vira para a mesa (direção 2, para +x).
      await waitFor(() => ana.me().x === 2 && ana.me().y === 2 && ana.me().action === 'idle', 6000);
      await waitFor(() => ana.me().dir === 2);
      expect(
        await ask(beto.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'a1' }),
      ).toEqual({
        ok: false,
        reason: 'Essa vaga já tem alguém.',
      });
      expect(
        await ask(beto.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'b1' }),
      ).toEqual({
        ok: true,
      });
      await waitFor(() => game()?.b1Name === 'Beto');
      expect(game()).toMatchObject({ kind: 'pingpong', mode: 1, status: 'waiting', a1Name: 'Ana' });

      // Quem assiste não começa; quem joga, sim. A Carla vê a partida começar.
      expect(await ask(carla.room, ClientMessage.ArcadeStart, { furniId: table })).toMatchObject({
        ok: false,
      });
      expect(await ask(beto.room, ClientMessage.ArcadeStart, { furniId: table })).toEqual({
        ok: true,
      });
      await waitFor(() => game()?.status === 'playing');
      expect(
        await ask(carla.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'b1' }),
      ).toMatchObject({
        ok: false,
      });
      // Uma mesa por vez.
      expect(await ask(ana.room, ClientMessage.ArcadeJoin, { furniId: other, slot: 'a1' })).toEqual(
        {
          ok: false,
          reason: 'Você já está em outra mesa.',
        },
      );
    }, 20_000);

    it('2×2 escolhido na mesa vazia fica guardado para quem entrar', async () => {
      const { roomId, table } = hall();
      const ana = await enter('Ana', roomId);
      expect(await ask(ana.room, ClientMessage.ArcadeMode, { furniId: table, mode: 2 })).toEqual({
        ok: true,
      });
      await waitFor(() => ana.room.state.arcade.get(table)?.mode === 2);
      // Continua guardado depois (o relógio do W.O. não descarta mesa só com o modo).
      await wait(1200);
      expect(ana.room.state.arcade.get(table)?.mode).toBe(2);
      const joined = await ask(ana.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'a2' });
      expect(joined).toEqual({ ok: true });
      await waitFor(() => ana.room.state.arcade.get(table)?.a2Name === ana.user.name);
    }, 20_000);

    it('desistir: o outro lado vence, o placar fica gravado e o chat avisa', async () => {
      const { roomId, table } = hall();
      const ana = await enter('Ana', roomId);
      const beto = await enter('Beto', roomId);
      await ask(ana.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'a1' });
      await ask(beto.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'b1' });
      await ask(ana.room, ClientMessage.ArcadeStart, { furniId: table });
      const chat = ana.room.waitForMessage(ServerMessage.Chat) as Promise<ChatMessage>;
      expect(await ask(beto.room, ClientMessage.ArcadeForfeit, { furniId: table })).toEqual({
        ok: true,
      });
      expect(await chat).toMatchObject({
        text: `🏆 venceu ${beto.user.name} no ping-pong (desistência)`,
        kind: 'game',
      });
      await waitFor(() => ana.room.state.arcade.get(table)?.status === 'ended');
      expect(ana.room.state.arcade.get(table)).toMatchObject({ winner: 'a', end: 'forfeit' });
      expect(svc.games.of('pingpong', [ana.user.id, beto.user.id])).toMatchObject([
        { wins: 1, losses: 0 },
        { wins: 0, losses: 1 },
      ]);
    }, 20_000);

    it('sair da sala antes da partida libera a vaga; no meio dela, W.O. depois do prazo', async () => {
      const { roomId, table } = hall();
      const ana = await enter('Ana', roomId);
      const beto = await enter('Beto', roomId);
      await ask(ana.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'a1' });
      await waitFor(() => beto.room.state.arcade.get(table)?.a1Name === 'Ana');
      await ana.room.leave();
      await waitFor(() => !beto.room.state.arcade.has(table));

      const ana2 = await enter('Ana Dois', roomId);
      await ask(ana2.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'a1' });
      await ask(beto.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'b1' });
      await ask(beto.room, ClientMessage.ArcadeStart, { furniId: table });
      arcadeTiming.woMs = 400;
      try {
        await ana2.room.leave();
        await waitFor(() => (beto.room.state.arcade.get(table)?.a1Away ?? 0) > 0);
        await waitFor(() => beto.room.state.arcade.get(table)?.status === 'ended', 3000);
        expect(beto.room.state.arcade.get(table)).toMatchObject({
          winner: 'b',
          end: 'wo',
          a1Session: '',
          b1Name: 'Beto',
        });
      } finally {
        arcadeTiming.woMs = 15_000;
      }
    }, 20_000);

    it('quem sai no meio da partida e volta a tempo continua na mesma vaga', async () => {
      const { roomId, table } = hall();
      const ana = await enter('Ana', roomId);
      const beto = await enter('Beto', roomId);
      await ask(ana.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'a1' });
      await ask(beto.room, ClientMessage.ArcadeJoin, { furniId: table, slot: 'b1' });
      await ask(ana.room, ClientMessage.ArcadeStart, { furniId: table });
      await ana.room.leave();
      await waitFor(() => (beto.room.state.arcade.get(table)?.a1Away ?? 0) > 0);
      // Voltou (outra conexão da mesma conta): a vaga é dela de novo, sem W.O.
      const again = await join(ana.token, roomId);
      await waitFor(() => beto.room.state.arcade.get(table)?.a1Session === again.sessionId);
      expect(beto.room.state.arcade.get(table)).toMatchObject({ status: 'playing', a1Away: 0 });
    }, 20_000);
  });
  describe('emotes e toca aqui (Fase 54)', () => {
    /** Sala vazia 8×6 (entrada em 1,4); cada um entra e anda até o seu tile. */
    async function people(...spots: [string, number, number][]) {
      const roomId = svc.rooms.create('Teste Fase 54', svc.furniDefs).id;
      const out: { room: Awaited<ReturnType<typeof join>>; me: () => Player }[] = [];
      for (const [name, x, y] of spots) {
        const room = await join(newUser(name).token, roomId);
        const me = () => room.state.players.get(room.sessionId)! as unknown as Player;
        room.send(ClientMessage.Move, { x, y });
        out.push({ room, me });
        await waitFor(() => me().x === x && me().y === y && me().action === 'idle', 6000);
      }
      return out;
    }
    type Player = { x: number; y: number; dir: number; action: string };

    it('lado a lado: os dois se viram e batem as mãos, e todos na sala veem', async () => {
      const [ana, beto, carla] = await people(['Ana', 3, 2], ['Beto', 4, 2], ['Carla', 6, 5]);
      const seen = carla!.room.waitForMessage(ServerMessage.HighFive) as Promise<HighFiveMessage>;
      ana!.room.send(ClientMessage.HighFive, { target: beto!.room.sessionId });
      expect(await seen).toEqual({ a: ana!.room.sessionId, b: beto!.room.sessionId });
      await waitFor(() => ana!.me().dir === 2 && beto!.me().dir === 6);
    }, 15_000);

    it('um pouco longe: anda até o lado da pessoa e bate ao chegar', async () => {
      const [ana, beto] = await people(['Ana', 1, 4], ['Beto', 5, 4]);
      const seen = beto!.room.waitForMessage(ServerMessage.HighFive) as Promise<HighFiveMessage>;
      ana!.room.send(ClientMessage.HighFive, { target: beto!.room.sessionId });
      expect(await seen).toMatchObject({ a: ana!.room.sessionId });
      // O aviso chega antes da atualização do estado: espera a posição final.
      await waitFor(() => Math.max(Math.abs(ana!.me().x - 5), Math.abs(ana!.me().y - 4)) === 1);
      expect(ana!.me().action).toBe('idle');
    }, 15_000);

    it('longe demais, ocupada ou sentado: avisa e não bate', async () => {
      const [ana, beto] = await people(['Ana', 1, 4], ['Beto', 8, 1]);
      const err = (room: Awaited<ReturnType<typeof join>>) =>
        room.waitForMessage(ServerMessage.Error) as Promise<ErrorMessage>;
      let e = err(ana!.room);
      ana!.room.send(ClientMessage.HighFive, { target: beto!.room.sessionId });
      expect((await e).message).toMatch(/está longe/);

      // Ocupado (status) também não.
      beto!.room.send(ClientMessage.Move, { x: 2, y: 4 });
      await waitFor(() => beto!.me().x === 2 && beto!.me().action === 'idle', 6000);
      beto!.room.send(ClientMessage.SetStatus, { status: 'busy' });
      await wait(100);
      e = err(ana!.room);
      ana!.room.send(ClientMessage.HighFive, { target: beto!.room.sessionId });
      expect((await e).message).toMatch(/status Ocupado/);

      // Sentado no chão: levante antes.
      beto!.room.send(ClientMessage.SetStatus, { status: 'available' });
      ana!.room.send(ClientMessage.Posture, { posture: 'sit' });
      await wait(150);
      e = err(ana!.room);
      ana!.room.send(ClientMessage.HighFive, { target: beto!.room.sessionId });
      expect((await e).message).toBe('Levante para tocar aqui.');
    }, 15_000);

    it('emotes respeitam a postura; o toca aqui não vale como emote solto', async () => {
      const [ana] = await people(['Ana', 3, 3]);
      const room = ana!.room;
      const err = () => room.waitForMessage(ServerMessage.Error) as Promise<ErrorMessage>;
      let e = err();
      room.send(ClientMessage.Emote, { emote: 'highfive' });
      expect((await e).message).toMatch(/tocaaqui/);
      room.send(ClientMessage.Posture, { posture: 'sit' });
      await wait(150);
      e = err();
      room.send(ClientMessage.Emote, { emote: 'jump' });
      expect((await e).message).toBe('Levante para pular.');
      // Sentado, palmas vale: todos veem.
      const played = room.waitForMessage(ServerMessage.Emote) as Promise<EmoteMessage>;
      room.send(ClientMessage.Emote, { emote: 'clap' });
      expect((await played).emote).toBe('clap');
    });

    it('deitado, só os emotes de rosto', async () => {
      const [ana] = await people(['Ana', 3, 3]);
      const room = ana!.room;
      room.send(ClientMessage.Posture, { posture: 'lay' });
      await wait(150);
      const e = room.waitForMessage(ServerMessage.Error) as Promise<ErrorMessage>;
      room.send(ClientMessage.Emote, { emote: 'clap' });
      expect((await e).message).toMatch(/Deitado, só dá para emotes de rosto/);
      const sleep = room.waitForMessage(ServerMessage.Emote) as Promise<EmoteMessage>;
      room.send(ClientMessage.Emote, { emote: 'sleep' });
      expect((await sleep).emote).toBe('sleep');
    });
  });
  describe('danças sincronizadas (Fase 55)', () => {
    /** Sala vazia 8×6 (entrada em 1,4); cada um entra e anda até o seu tile. */
    async function dancers(...spots: [string, number, number][]) {
      const roomId = svc.rooms.create('Teste Fase 55', svc.furniDefs).id;
      const out: { room: Awaited<ReturnType<typeof join>>; me: () => DancePlayer }[] = [];
      for (const [name, x, y] of spots) {
        const room = await join(newUser(name).token, roomId);
        const me = () => room.state.players.get(room.sessionId)! as unknown as DancePlayer;
        room.send(ClientMessage.Move, { x, y });
        out.push({ room, me });
        await waitFor(() => me().x === x && me().y === y && me().action === 'idle', 6000);
      }
      return out;
    }
    type DancePlayer = { x: number; y: number; action: string; dance: string; danceStart: number };

    it('começa, fica em loop e para com /parar ou ao andar', async () => {
      const [ana] = await dancers(['Ana', 3, 3]);
      const before = Date.now();
      ana!.room.send(ClientMessage.Dance, { dance: 'macarena' });
      await waitFor(() => ana!.me().dance === 'macarena');
      expect(ana!.me().danceStart).toBeGreaterThanOrEqual(before - 5);
      ana!.room.send(ClientMessage.Dance, { dance: '' });
      await waitFor(() => ana!.me().dance === '');
      // Andar também para.
      ana!.room.send(ClientMessage.Dance, { dance: 'floss' });
      await waitFor(() => ana!.me().dance === 'floss');
      ana!.room.send(ClientMessage.Move, { x: 5, y: 3 });
      await waitFor(() => ana!.me().dance === '');
    }, 10_000);

    it('perto de quem já dança a mesma, entra no mesmo compasso; longe ou outra dança, não', async () => {
      const [ana, beto, carla] = await dancers(['Ana', 1, 1], ['Beto', 2, 1], ['Carla', 8, 6]);
      ana!.room.send(ClientMessage.Dance, { dance: 'thriller' });
      await waitFor(() => ana!.me().dance === 'thriller');
      await wait(300);
      beto!.room.send(ClientMessage.Dance, { dance: 'thriller' });
      carla!.room.send(ClientMessage.Dance, { dance: 'thriller' });
      await waitFor(() => beto!.me().dance === 'thriller' && carla!.me().dance === 'thriller');
      // Beto (1 tile) entra no tempo da Ana; Carla (6+ tiles dos dois) começa o dela.
      expect(beto!.me().danceStart).toBe(ana!.me().danceStart);
      expect(carla!.me().danceStart).toBeGreaterThan(ana!.me().danceStart + 200);
      // Outra dança perto não sincroniza.
      beto!.room.send(ClientMessage.Dance, { dance: 'ymca' });
      await waitFor(() => beto!.me().dance === 'ymca');
      expect(beto!.me().danceStart).not.toBe(ana!.me().danceStart);
    }, 15_000);

    it('sentado não dança (com aviso); andando, começa quando parar', async () => {
      const [ana] = await dancers(['Ana', 3, 3]);
      ana!.room.send(ClientMessage.Posture, { posture: 'sit' });
      await wait(150);
      const err = ana!.room.waitForMessage(ServerMessage.Error) as Promise<ErrorMessage>;
      ana!.room.send(ClientMessage.Dance, { dance: 'robot' });
      expect((await err).message).toBe('Levante para dançar.');
      ana!.room.send(ClientMessage.Posture, { posture: 'stand' });
      await wait(150);
      // Pede a dança no meio de uma caminhada: termina o passo, para e dança.
      ana!.room.send(ClientMessage.Move, { x: 8, y: 3 });
      await waitFor(() => ana!.me().action === 'walk');
      ana!.room.send(ClientMessage.Dance, { dance: 'robot' });
      await waitFor(() => ana!.me().dance === 'robot' && ana!.me().action === 'idle', 3000);
      expect(ana!.me().x).toBeLessThan(8);
    }, 10_000);

    it('responde a hora do servidor (o compasso de todo mundo)', async () => {
      const [ana] = await dancers(['Ana', 3, 3]);
      const before = Date.now();
      const now = (await ana!.room.request(ClientMessage.Time)) as number;
      expect(now).toBeGreaterThanOrEqual(before - 5);
      expect(now).toBeLessThanOrEqual(Date.now() + 5);
    });
  });
});
