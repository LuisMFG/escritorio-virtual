import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findRoom,
  parseAvatarManifest,
  parseFurniManifest,
  type AvatarManifest,
  type FurniManifestEntry,
  type RoomLayoutMessage,
} from '@office/shared';
import { asc, eq } from 'drizzle-orm';
import { ROOT_DIR } from '../config.js';
import type { Db } from '../db/client.js';
import { roomDoors, rooms } from '../db/schema.js';

/** Catálogo de móveis do manifesto do cliente (até a Fase 6 levar isso para o banco). */
export function loadFurniDefs(): Map<string, FurniManifestEntry> {
  const path = resolve(ROOT_DIR, 'client', 'public', 'assets', 'furni', 'manifest.json');
  const manifest = parseFurniManifest(JSON.parse(readFileSync(path, 'utf8')));
  return new Map(manifest.items.map((i) => [i.id, i]));
}

/** Manifesto do avatar (gerado pelo `assets:sync`): base da validação de visuais. */
export function loadAvatarManifest(): AvatarManifest {
  const path = resolve(ROOT_DIR, 'client', 'public', 'assets', 'avatar', 'manifest.json');
  return parseAvatarManifest(JSON.parse(readFileSync(path, 'utf8')));
}

export class RoomRepository {
  constructor(private readonly db: Db) {}

  /** Salas na ordem do seed (Recepção primeiro). */
  list(): { id: string; name: string }[] {
    return this.db.select({ id: rooms.id, name: rooms.name }).from(rooms).all();
  }

  /** Layout completo da sala: dados e portas do banco + móveis fixos de `shared/rooms.ts`. */
  getLayout(roomId: string): RoomLayoutMessage | undefined {
    const row = this.db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!row) return undefined;
    const names = new Map(this.list().map((r) => [r.id, r.name]));
    const doors = this.db
      .select()
      .from(roomDoors)
      .where(eq(roomDoors.roomId, roomId))
      .orderBy(asc(roomDoors.id))
      .all()
      .map((d) => ({
        x: d.x,
        y: d.y,
        targetRoomId: d.targetRoomId,
        targetX: d.targetX,
        targetY: d.targetY,
        targetDir: d.targetDir,
        targetName: names.get(d.targetRoomId),
      }));
    return {
      roomId: row.id,
      name: row.name,
      heightmap: row.heightmap,
      spawn: { x: row.spawnX, y: row.spawnY, dir: row.spawnDir },
      floorColor: row.floorColor,
      wallColor: row.wallColor,
      doors,
      furni: findRoom(roomId)?.furni ?? [],
    };
  }
}
