import { defineRoom, defineServer } from '@colyseus/core';
import { ColyseusTestServer } from '@colyseus/testing';
import {
  LOBBY_ROOM,
  LobbyClientMessage,
  LobbyServerMessage,
  LobbyState,
  OFFICE_ROOM,
  OfficeState,
  RECEPTION,
  ClientMessage,
  type DirectMessage,
  type DmConversation,
  type DmReadReceipt,
  type ErrorMessage,
  MeetingMessage,
  type MeetingNotice,
  CallMessage,
  type CallInvite,
  type CallInviteResult,
  type CallState,
  type CallToken,
  REPLACED_CODE,
  ServerMessage,
  type ReplacedMessage,
} from '@office/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { createServices, setServices, type Services } from '../services/index.js';
import { LobbyRoom } from './LobbyRoom.js';
import { MeetingScheduler } from '../services/MeetingScheduler.js';
import { OfficeRoom } from './OfficeRoom.js';

let colyseus: ColyseusTestServer;
let svc: Services;
/** Quem foi tirado da sala de mídia (sala, pessoa). */
const kicked: [string, string][] = [];

beforeAll(async () => {
  svc = createServices(openDatabase(':memory:'), undefined, undefined, undefined, undefined, {
    media: {
      config: { url: '/livekit', apiUrl: 'http://lk', apiKey: 'chave', apiSecret: 'segredo' },
      rooms: { removeParticipant: (room, id) => (kicked.push([room, id]), Promise.resolve()) },
    },
  });
  setServices(svc);
  const server = defineServer({
    rooms: {
      [OFFICE_ROOM]: defineRoom(OfficeRoom).filterBy(['officeRoomId']),
      [LOBBY_ROOM]: defineRoom(LobbyRoom),
    },
    greet: false,
    gracefullyShutdown: false,
  });
  // Porta própria: o OfficeRoom.test usa a 2568 e os arquivos rodam em paralelo. (O `boot()`
  // do @colyseus/testing ignora a porta quando recebe um Server pronto.)
  await server.listen(2569);
  colyseus = new ColyseusTestServer(server);
});
afterEach(async () => colyseus.cleanup());
afterAll(async () => colyseus.shutdown());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const newUser = (name: string) => svc.users.create(name, 'hd-180-1.ch-210-66.lg-270-82');

async function lobby(token: string, tab?: string) {
  const room = await colyseus.sdk.joinOrCreate(LOBBY_ROOM, { token, tab }, LobbyState);
  await room.waitForInitialState();
  return room;
}

