import type { AvatarManifest, FurniManifestEntry } from '@office/shared';
import type { Db } from '../db/client.js';
import { ChatService } from './ChatService.js';
import { FurniService } from './FurniService.js';
import { PresenceRegistry } from './PresenceRegistry.js';
import { TransferRegistry } from './TransferRegistry.js';
import { loadAvatarManifest, loadFurniDefs, RoomRepository } from './RoomRepository.js';
import { UserService } from './UserService.js';

export interface Services {
  db: Db;
  users: UserService;
  presence: PresenceRegistry;
  rooms: RoomRepository;
  chat: ChatService;
  furni: FurniService;
  transfers: TransferRegistry;
  furniDefs: ReadonlyMap<string, FurniManifestEntry>;
  avatarManifest: AvatarManifest;
}

export function createServices(db: Db): Services {
  const users = new UserService(db);
  users.seedCargos();
  return {
    db,
    users,
    presence: new PresenceRegistry(),
    rooms: new RoomRepository(db),
    chat: new ChatService(db),
    furni: new FurniService(db),
    transfers: new TransferRegistry(),
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
