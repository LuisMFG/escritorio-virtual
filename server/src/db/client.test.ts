import { RECEPTION, RECEPTION_LAYOUT } from '@office/shared';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UserService } from '../services/UserService.js';
import { openDatabase, sqliteOf } from './client.js';
import {
  boardNotes,
  roomDoors,
  roomFurni,
  rooms,
  settings,
  teleportLinks,
  whiteboardStrokes,
} from './schema.js';

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

  it('a Recepção nova não apaga os traços do quadro nem os recados dos móveis que continuam', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'escritorio-layout-')), 'db.sqlite');
    let db = openDatabase(file);
    const board = RECEPTION.furni.find((f) => f.defId === 'uni_c23_whiteboard')!;
    const userId = new UserService(db).create('Ana', 'hd-180-1').user.id;
    const data = { tool: 'pen', color: '#000000', width: 3, points: [1, 2, 3, 4] };
    db.insert(whiteboardStrokes)
      .values({ furniId: board.id, userId, data, createdAt: new Date() })
      .run();
    db.insert(boardNotes)
      .values({ furniId: board.id, userId, text: 'oi', createdAt: new Date() })
      .run();
    db.update(settings).set({ value: 'antigo' }).where(eq(settings.key, 'reception_layout')).run();
    sqliteOf(db).close();

    db = openDatabase(file);
    expect(db.select().from(whiteboardStrokes).all()).toHaveLength(1);
    expect(db.select().from(boardNotes).all()).toMatchObject([{ text: 'oi' }]);
    sqliteOf(db).close();
  });

  it('banco em WAL com gravação NORMAL (sem forçar o disco a cada mensagem)', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'escritorio-sync-')), 'db.sqlite'));
    expect(sqliteOf(db).pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqliteOf(db).pragma('synchronous', { simple: true })).toBe(1);
    sqliteOf(db).close();
  });
});
