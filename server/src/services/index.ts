import type { AvatarManifest, FurniManifestEntry } from '@office/shared';
import type { Db } from '../db/client.js';
import { ChatService } from './ChatService.js';
import { FurniService } from './FurniService.js';
import { PresenceRegistry } from './PresenceRegistry.js';
import { TransferRegistry } from './TransferRegistry.js';
import { loadAvatarManifest, loadFurniDefs, RoomRepository } from './RoomRepository.js';
import { UserService } from './UserService.js';
import { DmService } from './DmService.js';
import { BoardService } from './BoardService.js';
import { WhiteboardService } from './WhiteboardService.js';
import { MeetingService } from './MeetingService.js';
import { GameService } from './GameService.js';
import { PetService } from './PetService.js';
import { AchievementService } from './AchievementService.js';
import { ApiTokenService } from './ApiTokenService.js';
import { ActivityService } from './ActivityService.js';
import { SpotifyService } from './SpotifyService.js';
import { SpotifyPoller } from './SpotifyPoller.js';
import { BackupService } from './BackupService.js';
import { AnnouncementService } from './AnnouncementService.js';
import { PollService } from './PollService.js';
import { KudosService } from './KudosService.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpotifyConfig } from '../config.js';
import { AuditService } from './AuditService.js';
import { SettingsService } from './SettingsService.js';
import { EventEmitter } from 'node:events';
import type { KickScope } from '@office/shared';

/** Ações de moderação que as salas abertas precisam aplicar. */
export interface ModerationEvents {
  /** Tirar alguém da sala (`roomId`) ou do escritório (todas as salas). */
  kick: [{ userId: string; scope: KickScope; roomId?: string; byName: string }];
  /** Decoração travada/destravada numa sala. */
  room: [{ roomId: string; decorLocked: boolean }];
  /** Formato, portas ou nome da sala mudaram: a instância aberta recarrega. */
  layout: [{ roomId: string }];
  /** Salas criadas, renomeadas ou excluídas (o lobby atualiza a lista). */
  rooms: [];
}

export interface Services {
  db: Db;
  users: UserService;
  presence: PresenceRegistry;
  rooms: RoomRepository;
  chat: ChatService;
  dms: DmService;
  boards: BoardService;
  whiteboards: WhiteboardService;
  meetings: MeetingService;
  games: GameService;
  pets: PetService;
  achievements: AchievementService;
  apiTokens: ApiTokenService;
  activity: ActivityService;
  spotify: SpotifyService;
  spotifyPoller: SpotifyPoller;
  backups: BackupService;
  announcements: AnnouncementService;
  polls: PollService;
  kudos: KudosService;
  furni: FurniService;
  transfers: TransferRegistry;
  settings: SettingsService;
  audit: AuditService;
  moderation: EventEmitter<ModerationEvents>;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
  avatarManifest: AvatarManifest;
}

export function createServices(
  db: Db,
  defaults = { inviteCode: 'convite' },
  spotifyConfig?: SpotifyConfig,
  backup = { dir: join(tmpdir(), 'escritorio-backups'), keep: 7 },
): Services {
  const users = new UserService(db);
  users.seedCargos();
  const moderation = new EventEmitter<ModerationEvents>();
  moderation.setMaxListeners(100);
  const meetings = new MeetingService(db);
  const pets = new PetService(db);
  const achievements = new AchievementService(db, users);
  const presence = new PresenceRegistry();
  const activity = new ActivityService(users);
  const spotify = new SpotifyService(db, spotifyConfig);
  // Conquistas que vêm da agenda e dos pets.
  meetings.events.on('invited', (m) => achievements.unlock(m.createdBy, 'organizer'));
  meetings.events.on('reminder', (m) => {
    for (const a of m.attendees) if (a.response === 'yes') achievements.bump(a.userId, 'meetings');
  });
  pets.events.on('changed', (userId, pet) => {
    if (pet) achievements.unlock(userId, 'pet_owner');
  });
  return {
    db,
    users,
    presence,
    rooms: new RoomRepository(db),
    chat: new ChatService(db),
    dms: new DmService(db),
    boards: new BoardService(db),
    whiteboards: new WhiteboardService(db),
    meetings,
    games: new GameService(db),
    pets,
    achievements,
    apiTokens: new ApiTokenService(db),
    activity,
    spotify,
    spotifyPoller: new SpotifyPoller(spotify, presence, activity),
    backups: new BackupService(db, backup.dir, backup.keep),
    announcements: new AnnouncementService(db),
    polls: new PollService(db),
    kudos: new KudosService(db),
    furni: new FurniService(db),
    transfers: new TransferRegistry(),
    settings: new SettingsService(db, defaults),
    audit: new AuditService(db),
    moderation,
    furniDefs: loadFurniDefs(),
    avatarManifest: loadAvatarManifest(),
  };
}

/**
 * As salas Colyseus são instanciadas pelo framework, então os serviços ficam num
 * registro do processo, configurado uma vez no boot (ou em cada teste).
 */
let current: Services | undefined;

export function setServices(services: Services): void {
  current = services;
}

export function services(): Services {
  if (!current) throw new Error('Serviços não configurados (chame setServices no boot).');
  return current;
}
