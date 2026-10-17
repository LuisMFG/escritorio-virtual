import { openDatabase } from '../db/client.js';
import { createServices } from '../services/index.js';
import type { AdminDeps } from './admin.js';
import { register, type Caller } from './auth.js';

/** Dependências das rotas sobre um banco em memória (testes). */
export function makeDeps(): AdminDeps {
  const svc = createServices(openDatabase(':memory:'), { inviteCode: 'segredo' });
  return {
    inviteCode: () => svc.settings.inviteCode(),
    adminUsernames: [],
    avatarManifest: svc.avatarManifest,
    users: svc.users,
    presence: svc.presence,
    audit: svc.audit,
    settings: svc.settings,
    rooms: svc.rooms,
    moderation: svc.moderation,
  };
}

export const conta = {
  inviteCode: 'segredo',
  username: 'Ana',
  password: 'senha-boa-1',
  name: ' Ana ',
};

export async function registered(deps: AdminDeps, extra: Partial<typeof conta> = {}) {
  const res = await register({ ...conta, ...extra }, deps);
  if (!res.ok) throw new Error(res.body.message);
  return res.body;
}

export function callerOf(deps: AdminDeps, token: string): Caller {
  const user = deps.users.findByToken(token);
  if (!user) throw new Error('token inválido');
  return { user, token };
}
