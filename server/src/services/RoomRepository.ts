import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseFurniManifest,
  ROOMS,
  type FurniManifestEntry,
  type RoomLayoutMessage,
} from '@office/shared';
import { eq } from 'drizzle-orm';
import { ROOT_DIR } from '../config.js';
import type { Db } from '../db/client.js';
import { rooms } from '../db/schema.js';

/** Catálogo de móveis do manifesto do cliente (até a Fase 6 levar isso para o banco). */
export function loadFurniDefs(): Map<string, FurniManifestEntry> {
  const path = resolve(ROOT_DIR, 'client', 'public', 'assets', 'furni', 'manifest.json');
  const manifest = parseFurniManifest(JSON.parse(readFileSync(path, 'utf8')));
  return new Map(manifest.items.map((i) => [i.id, i]));
}

export class RoomRepository {
  constructor(private readonly db: Db) {}

  /** Layout completo da sala: dados do banco + portas e móveis fixos de `shared/rooms.ts`. */
  getLayout(roomId: string): RoomLayoutMessage | undefined {
    const row = this.db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!row) return undefined;
    const def = ROOMS.find((r) => r.id === roomId);
    return {
      roomId: row.id,
      name: row.name,
      heightmap: row.heightmap,
      spawn: { x: row.spawnX, y: row.spawnY, dir: row.spawnDir },
      floorColor: row.floorColor,
      wallColor: row.wallColor,
      doors: def?.doors ?? [],
      furni: def?.furni ?? [],
    };
  }
}
