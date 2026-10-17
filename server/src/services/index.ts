import type { AvatarManifest, FurniManifestEntry } from '@office/shared';
import type { Db } from '../db/client.js';
import { ChatService } from './ChatService.js';
import { FurniService } from './FurniService.js';
import { PresenceRegistry } from './PresenceRegistry.js';
import { TransferRegistry } from './TransferRegistry.js';
import { loadAvatarManifest, loadFurniDefs, RoomRepository } from './RoomRepository.js';
import { UserService } from './UserService.js';
import { DmService } from './DmService.js';
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
  furni: FurniService;
  transfers: TransferRegistry;
  settings: SettingsService;
  audit: AuditService;
  moderation: EventEmitter<ModerationEvents>;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
  avatarManifest: AvatarManifest;
}

export function createServices(db: Db, defaults = { inviteCode: 'convite' }): Services {
  const users = new UserService(db);
  users.seedCargos();
  const moderation = new EventEmitter<ModerationEvents>();
  moderation.setMaxListeners(100);
  return {
    db,
    users,
    presence: new PresenceRegistry(),
    rooms: new RoomRepository(db),
    chat: new ChatService(db),
    dms: new DmService(db),
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
