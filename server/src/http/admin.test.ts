import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditList,
  createCargo,
  deleteCargo,
  kick,
  overview,
  reorderCargos,
  resetPassword,
  setInvite,
  setRoom,
  updateCargo,
  updateUser,
  type AdminDeps,
} from './admin.js';
import { login, register } from './auth.js';
import { callerOf, makeDeps, registered } from './testDeps.js';

let deps: AdminDeps;
let admin: Awaited<ReturnType<typeof registered>>;
let beto: Awaited<ReturnType<typeof registered>>;
const asAdmin = () => callerOf(deps, admin.token);
const asBeto = () => callerOf(deps, beto.token);

beforeEach(async () => {
  deps = makeDeps();
  admin = await registered(deps); // primeira conta: admin
  beto = await registered(deps, { username: 'beto', name: 'Beto' });
});

describe('acesso', () => {
  it('membro não usa nenhuma rota do painel', async () => {
    expect(overview(asBeto(), deps)).toMatchObject({ status: 403 });
    expect(setInvite(asBeto(), { inviteCode: 'novo-codigo' }, deps)).toMatchObject({ status: 403 });
    expect(await resetPassword(asBeto(), admin.userId, deps)).toMatchObject({ status: 403 });
    expect(auditList(asBeto(), deps)).toMatchObject({ status: 403 });
  });
});

describe('convite', () => {
  it('trocar o código vale na hora para cadastros e fica no registro', async () => {
    expect(setInvite(asAdmin(), { inviteCode: ' novo-codigo ' }, deps).ok).toBe(true);
    const base = { username: 'caio', password: 'senha-boa-1', name: 'Caio' };
    expect(await register({ ...base, inviteCode: 'segredo' }, deps)).toMatchObject({
      status: 401,
    });
    expect((await register({ ...base, inviteCode: 'novo-codigo' }, deps)).ok).toBe(true);
    const res = overview(asAdmin(), deps);
    expect(res.ok && res.body.inviteCode).toBe('novo-codigo');
    const log = auditList(asAdmin(), deps);
    expect(log.ok && log.body[0]).toMatchObject({ actorName: 'Ana', action: 'invite.change' });
  });
});

