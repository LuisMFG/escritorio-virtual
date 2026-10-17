import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOMS } from '@office/shared';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
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

const SEEDED_KEY = 'rooms_seeded';

/**
 * Salas iniciais (`shared/rooms.ts`). Desde a Fase 13 o **banco é a fonte da verdade**: a
 * semente entra uma única vez. Bancos de antes da Fase 13 (em que o código sobrescrevia as
 * salas a cada boot) recebem uma última sincronização, com os móveis acompanhando a linha
 * extra que a Sala de reunião e a Copa ganharam (linha 0 só para portas).
 */
function seedRooms(db: Db): void {
  const flag = db.select().from(schema.settings).where(eq(schema.settings.key, SEEDED_KEY)).get();
  if (flag) return;
  db.transaction((tx) => {
    ROOMS.forEach((room, sort) => {
      const values = {
        name: room.name,
        heightmap: room.heightmap,
        spawnX: room.spawn.x,
        spawnY: room.spawn.y,
        spawnDir: room.spawn.dir,
        floorColor: room.floorColor,
        wallColor: room.wallColor,
        sort,
      };
      const existing = tx.select().from(schema.rooms).where(eq(schema.rooms.id, room.id)).get();
      if (!existing) {
        tx.insert(schema.rooms)
          .values({ id: room.id, ...values, furniSeeded: true })
          .run();
        for (const f of room.furni) {
          tx.insert(schema.roomFurni)
            .values({ ...f, roomId: room.id, updatedAt: new Date() })
            .onConflictDoNothing()
            .run();
        }
      } else {
        // Ganhou uma linha vazia em cima: os móveis descem junto.
        const shifted =
          JSON.stringify(room.heightmap.slice(1)) === JSON.stringify(existing.heightmap);
        if (shifted) {
          tx.update(schema.roomFurni)
            .set({ y: sql`${schema.roomFurni.y} + 1` })
            .where(eq(schema.roomFurni.roomId, room.id))
            .run();
        }
        tx.update(schema.rooms).set(values).where(eq(schema.rooms.id, room.id)).run();
      }
    });
    // Portas depois de todas as salas existirem (chave estrangeira para a sala de destino).
    for (const room of ROOMS) {
      tx.delete(schema.roomDoors).where(eq(schema.roomDoors.roomId, room.id)).run();
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
    tx.insert(schema.settings).values({ key: SEEDED_KEY, value: '1' }).run();
  });
}
