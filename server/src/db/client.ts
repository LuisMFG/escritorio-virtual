import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEPTION, RECEPTION_LAYOUT, ROOMS } from '@office/shared';
import Database from 'better-sqlite3';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

/** Conexão SQLite por trás de cada `Db` (para a API de backup). */
const connections = new WeakMap<Db, Database.Database>();

export function sqliteOf(db: Db): Database.Database {
  const conn = connections.get(db);
  if (!conn) throw new Error('Banco sem conexão SQLite registrada.');
  return conn;
}

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/**
 * Abre o SQLite (arquivo ou `:memory:` nos testes), aplica as migrations pendentes e
 * garante as salas iniciais.
 */
/** O banco responde a uma consulta (para o `/healthz`)? */
export function dbHealthy(db: Db): boolean {
  try {
    sqliteOf(db).prepare('select 1').get();
    return true;
  } catch (err) {
    console.error('[healthz] banco sem resposta:', err);
    return false;
  }
}

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  connections.set(db, sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  seedRooms(db);
  applyReceptionLayout(db);
  return db;
}

const RECEPTION_LAYOUT_KEY = 'reception_layout';

/**
 * Layout da Recepção (o escritório de verdade, desde 19/10/2026): quando a versão da semente muda,
 * o banco recebe a forma, as portas, as cores e os móveis novos uma única vez. Os móveis que
 * estavam lá saem (com as ligações de teleporte); as outras salas não mudam — as portas delas
 * acham a chegada nova sozinhas.
 */
function applyReceptionLayout(db: Db): void {
  const flag = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, RECEPTION_LAYOUT_KEY))
    .get();
  if (flag?.value === RECEPTION_LAYOUT) return;
  const room = db.select().from(schema.rooms).where(eq(schema.rooms.id, RECEPTION.id)).get();
  db.transaction((tx) => {
    if (room) {
      const old = tx
        .select({ id: schema.roomFurni.id })
        .from(schema.roomFurni)
        .where(eq(schema.roomFurni.roomId, RECEPTION.id))
        .all()
        .map((r) => r.id);
      if (old.length > 0) {
        tx.delete(schema.teleportLinks)
          .where(
            or(
              inArray(schema.teleportLinks.furniId, old),
              inArray(schema.teleportLinks.targetId, old),
            ),
          )
          .run();
        tx.delete(schema.roomFurni).where(eq(schema.roomFurni.roomId, RECEPTION.id)).run();
      }
      tx.update(schema.rooms)
        .set({
          heightmap: RECEPTION.heightmap,
          spawnX: RECEPTION.spawn.x,
          spawnY: RECEPTION.spawn.y,
          spawnDir: RECEPTION.spawn.dir,
          floorColor: RECEPTION.floorColor,
          wallColor: RECEPTION.wallColor,
          ambient: 'office',
        })
        .where(eq(schema.rooms.id, RECEPTION.id))
        .run();
      tx.delete(schema.roomDoors).where(eq(schema.roomDoors.roomId, RECEPTION.id)).run();
      for (const d of RECEPTION.doors) {
        const target = tx
          .select({ id: schema.rooms.id })
          .from(schema.rooms)
          .where(eq(schema.rooms.id, d.targetRoomId))
          .get();
        if (!target) continue;
        tx.insert(schema.roomDoors)
          .values({
            roomId: RECEPTION.id,
            x: d.x,
            y: d.y,
            targetRoomId: d.targetRoomId,
            targetX: 0,
            targetY: 0,
            targetDir: 2,
          })
          .run();
      }
      for (const f of RECEPTION.furni) {
        tx.insert(schema.roomFurni)
          .values({ ...f, roomId: RECEPTION.id, updatedAt: new Date() })
          .run();
      }
    }
    tx.insert(schema.settings)
      .values({ key: RECEPTION_LAYOUT_KEY, value: RECEPTION_LAYOUT })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: RECEPTION_LAYOUT } })
      .run();
  });
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
