import { GAMES, parseHeightmap, RECEPTION, RoomGrid, findPath } from '@office/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/client.js';
import { roomDoors, roomFurni, rooms, settings } from '../db/schema.js';
import { loadFurniDefs, RoomRepository } from './RoomRepository.js';

const defs = loadFurniDefs();

/** Banco como era antes da Fase 57: sem o Salão de Jogos e sem a porta na Recepção. */
function oldDatabase(): Db {
  const db = openDatabase(':memory:');
  db.delete(roomDoors).where(eq(roomDoors.targetRoomId, GAMES.id)).run();
  db.delete(roomDoors).where(eq(roomDoors.roomId, GAMES.id)).run();
  db.delete(roomFurni).where(eq(roomFurni.roomId, GAMES.id)).run();
  db.delete(rooms).where(eq(rooms.id, GAMES.id)).run();
  // A parede do fundo sem a porta do Salão (x = 15).
  const heightmap = RECEPTION.heightmap.map((row, y) =>
    y === 0 ? `${row.slice(0, 15)}x${row.slice(16)}` : row,
  );
  db.update(rooms).set({ heightmap }).where(eq(rooms.id, RECEPTION.id)).run();
  db.delete(settings).where(eq(settings.key, 'games_room')).run();
  return db;
}

const doorsOf = (db: Db, roomId: string) =>
  db.select().from(roomDoors).where(eq(roomDoors.roomId, roomId)).all();

describe('Salão de Jogos nos bancos de antes (Fase 57)', () => {
  it('chega uma vez, com os móveis e a porta na parede do fundo da Recepção', () => {
    const db = oldDatabase();
    const repo = new RoomRepository(db);
    expect(repo.exists(GAMES.id)).toBe(false);
    expect(doorsOf(db, RECEPTION.id).some((d) => d.targetRoomId === GAMES.id)).toBe(false);

    expect(repo.ensureGamesRoom(defs).sort()).toEqual([GAMES.id, RECEPTION.id].sort());
    expect(db.select().from(roomFurni).where(eq(roomFurni.roomId, GAMES.id)).all()).toHaveLength(
      GAMES.furni.length,
    );
    expect(doorsOf(db, GAMES.id).map((d) => [d.x, d.y, d.targetRoomId])).toEqual([
      [0, 4, RECEPTION.id],
    ]);
    const back = doorsOf(db, RECEPTION.id).find((d) => d.targetRoomId === GAMES.id);
    expect(back).toMatchObject({ x: 15, y: 0 });
    const reception = db.select().from(rooms).where(eq(rooms.id, RECEPTION.id)).get()!;
    expect(reception.heightmap[0]![15]).toBe('0');
    // A chegada pela porta é logo dentro dela, dos dois lados.
    expect(repo.getLayout(GAMES.id)!.doors[0]).toMatchObject({ targetX: 15, targetY: 1 });
    expect(
      repo.getLayout(RECEPTION.id)!.doors.find((d) => d.targetRoomId === GAMES.id),
    ).toMatchObject({ targetX: 1, targetY: 4, targetName: 'Salão de Jogos' });

    // Uma vez só: excluída pelo admin, a sala não volta.
    expect(repo.ensureGamesRoom(defs)).toEqual([]);
    repo.delete(GAMES.id);
    expect(repo.ensureGamesRoom(defs)).toEqual([]);
    expect(repo.exists(GAMES.id)).toBe(false);
  });

  it('com o lugar pensado ocupado, a porta vai para o lugar livre mais perto da entrada', () => {
    const db = oldDatabase();
    // Alguém pôs uma planta logo dentro de onde a porta ficaria.
    db.insert(roomFurni)
      .values({
        id: 'planta-no-caminho',
        roomId: RECEPTION.id,
        defId: 'plant_yukka',
        x: 15,
        y: 1,
        z: 0,
        rot: 0,
        updatedAt: new Date(),
      })
      .run();
    new RoomRepository(db).ensureGamesRoom(defs);
    const back = doorsOf(db, RECEPTION.id).find((d) => d.targetRoomId === GAMES.id)!;
    expect(back).toBeDefined();
    expect([back.x, back.y]).not.toEqual([15, 0]);
    // A porta nova é alcançável a partir da entrada.
    const reception = db.select().from(rooms).where(eq(rooms.id, RECEPTION.id)).get()!;
    const furni = db.select().from(roomFurni).where(eq(roomFurni.roomId, RECEPTION.id)).all();
    const grid = new RoomGrid(parseHeightmap(reception.heightmap), furni, defs, {
      seatsAsGoal: false,
    });
    expect(findPath(grid, { x: reception.spawnX, y: reception.spawnY }, back)).not.toBeNull();
  });

  it('instalação nova já nasce com o Salão: nada muda', () => {
    const db = openDatabase(':memory:');
    expect(new RoomRepository(db).ensureGamesRoom(defs)).toEqual([]);
    expect(doorsOf(db, RECEPTION.id).find((d) => d.targetRoomId === GAMES.id)).toMatchObject({
      x: 15,
      y: 0,
    });
  });
});
