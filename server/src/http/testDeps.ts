import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PetDeps } from './pets.js';
import type { AchievementDeps } from './achievements.js';
import type { ActivityDeps } from './activity.js';
import type { SpotifyDeps } from './spotify.js';
import type { AnnouncementDeps } from './announcements.js';
import type { KudosDeps } from './kudos.js';
import type { UploadDeps } from './uploads.js';
import type { JiraDeps } from './jira.js';
import type { EffectDeps } from './effects.js';
import type { LookDeps } from './looks.js';
import type { FurniDeps } from './furni.js';
import type { TeleportDeps } from './teleports.js';
import type { CatalogItem, FurniManifestEntry } from '@office/shared';
import { openDatabase } from '../db/client.js';
import { createServices } from '../services/index.js';
import type { MeetingDeps } from './meetings.js';
import { register, type Caller } from './auth.js';

/** Tudo que as rotas usam (os testes de cada área pegam a parte que precisam). */
export type TestDeps = MeetingDeps &
  PetDeps &
  AchievementDeps &
  ActivityDeps &
  SpotifyDeps &
  AnnouncementDeps &
  KudosDeps &
  UploadDeps &
  JiraDeps &
  EffectDeps &
  LookDeps &
  FurniDeps &
  TeleportDeps;

/** Dependências das rotas sobre um banco em memória (testes). */
export function makeDeps(
  opts: {
    measureFurni?: (item: CatalogItem, id: string) => Promise<FurniManifestEntry>;
    catalogFile?: string;
  } = {},
): TestDeps {
  const svc = createServices(
    openDatabase(':memory:'),
    { inviteCode: 'segredo' },
    undefined,
    {
      dir: mkdtempSync(join(tmpdir(), 'escritorio-teste-backups-')),
      keep: 7,
    },
    mkdtempSync(join(tmpdir(), 'escritorio-teste-uploads-')),
    opts,
  );
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
    furniCatalog: svc.furniCatalog,
    meetings: svc.meetings,
    pets: svc.pets,
    achievements: svc.achievements,
    apiTokens: svc.apiTokens,
    activity: svc.activity,
    spotify: svc.spotify,
    spotifyPoller: svc.spotifyPoller,
    backups: svc.backups,
    announcements: svc.announcements,
    kudos: svc.kudos,
    uploads: svc.uploads,
    linkPreviews: svc.linkPreviews,
    search: svc.search,
    jira: svc.jira,
    jiraPoller: svc.jiraPoller,
    db: svc.db,
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
