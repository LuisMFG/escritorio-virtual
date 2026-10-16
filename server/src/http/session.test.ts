import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { PresenceRegistry } from '../services/PresenceRegistry.js';
import { UserService } from '../services/UserService.js';
import { createSession, type SessionDeps } from './session.js';

let deps: SessionDeps;

beforeEach(() => {
  deps = {
    inviteCode: 'segredo',
    defaultFigure: 'hd-180-1.ch-210-66.lg-270-82',
    users: new UserService(openDatabase(':memory:')),
    presence: new PresenceRegistry(),
  };
});

describe('createSession', () => {
  it('cria usuário com convite certo e devolve token', () => {
    const res = createSession({ name: ' Ana ', inviteCode: 'segredo' }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body.name).toBe('Ana');
    expect(res.body.token.length).toBeGreaterThan(20);
    expect(res.body.figure).toBe(deps.defaultFigure);
    expect(deps.users.findByToken(res.body.token)?.id).toBe(res.body.userId);
  });

  it('recusa convite errado ou ausente', () => {
    expect(createSession({ name: 'Ana', inviteCode: 'errado' }, deps)).toMatchObject({
      status: 401,
      body: { error: 'INVALID_INVITE' },
    });
    expect(createSession({ name: 'Ana' }, deps)).toMatchObject({ status: 401 });
  });

  it('com token válido, reaproveita o usuário sem pedir convite e atualiza nome/visual', () => {
    const first = createSession({ name: 'Ana', inviteCode: 'segredo' }, deps);
    if (!first.ok) throw new Error('esperava sucesso');
    const again = createSession(
      { name: 'Ana Paula', token: first.body.token, figure: 'hd-600-1.ch-630-62.lg-695-62' },
      deps,
    );
    expect(again).toMatchObject({
      ok: true,
      body: {
        userId: first.body.userId,
        name: 'Ana Paula',
        figure: 'hd-600-1.ch-630-62.lg-695-62',
      },
    });
  });

  it('token inválido cai no fluxo normal (exige convite)', () => {
    expect(createSession({ name: 'Ana', token: 'inventado' }, deps)).toMatchObject({ status: 401 });
  });

  it('nome em uso por alguém online é recusado com sugestão; o próprio usuário pode reusar', () => {
    const ana = createSession({ name: 'Ana', inviteCode: 'segredo' }, deps);
    if (!ana.ok) throw new Error('esperava sucesso');
    deps.presence.add({
      sessionId: 's1',
      userId: ana.body.userId,
      name: 'Ana',
      roomId: 'reception',
    });

    expect(createSession({ name: 'ANA', inviteCode: 'segredo' }, deps)).toMatchObject({
      status: 409,
      body: { error: 'NAME_IN_USE', suggestion: 'ANA 2' },
    });
    expect(createSession({ name: 'Ana', token: ana.body.token }, deps).ok).toBe(true);
  });

  it('nome repetido é permitido se a pessoa não está online', () => {
    createSession({ name: 'Ana', inviteCode: 'segredo' }, deps);
    expect(createSession({ name: 'Ana', inviteCode: 'segredo' }, deps).ok).toBe(true);
  });

  it('valida nome e figure', () => {
    expect(createSession({ name: '<b>', inviteCode: 'segredo' }, deps)).toMatchObject({
      status: 400,
    });
    expect(createSession({ name: 'Ana', inviteCode: 'segredo', figure: 'xx' }, deps)).toMatchObject(
      {
        status: 400,
      },
    );
  });
});