describe('LobbyRoom', () => {
  it('recusa token inválido', async () => {
    await expect(colyseus.sdk.joinOrCreate(LOBBY_ROOM, { token: 'x' })).rejects.toThrow(/sessão/i);
  });

  it('DM chega para quem recebe e para as outras abas de quem mandou', async () => {
    const ana = newUser('Ana');
    const beto = newUser('Beto');
    const a1 = await lobby(ana.token);
    const a2 = await lobby(ana.token);
    const b = await lobby(beto.token);

    const atBeto = b.waitForMessage(LobbyServerMessage.DmMessage);
    const atOtherTab = a2.waitForMessage(LobbyServerMessage.DmMessage);
    a1.send(LobbyClientMessage.DmSend, { toUserId: beto.user.id, text: '  oi   Beto ' });
    const msg = (await atBeto) as DirectMessage;
    expect(msg).toMatchObject({ fromUserId: ana.user.id, toUserId: beto.user.id, text: 'oi Beto' });
    expect(((await atOtherTab) as DirectMessage).id).toBe(msg.id);

    const convs = (await b.request(LobbyClientMessage.DmConversations)) as DmConversation[];
    expect(convs).toMatchObject([{ userId: ana.user.id, name: 'Ana', unread: 1 }]);
    const history = (await b.request(LobbyClientMessage.DmHistory, {
      withUserId: ana.user.id,
    })) as DirectMessage[];
    expect(history.map((m) => m.text)).toEqual(['oi Beto']);

    // Beto abre a conversa: Ana recebe o "visto".
    const receipt = a1.waitForMessage(LobbyServerMessage.DmReadReceipt);
    b.send(LobbyClientMessage.DmRead, { withUserId: ana.user.id });
    expect((await receipt) as DmReadReceipt).toEqual({
      readerId: beto.user.id,
      writerId: ana.user.id,
      upToId: msg.id,
    });
    expect(svc.dms.unreadCount(beto.user.id)).toBe(0);
  });

  it('reação numa DM chega para os dois lados', async () => {
    const ana = newUser('Ana');
    const beto = newUser('Beto');
    const a = await lobby(ana.token);
    const b = await lobby(beto.token);
    const got = b.waitForMessage(LobbyServerMessage.DmMessage);
    a.send(LobbyClientMessage.DmSend, { toUserId: beto.user.id, text: 'bora?' });
    const msg = (await got) as DirectMessage;
    const update = a.waitForMessage(LobbyServerMessage.DmReactions);
    b.send(LobbyClientMessage.DmReact, { id: msg.id, emoji: '🎉' });
    expect(await update).toEqual({
      id: msg.id,
      reactions: [{ emoji: '🎉', users: [{ userId: beto.user.id, name: 'Beto' }] }],
    });

    const reply = a.waitForMessage(LobbyServerMessage.DmMessage);
    b.send(LobbyClientMessage.DmSend, { toUserId: ana.user.id, text: 'bora!', replyToId: msg.id });
    expect(((await reply) as DirectMessage).replyTo).toMatchObject({ id: msg.id, name: 'Ana' });
  });

  it('não manda para si mesmo nem para quem não existe', async () => {
    const ana = newUser('Ana');
    const a = await lobby(ana.token);
    a.send(LobbyClientMessage.DmSend, { toUserId: ana.user.id, text: 'eu' });
    expect(((await a.waitForMessage(LobbyServerMessage.Error)) as ErrorMessage).code).toBe(
      'NOT_FOUND',
    );
  });

  it('DM para quem está offline fica guardada', async () => {
    const ana = newUser('Ana');
    const beto = newUser('Beto');
    const a = await lobby(ana.token);
    a.send(LobbyClientMessage.DmSend, { toUserId: beto.user.id, text: 'quando voltar, me chama' });
    await wait(150);
    const b = await lobby(beto.token);
    const convs = (await b.request(LobbyClientMessage.DmConversations)) as DmConversation[];
    expect(convs[0]).toMatchObject({ lastText: 'quando voltar, me chama', unread: 1 });
  });

  it('presença ao vivo: entrar numa sala, mudar status e sair aparecem no lobby', async () => {
    const ana = newUser('Ana');
    const beto = newUser('Beto');
    const watcher = await lobby(ana.token);

    const room = await colyseus.sdk.joinOrCreate(
      OFFICE_ROOM,
      { officeRoomId: RECEPTION.id, token: beto.token },
      OfficeState,
    );
    await wait(150);
    expect(watcher.state.people.get(beto.user.id)).toMatchObject({
      name: 'Beto',
      roomId: RECEPTION.id,
      status: 'available',
    });

    room.send(ClientMessage.SetStatus, { status: 'busy' });
    await wait(150);
    expect(watcher.state.people.get(beto.user.id)?.status).toBe('busy');

    await room.leave();
    await wait(150);
    expect(watcher.state.people.has(beto.user.id)).toBe(false);
  });

  it('agenda: convite e lembrete chegam ao vivo; a sala mostra a reunião em andamento', async () => {
    const ana = newUser('Ana');
    const beto = newUser('Beto');
    const b = await lobby(beto.token);
    const meeting = svc.meetings.create({
      title: 'Kickoff',
      description: '',
      roomId: 'meeting',
      startsAt: Date.now() + 3 * 60_000,
      durationMin: 30,
      createdBy: ana.user.id,
      attendeeIds: [beto.user.id],
    });
    const invited = b.waitForMessage(MeetingMessage.Invited);
    svc.meetings.events.emit('invited', meeting, [beto.user.id]);
    expect(((await invited) as MeetingNotice).meeting.title).toBe('Kickoff');

    const reminder = b.waitForMessage(MeetingMessage.Reminder);
    const dm = b.waitForMessage(LobbyServerMessage.DmMessage);
    new MeetingScheduler(svc.meetings, svc.dms).tick();
    expect(((await reminder) as MeetingNotice).meeting.id).toBe(meeting.id);
    expect(((await dm) as DirectMessage).text).toContain('Kickoff');

    // Começando agora: a sala ganha a placa no próximo tick.
    const now = svc.meetings.create({
      title: 'Agora',
      description: '',
      roomId: 'pantry',
      startsAt: Date.now() - 60_000,
      durationMin: 30,
      createdBy: ana.user.id,
      attendeeIds: [],
    });
    svc.meetings.events.emit('tick');
    await wait(150);
    expect(b.state.rooms.get('pantry')?.meeting).toBe(now.title);
  });

  it('tirar do escritório fecha também o canal global', async () => {
    const beto = newUser('Beto');
    const b = await lobby(beto.token);
    const left = new Promise((resolve) => b.onLeave(resolve));
    svc.moderation.emit('kick', { userId: beto.user.id, scope: 'office', byName: 'Ana' });
    await left;
  });

  it('uma aba por pessoa: entrar por outra aba tira a anterior, que não volta sozinha', async () => {
    const ana = newUser('Ana');
    const office = (tab: string) =>
      colyseus.sdk.joinOrCreate(
        OFFICE_ROOM,
        { officeRoomId: RECEPTION.id, token: ana.token, tab },
        OfficeState,
      );
    const r1 = await office('pc');
    const l1 = await lobby(ana.token, 'pc');
    const replaced = Promise.all([
      r1.waitForMessage(ServerMessage.Replaced) as Promise<ReplacedMessage>,
      l1.waitForMessage(ServerMessage.Replaced) as Promise<ReplacedMessage>,
    ]);
    const gone = Promise.all([
      new Promise((r) => r1.onLeave(r)),
      new Promise((r) => l1.onLeave(r)),
    ]);
    // Abriu no celular.
    const r2 = await office('celular');
    const [msg] = await replaced;
    expect(msg.message).toMatch(/outra aba ou aparelho/);
    await gone;
    await r2.waitForInitialState();
    const mine = () => [...r2.state.players.values()].filter((p) => p.userId === ana.user.id);
    for (let i = 0; i < 20 && mine().length > 1; i++) await wait(50);
    expect(mine()).toHaveLength(1);
    // A aba do PC tentando voltar sozinha é recusada (recarregar gera outra aba, que pode).
    await expect(office('pc')).rejects.toMatchObject({ code: REPLACED_CODE });
    await expect(lobby(ana.token, 'pc')).rejects.toMatchObject({ code: REPLACED_CODE });
    // Trocar de sala pela mesma aba não tira ninguém.
    const l2 = await lobby(ana.token, 'celular');
    await wait(100);
    expect(l2.connection.isOpen).toBe(true);
    await Promise.all([r2.leave(), l2.leave()]);
  });

  describe('chamadas (Fase 49)', () => {
    it('convite com motivo, aceitar: os dois recebem a chamada e a credencial da sala de mídia', async () => {
      const ana = newUser('Ana');
      const beto = newUser('Beto');
      // Online = numa sala do escritório.
      svc.presence.add({ sessionId: 'sa', userId: ana.user.id, name: 'Ana', roomId: 'reception' });
      svc.presence.add({
        sessionId: 'sb',
        userId: beto.user.id,
        name: 'Beto',
        roomId: 'reception',
      });
      const a = await lobby(ana.token);
      const b = await lobby(beto.token);
      const invited = b.waitForMessage(CallMessage.Invited) as Promise<CallInvite>;
      a.send(CallMessage.Invite, { toUserId: beto.user.id, reason: 'Dúvida no deploy' });
      const inv = await invited;
      expect(inv).toMatchObject({ fromName: 'Ana', reason: 'Dúvida no deploy' });

      const stateA = a.waitForMessage(CallMessage.State) as Promise<CallState>;
      const stateB = b.waitForMessage(CallMessage.State) as Promise<CallState>;
      const result = a.waitForMessage(CallMessage.InviteResult) as Promise<CallInviteResult>;
      b.send(CallMessage.Answer, { inviteId: inv.id, accept: true });
      expect((await result).outcome).toBe('accepted');
      const [sa, sb] = await Promise.all([stateA, stateB]);
      expect(sa.members.map((m) => m.name).sort()).toEqual(['Ana', 'Beto']);
      expect(sa.here && sb.here).toBe(true);

      // Credencial: vale só para a sala desta chamada, com a identidade de quem pediu.
      const tok = (await a.request(CallMessage.Token)) as CallToken;
      expect(tok.url).toBe('/livekit');
      expect(Array.isArray(tok.iceServers)).toBe(true);
      const claims = JSON.parse(Buffer.from(tok.token.split('.')[1]!, 'base64url').toString()) as {
        sub: string;
        video: { room: string; roomJoin: boolean; canPublishData: boolean };
      };
      expect(claims.sub).toBe(ana.user.id);
      expect(claims.video).toMatchObject({ room: sa.id, roomJoin: true, canPublishData: false });

      // Saiu: sai da sala de mídia (e, com uma pessoa só, a chamada acaba e o outro também).
      kicked.length = 0;
      a.send(CallMessage.Leave, {});
      await wait(100);
      expect(kicked.sort()).toEqual(
        [
          [sa.id, ana.user.id],
          [sa.id, beto.user.id],
        ].sort(),
      );
      // Fora da chamada, não há credencial.
      expect(await a.request(CallMessage.Token)).toBeNull();
      svc.presence.remove('sa');
      svc.presence.remove('sb');
    });

    it('a conexão da aba cai e volta com outra sessão: a chamada continua nela', async () => {
      const ana = newUser('Ana');
      const beto = newUser('Beto');
      svc.presence.add({ sessionId: 'sa', userId: ana.user.id, name: 'Ana', roomId: 'reception' });
      svc.presence.add({
        sessionId: 'sb',
        userId: beto.user.id,
        name: 'Beto',
        roomId: 'reception',
      });
      const a = await lobby(ana.token, 'aba-ana');
      const b1 = await lobby(beto.token, 'aba-beto');
      const invited = b1.waitForMessage(CallMessage.Invited) as Promise<CallInvite>;
      a.send(CallMessage.Invite, { toUserId: beto.user.id, reason: '' });
      const inv = await invited;
      const started = b1.waitForMessage(CallMessage.State) as Promise<CallState>;
      b1.send(CallMessage.Answer, { inviteId: inv.id, accept: true });
      expect((await started).here).toBe(true);

      // Mesma aba, conexão nova (a antiga caiu): continua sendo a que fala. Outra aba do Beto
      // não fala. (O estado sai de novo quando algo muda na chamada.)
      const b2 = await lobby(beto.token, 'aba-beto');
      const other = await lobby(beto.token, 'outra-aba');
      await wait(100);
      const atB2 = b2.waitForMessage(CallMessage.State) as Promise<CallState>;
      const atOther = other.waitForMessage(CallMessage.State) as Promise<CallState>;
      a.send(CallMessage.Media, { mic: false, cam: false, screen: false });
      expect((await atB2).here).toBe(true);
      expect((await atOther).here).toBe(false);

      await b1.leave();
      await wait(100);
      expect(svc.calls.callOf(beto.user.id)?.members).toHaveLength(2);
      // Só a aba que fala recebe a credencial da sala de mídia.
      expect(await b2.request(CallMessage.Token)).not.toBeNull();
      expect(await other.request(CallMessage.Token)).toBeNull();

      // Fechou a aba que fala (as duas conexões dela), com outra aberta: a chamada passa para
      // a outra, que entra sozinha.
      const moved = other.waitForMessage(CallMessage.State) as Promise<CallState>;
      await b2.leave();
      expect((await moved).here).toBe(true);
      expect(await other.request(CallMessage.Token)).not.toBeNull();
      await other.leave();
      svc.presence.remove('sa');
      svc.presence.remove('sb');
    });

    it('caiu ou recarregou no meio da chamada: volta sozinho pela aba nova', async () => {
      const ana = newUser('Ana');
      const beto = newUser('Beto');
      svc.presence.add({ sessionId: 'sa', userId: ana.user.id, name: 'Ana', roomId: 'reception' });
      svc.presence.add({
        sessionId: 'sb',
        userId: beto.user.id,
        name: 'Beto',
        roomId: 'reception',
      });
      const a = await lobby(ana.token, 'aba-ana');
      const b1 = await lobby(beto.token, 'aba-1');
      const invited = b1.waitForMessage(CallMessage.Invited) as Promise<CallInvite>;
      a.send(CallMessage.Invite, { toUserId: beto.user.id, reason: '' });
      const inv = await invited;
      const started = b1.waitForMessage(CallMessage.State) as Promise<CallState>;
      b1.send(CallMessage.Answer, { inviteId: inv.id, accept: true });
      const callId = (await started).id;

      // Recarregou a página: a conexão sai, mas o Beto continua na chamada, "reconectando".
      kicked.length = 0;
      const seen = new Promise<CallState>((resolve) =>
        a.onMessage(CallMessage.State, (st: CallState) => {
          if (st.members.some((m) => m.away)) resolve(st);
        }),
      );
      await b1.leave();
      const away = (await seen).members.find((m) => m.userId === beto.user.id)!;
      expect(away.away).toBe(true);
      expect(kicked).toEqual([[callId, beto.user.id]]);

      // A página nova (outra aba) conecta: a chamada vem para ela, que entra sozinha.
      const b2 = await colyseus.sdk.joinOrCreate(
        LOBBY_ROOM,
        { token: beto.token, tab: 'aba-2' },
        LobbyState,
      );
      const back = (await b2.waitForMessage(CallMessage.State)) as CallState;
      expect(back).toMatchObject({ id: callId, here: true, rejoined: true });
      expect(back.members.every((m) => !m.away)).toBe(true);
      expect(await b2.request(CallMessage.Token)).not.toBeNull();
      expect(svc.calls.isAway(beto.user.id)).toBe(false);

      // Um admin tirar do escritório tira da chamada na hora (sem esperar a volta).
      svc.moderation.emit('kick', { userId: beto.user.id, scope: 'office', byName: 'Ana' });
      await wait(150);
      expect(svc.calls.callOf(beto.user.id)).toBeNull();
      await a.leave();
      svc.presence.remove('sa');
      svc.presence.remove('sb');
    });
  });
});
