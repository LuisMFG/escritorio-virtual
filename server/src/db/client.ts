import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOMS } from '@office/shared';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/**
 * Abre o SQLite (arquivo ou `:memory:` nos testes), aplica as migrations pendentes e
 * garante as salas iniciais.
 */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  seedRooms(db);
  return db;
}

/**
 * Sincroniza salas e portas com `shared/rooms.ts`. Enquanto não existe editor de salas
 * (fora da v1), o código é a fonte da verdade do formato das salas; os móveis passam a
 * viver no banco na Fase 6.
 */
function seedRooms(db: Db): void {
  for (const room of ROOMS) {
    const values = {
      name: room.name,
      heightmap: room.heightmap,
      spawnX: room.spawn.x,
      spawnY: room.spawn.y,
      spawnDir: room.spawn.dir,
      floorColor: room.floorColor,
      wallColor: room.wallColor,
    };
    db.insert(schema.rooms)
      .values({ id: room.id, ...values })
      .onConflictDoUpdate({ target: schema.rooms.id, set: values })
      .run();
  }
  db.transaction((tx) => {
    tx.delete(schema.roomDoors).run();
    for (const room of ROOMS) {
      for (const d of room.doors) {
        tx.insert(schema.roomDoors)
          .values({
            roomId: room.id,
            x: d.x,
            y: d.y,
            targetRoomId: d.targetRoomId,
            targetX: d.targetX,
            targetY: d.targetY,
            targetDir: d.targetDir,
          })
          .run();
      }
    }
  });
}
