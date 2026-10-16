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

/** Insere as salas definidas em `shared/rooms.ts` que ainda não existem no banco. */
function seedRooms(db: Db): void {
  for (const room of ROOMS) {
    db.insert(schema.rooms)
      .values({
        id: room.id,
        name: room.name,
        heightmap: room.heightmap,
        spawnX: room.spawn.x,
        spawnY: room.spawn.y,
        spawnDir: room.spawn.dir,
        floorColor: room.floorColor,
        wallColor: room.wallColor,
      })
      .onConflictDoNothing()
      .run();
  }
}
