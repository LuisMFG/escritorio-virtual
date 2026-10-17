import { beforeEach, describe, expect, it } from 'vitest';
import { assignCargo } from './admin.js';
import type { RoomDeps } from './rooms.js';
import {
  changePassword,
  claim,
  login,
  logout,
  me,
  register,
  team,
  updateProfile,
  type Caller,
} from './auth.js';
import { callerOf, conta, makeDeps, registered as registeredWith } from './testDeps.js';

let deps: RoomDeps;

beforeEach(() => {
  deps = makeDeps();
});

const registered = (extra: Partial<typeof conta> = {}) => registeredWith(deps, extra);
const caller = (token: string): Caller => callerOf(deps, token);

describe('cadastro', () => {
  it('cria conta com convite certo; usuário minúsculo e visual padrão', async () => {
    const s = await registered();
    expect(s).toMatchObject({ username: 'ana', name: 'Ana', gender: 'M', cargo: null });
    expect(s.figure).toBe(deps.avatarManifest.defaults.M);
    expect(deps.users.findByToken(s.token)?.id).toBe(s.userId);
    // A senha nunca é guardada em texto puro.
    expect(deps.users.findById(s.userId)?.passwordHash).not.toContain('senha-boa-1');
  });

  it('recusa convite errado, usuário repetido e visual inválido', async () => {
    expect(await register({ ...conta, inviteCode: 'errado' }, deps)).toMatchObject({
      status: 401,
      body: { error: 'INVALID_INVITE' },
    });
    await registered();
    expect(await register({ ...conta, name: 'Outra' }, deps)).toMatchObject({
      status: 409,
      body: { error: 'USERNAME_TAKEN' },
    });
    expect(
      await register({ ...conta, username: 'bia', figure: 'hd-1-1', gender: 'F' }, deps),
    ).toMatchObject({ status: 400, body: { error: 'INVALID_FIGURE' } });
  });

  it('nome exibido em uso por alguém online é recusado com sugestão', async () => {
    deps.presence.add({ sessionId: 's1', userId: 'outro', name: 'Ana', roomId: 'reception' });
    expect(await register(conta, deps)).toMatchObject({
      status: 409,
      body: { error: 'NAME_IN_USE', suggestion: 'Ana 2' },
    });
  });

  it('sem ADMIN_USERNAMES, a primeira conta vira admin; com a lista, só quem está nela', async () => {
    expect((await registered()).role).toBe('admin');
    expect((await registered({ username: 'beto', name: 'Beto' })).role).toBe('member');

    deps.adminUsernames = ['caio'];
    expect((await registered({ username: 'caio', name: 'Caio' })).role).toBe('admin');
  });
});

describe('entrar', () => {
  it('usuário e senha certos abrem uma sessão nova (outro aparelho)', async () => {
    const first = await registered();
    const res = await login({ username: ' ANA ', password: 'senha-boa-1' }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body.userId).toBe(first.userId);
    expect(res.body.token).not.toBe(first.token);
    // As duas sessões valem ao mesmo tempo.
    expect(deps.users.findByToken(first.token)).toBeDefined();
    expect(deps.users.findByToken(res.body.token)).toBeDefined();
  });

  it('senha errada ou usuário inexistente dão o mesmo erro', async () => {
    await registered();
    const wrong = await login({ username: 'ana', password: 'outra-senha' }, deps);
    const nobody = await login({ username: 'ninguem', password: 'outra-senha' }, deps);
    expect(wrong).toMatchObject({ status: 401, body: { error: 'INVALID_CREDENTIALS' } });
    expect(nobody).toEqual(wrong);
  });

  it('quem entra na lista de admins vira admin no próximo login', async () => {
    await registered();
    await registered({ username: 'beto', name: 'Beto' });
    deps.adminUsernames = ['beto'];
    const res = await login({ username: 'beto', password: 'senha-boa-1' }, deps);
    expect(res.ok && res.body.role).toBe('admin');
  });

  it('me devolve a sessão do token; sair encerra só este aparelho ou todos', async () => {
    const a = await registered();
    const b = await login({ username: 'ana', password: 'senha-boa-1' }, deps);
    if (!b.ok) throw new Error();
    expect(me(caller(a.token), deps)).toMatchObject({ ok: true, body: { username: 'ana' } });

    logout(caller(a.token), false, deps);
    expect(deps.users.findByToken(a.token)).toBeUndefined();
    expect(deps.users.findByToken(b.body.token)).toBeDefined();

    logout(caller(b.body.token), true, deps);
    expect(deps.users.findByToken(b.body.token)).toBeUndefined();
  });
});

