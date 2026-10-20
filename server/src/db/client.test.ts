import { RECEPTION, RECEPTION_LAYOUT } from '@office/shared';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, sqliteOf } from './client.js';
import { roomDoors, roomFurni, rooms, settings, teleportLinks } from './schema.js';

describe('layout da Recepção (o escritório de verdade)', () => {
  it('banco com a Recepção antiga recebe a nova uma vez; o que o pessoal colocar depois fica', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'escritorio-layout-')), 'db.sqlite');
    let db = openDatabase(file);
    // Simula a Recepção de antes: outra forma, um móvel antigo ligado a um teleporte.
    db.update(rooms)
      .set({ heightmap: ['x0000', 'x0000'] })
      .where(eq(rooms.id, RECEPTION.id))
      .run();
    db.delete(roomFurni).where(eq(roomFurni.roomId, RECEPTION.id)).run();
    db.insert(roomFurni)
      .values({
        id: 'antigo',
        roomId: RECEPTION.id,
        defId: 'chair_norja',
        x: 2,
        y: 1,
        z: 0,
        rot: 0,
        updatedAt: new Date(),
      })
      .run();
    db.insert(teleportLinks).values({ furniId: 'antigo', targetId: 'outro' }).run();
    db.update(settings).set({ value: 'antigo' }).where(eq(settings.key, 'reception_layout')).run();
    sqliteOf(db).close();

    db = openDatabase(file);
    const furni = db.select().from(roomFurni).where(eq(roomFurni.roomId, RECEPTION.id)).all();
    expect(furni).toHaveLength(RECEPTION.furni.length);
    expect(furni.some((f) => f.id === 'antigo')).toBe(false);
    expect(db.select().from(teleportLinks).all()).toEqual([]);
    const room = db.select().from(rooms).where(eq(rooms.id, RECEPTION.id)).get()!;
    expect(room.heightmap).toEqual(RECEPTION.heightmap);
    expect(room.ambient).toBe('office');
    const doors = db.select().from(roomDoors).where(eq(roomDoors.roomId, RECEPTION.id)).all();
    expect(doors.map((d) => [d.x, d.y, d.targetRoomId]).sort()).toEqual(
      RECEPTION.doors.map((d) => [d.x, d.y, d.targetRoomId]).sort(),
    );

    // Alguém decora depois: abrir de novo não apaga.
    db.insert(roomFurni)
      .values({
        id: 'novo',
        roomId: RECEPTION.id,
        defId: 'plant_yukka',
        x: 15,
        y: 18,
        z: 0,
        rot: 0,
        updatedAt: new Date(),
      })
      .run();
    sqliteOf(db).close();
    db = openDatabase(file);
    expect(db.select().from(roomFurni).where(eq(roomFurni.id, 'novo')).get()).toBeDefined();
    expect(
      db.select().from(settings).where(eq(settings.key, 'reception_layout')).get()?.value,
    ).toBe(RECEPTION_LAYOUT);
    sqliteOf(db).close();
  });
});
