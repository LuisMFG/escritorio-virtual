import type { PetDeps } from './pets.js';
import type { AchievementDeps } from './achievements.js';
import type { ActivityDeps } from './activity.js';
import type { SpotifyDeps } from './spotify.js';
import { openDatabase } from '../db/client.js';
import { createServices } from '../services/index.js';
import type { MeetingDeps } from './meetings.js';
import { register, type Caller } from './auth.js';

/** Tudo que as rotas usam (os testes de cada área pegam a parte que precisam). */
export type TestDeps = MeetingDeps & PetDeps & AchievementDeps & ActivityDeps & SpotifyDeps;

/** Dependências das rotas sobre um banco em memória (testes). */
export function makeDeps(): TestDeps {
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
    furni: svc.furni,
    furniDefs: svc.furniDefs,
    meetings: svc.meetings,
    pets: svc.pets,
    achievements: svc.achievements,
    apiTokens: svc.apiTokens,
    activity: svc.activity,
    spotify: svc.spotify,
    spotifyPoller: svc.spotifyPoller,
  };
}

export const conta = {
  inviteCode: 'segredo',
  username: 'Ana',
  password: 'senha-boa-1',
  name: ' Ana ',
};

export async function registered(deps: MeetingDeps, extra: Partial<typeof conta> = {}) {
  const res = await register({ ...conta, ...extra }, deps);
  if (!res.ok) throw new Error(res.body.message);
  return res.body;
}

export function callerOf(deps: MeetingDeps, token: string): Caller {
  const user = deps.users.findByToken(token);
  if (!user) throw new Error('token inválido');
  return { user, token };
}