describe('conta antiga (só token do navegador)', () => {
  it('escolhe usuário e senha uma vez e passa a entrar com eles', async () => {
    const legacy = deps.users.create('Velho', 'hd-180-1.ch-210-66.lg-270-82');
    expect(me(caller(legacy.token), deps).body).toMatchObject({ username: null });

    const res = await claim(
      caller(legacy.token),
      { username: 'velho', password: 'nova-senha' },
      deps,
    );
    expect(res).toMatchObject({ ok: true, body: { username: 'velho', token: legacy.token } });
    expect(
      await claim(caller(legacy.token), { username: 'x2x', password: 'nova-senha' }, deps),
    ).toMatchObject({
      status: 409,
      body: { error: 'ACCOUNT_EXISTS' },
    });
    expect((await login({ username: 'velho', password: 'nova-senha' }, deps)).ok).toBe(true);
  });
});

describe('perfil', () => {
  it('muda nome, bio e aniversário; avisa as salas', async () => {
    const s = await registered();
    const seen: string[] = [];
    deps.users.events.on('updated', (u) => seen.push(u.name));
    const res = updateProfile(
      caller(s.token),
      { name: 'Ana Paula', bio: ' DBA ', birthday: '03-15' },
      deps,
    );
    expect(res).toMatchObject({
      ok: true,
      body: { name: 'Ana Paula', bio: 'DBA', birthday: '03-15' },
    });
    expect(seen).toEqual(['Ana Paula']);
    expect(updateProfile(caller(s.token), { birthday: '02-31' }, deps)).toMatchObject({
      status: 400,
    });
  });

  it('troca de senha confere a atual e derruba os outros aparelhos', async () => {
    const a = await registered();
    const b = await login({ username: 'ana', password: 'senha-boa-1' }, deps);
    if (!b.ok) throw new Error();
    expect(
      await changePassword(caller(a.token), { current: 'errada', next: 'nova-senha-1' }, deps),
    ).toMatchObject({ status: 403, body: { error: 'WRONG_PASSWORD' } });
    expect(
      (
        await changePassword(
          caller(a.token),
          { current: 'senha-boa-1', next: 'nova-senha-1' },
          deps,
        )
      ).ok,
    ).toBe(true);
    expect(deps.users.findByToken(a.token)).toBeDefined();
    expect(deps.users.findByToken(b.body.token)).toBeUndefined();
    expect((await login({ username: 'ana', password: 'nova-senha-1' }, deps)).ok).toBe(true);
  });
});

describe('cargos e equipe', () => {
  it('começa com os cargos da diretoria', () => {
    expect(deps.users.listCargos().map((c) => c.name)).toEqual([
      'Diretor',
      'Coordenador de TI',
      'Coordenador de Transparência Ativa',
      'Coordenador de Transparência Passiva',
      'Desenvolvedor',
      'DBA',
    ]);
  });

  it('só admin define cargo; a equipe mostra cargo e quem está online', async () => {
    const admin = await registered();
    const beto = await registered({ username: 'beto', name: 'Beto' });
    const dba = deps.users.listCargos().find((c) => c.name === 'DBA')!;

    expect(assignCargo(caller(beto.token), beto.userId, { cargoId: dba.id }, deps)).toMatchObject({
      status: 403,
    });
    expect(assignCargo(caller(admin.token), beto.userId, { cargoId: 999 }, deps)).toMatchObject({
      status: 404,
    });
    expect(assignCargo(caller(admin.token), beto.userId, { cargoId: dba.id }, deps).ok).toBe(true);

    deps.presence.add({ sessionId: 's', userId: beto.userId, name: 'Beto', roomId: 'pantry' });
    const res = team(deps);
    const b = res.ok ? res.body.members.find((m) => m.userId === beto.userId) : undefined;
    expect(b).toMatchObject({ cargo: { name: 'DBA' }, roomId: 'pantry' });
    expect(deps.users.publicProfile(deps.users.findById(beto.userId)!)).toMatchObject({
      cargo: 'DBA',
      cargoColor: dba.color,
    });

    expect(assignCargo(caller(admin.token), beto.userId, { cargoId: null }, deps).ok).toBe(true);
    expect(deps.users.findById(beto.userId)?.cargoId).toBeNull();
  });
});
