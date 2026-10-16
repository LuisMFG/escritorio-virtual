import { defineRoom, defineServer } from '@colyseus/core';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import {
  ClientMessage,
  OFFICE_ROOM,
  OfficeState,
  RECEPTION,
  ServerMessage,
  STEP_MS,
  type ErrorMessage,
  type RoomLayoutMessage,
} from '@office/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { createServices, setServices, type Services } from '../services/index.js';
import { OfficeRoom } from './OfficeRoom.js';

let colyseus: ColyseusTestServer;
let svc: Services;

beforeAll(async () => {
  svc = createServices(openDatabase(':memory:'));
  setServices(svc);
  const server = defineServer({
    rooms: { [OFFICE_ROOM]: defineRoom(OfficeRoom).filterBy(['roomId']) },
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

async function join(token: string) {
  const room = await colyseus.sdk.joinOrCreate(
    OFFICE_ROOM,
    { roomId: RECEPTION.id, token },
    OfficeState,
  );
  await room.waitForInitialState();
  return room;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('OfficeRoom', () => {
  it('recusa entrar sem token válido', async () => {
    await expect(
      colyseus.sdk.joinOrCreate(OFFICE_ROOM, { roomId: RECEPTION.id, token: 'inventado' }),
    ).rejects.toThrow(/sessão/i);
  });

  it('dois usuários na mesma sala se veem; o layout chega ao entrar', async () => {
    const ana = newUser('Ana');
    const beto = newUser('Beto');
    const a = await join(ana.token);
    const layout = (await a.request(ClientMessage.GetLayout)) as RoomLayoutMessage;
    expect(layout.name).toBe('Recepção');
    expect(layout.furni.length).toBeGreaterThan(0);

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
});