describe('pessoas', () => {
  it('promove e rebaixa, mas nunca deixa o escritório sem admin', () => {
    expect(updateUser(asAdmin(), beto.userId, { role: 'admin' }, deps).ok).toBe(true);
    expect(updateUser(asAdmin(), admin.userId, { role: 'member' }, deps).ok).toBe(true);
    // Agora o Beto é o único admin.
    expect(updateUser(asBeto(), beto.userId, { role: 'member' }, deps)).toMatchObject({
      status: 409,
    });
  });

  it('quem está no ADMIN_USERNAMES não é rebaixado pelo painel', () => {
    deps.adminUsernames = ['beto'];
    updateUser(asAdmin(), beto.userId, { role: 'admin' }, deps);
    expect(updateUser(asAdmin(), beto.userId, { role: 'member' }, deps)).toMatchObject({
      status: 409,
      body: { message: expect.stringContaining('ADMIN_USERNAMES') },
    });
  });

  it('desativar derruba as sessões, impede o login e tira do escritório', async () => {
    const kicks: string[] = [];
    deps.moderation.on('kick', (e) => kicks.push(`${e.userId}:${e.scope}`));
    expect(updateUser(asAdmin(), beto.userId, { disabled: true }, deps).ok).toBe(true);
    expect(deps.users.findByToken(beto.token)).toBeUndefined();
    expect(kicks).toEqual([`${beto.userId}:office`]);
    expect(await login({ username: 'beto', password: 'senha-boa-1' }, deps)).toMatchObject({
      status: 403,
      body: { error: 'ACCOUNT_DISABLED' },
    });
    expect(updateUser(asAdmin(), admin.userId, { disabled: true }, deps)).toMatchObject({
      status: 409,
    });

    updateUser(asAdmin(), beto.userId, { disabled: false }, deps);
    expect((await login({ username: 'beto', password: 'senha-boa-1' }, deps)).ok).toBe(true);
  });

  it('senha temporária funciona uma vez mostrada e desconecta a pessoa', async () => {
    const res = await resetPassword(asAdmin(), beto.userId, deps);
    if (!res.ok) throw new Error(res.body.message);
    expect(res.body.password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(deps.users.findByToken(beto.token)).toBeUndefined();
    expect((await login({ username: 'beto', password: res.body.password }, deps)).ok).toBe(true);
    expect((await login({ username: 'beto', password: 'senha-boa-1' }, deps)).ok).toBe(false);
  });

  it('tirar da sala ou do escritório só vale para quem está online', () => {
    const kicks: unknown[] = [];
    deps.moderation.on('kick', (e) => kicks.push(e));
    expect(kick(asAdmin(), beto.userId, { scope: 'room' }, deps)).toMatchObject({ status: 404 });

    deps.presence.add({ sessionId: 's', userId: beto.userId, name: 'Beto', roomId: 'reception' });
    // Na Recepção, "tirar da sala" não tem para onde mandar.
    expect(kick(asAdmin(), beto.userId, { scope: 'room' }, deps)).toMatchObject({ status: 409 });
    expect(kick(asAdmin(), admin.userId, { scope: 'office' }, deps)).toMatchObject({
      status: 409,
    });
    expect(kick(asAdmin(), beto.userId, { scope: 'office' }, deps).ok).toBe(true);
    expect(kicks).toMatchObject([{ userId: beto.userId, scope: 'office', byName: 'Ana' }]);
    expect(deps.users.findByToken(beto.token)).toBeUndefined();
  });
});

describe('cargos e salas', () => {
  it('cria, edita, reordena e apaga cargos (quem tinha fica sem)', () => {
    expect(createCargo(asAdmin(), { name: 'Estagiário', color: '#ff8800' }, deps).ok).toBe(true);
    expect(createCargo(asAdmin(), { name: 'estagiário', color: '#ff8800' }, deps)).toMatchObject({
      status: 409,
    });
    const est = deps.users.listCargos().at(-1)!;
    expect(est.name).toBe('Estagiário');
    updateUser(asAdmin(), beto.userId, { cargoId: est.id }, deps);

    expect(updateCargo(asAdmin(), est.id, { name: 'Estágio' }, deps).ok).toBe(true);
    expect(deps.users.publicProfile(deps.users.findById(beto.userId)!).cargo).toBe('Estágio');

    const ids = deps.users.listCargos().map((c) => c.id);
    expect(reorderCargos(asAdmin(), { ids: [est.id, ...ids.slice(0, -1)] }, deps).ok).toBe(true);
    expect(deps.users.listCargos()[0]!.name).toBe('Estágio');
    expect(reorderCargos(asAdmin(), { ids: [est.id] }, deps)).toMatchObject({ status: 400 });

    expect(deleteCargo(asAdmin(), est.id, deps).ok).toBe(true);
    expect(deps.users.findById(beto.userId)?.cargoId).toBeNull();
  });

  it('travar a decoração avisa a sala e aparece na visão geral', () => {
    const events: unknown[] = [];
    deps.moderation.on('room', (e) => events.push(e));
    expect(setRoom(asAdmin(), 'meeting', { decorLocked: true }, deps).ok).toBe(true);
    expect(setRoom(asAdmin(), 'nao-existe', { decorLocked: true }, deps)).toMatchObject({
      status: 404,
    });
    expect(events).toEqual([{ roomId: 'meeting', decorLocked: true }]);
    const res = overview(asAdmin(), deps);
    expect(res.ok && res.body.rooms.find((r) => r.id === 'meeting')?.decorLocked).toBe(true);
  });
});
