import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  defaultRoomHeightmap,
  doorInside,
  findDoorSpot,
  parseAvatarManifest,
  parseFurniManifest,
  parseHeightmap,
  RECEPTION,
  ROOM_MAX_DOORS,
  type AvatarManifest,
  type FurniDef,
  type FurniManifestEntry,
  type RoomEdit,
  type RoomEditorData,
  type RoomLayoutMessage,
} from '@office/shared';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { ROOT_DIR } from '../config.js';
import type { Db } from '../db/client.js';
import { chatMessages, roomDoors, roomFurni, rooms } from '../db/schema.js';

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

  /** Salas na ordem das listas (Recepção primeiro, as novas no fim). */
  list(): { id: string; name: string; decorLocked: boolean }[] {
    return this.db
      .select({ id: rooms.id, name: rooms.name, decorLocked: rooms.decorLocked })
      .from(rooms)
      .orderBy(asc(rooms.sort), asc(rooms.id))
      .all();
  }

  exists(roomId: string): boolean {
    return Boolean(this.db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).get());
  }

  isDecorLocked(roomId: string): boolean {
    return Boolean(
      this.db.select({ v: rooms.decorLocked }).from(rooms).where(eq(rooms.id, roomId)).get()?.v,
    );
  }

  /** Devolve `false` se a sala não existe. */
  setDecorLocked(roomId: string, locked: boolean): boolean {
    const res = this.db
      .update(rooms)
      .set({ decorLocked: locked })
      .where(eq(rooms.id, roomId))
      .run();
    return res.changes > 0;
  }

  private doorsOf(roomId: string) {
    return this.db
      .select()
      .from(roomDoors)
      .where(eq(roomDoors.roomId, roomId))
      .orderBy(asc(roomDoors.id))
      .all();
  }

  /**
   * Onde se chega ao passar por uma porta de `fromRoomId` para `toRoomId`: logo dentro da
   * porta de volta (se existir) ou na entrada da sala de destino.
   */
  private arrival(
    fromRoomId: string,
    toRoomId: string,
  ): { x: number; y: number; dir: number } | null {
    const target = this.db.select().from(rooms).where(eq(rooms.id, toRoomId)).get();
    if (!target) return null;
    const map = parseHeightmap(target.heightmap);
    for (const d of this.doorsOf(toRoomId)) {
      if (d.targetRoomId !== fromRoomId) continue;
      const inside = doorInside(map, d.x, d.y);
      if (inside) return inside;
    }
    return { x: target.spawnX, y: target.spawnY, dir: target.spawnDir };
  }

  /** Layout completo da sala, com o destino de cada porta calculado agora. */
  getLayout(roomId: string): RoomLayoutMessage | undefined {
    const row = this.db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!row) return undefined;
    const names = new Map(this.list().map((r) => [r.id, r.name]));
    const doors = this.doorsOf(roomId).flatMap((d) => {
      const to = this.arrival(roomId, d.targetRoomId);
      if (!to) return [];
      return [
        {
          x: d.x,
          y: d.y,
          targetRoomId: d.targetRoomId,
          targetX: to.x,
          targetY: to.y,
          targetDir: to.dir,
          targetName: names.get(d.targetRoomId),
        },
      ];
    });
    return {
      roomId: row.id,
      name: row.name,
      heightmap: row.heightmap,
      spawn: { x: row.spawnX, y: row.spawnY, dir: row.spawnDir },
      floorColor: row.floorColor,
      wallColor: row.wallColor,
      doors,
    };
  }

  /** Dados do editor de salas. */
  editorData(roomId: string, online: number): RoomEditorData | undefined {
    const row = this.db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      heightmap: row.heightmap,
      spawn: { x: row.spawnX, y: row.spawnY },
      floorColor: row.floorColor,
      wallColor: row.wallColor,
      doors: this.doorsOf(roomId).map((d) => ({ x: d.x, y: d.y, targetRoomId: d.targetRoomId })),
      online,
    };
  }

  /**
   * Sala nova (8×6) com uma porta para a Recepção; a Recepção ganha a porta de volta.
   * Devolve o id e as salas cujo layout mudou.
   */
  create(name: string, defs: ReadonlyMap<string, FurniDef>): { id: string; affected: string[] } {
    const slug =
      name
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24) || 'sala';
    const id = `${slug}-${randomBytes(2).toString('hex')}`;
    const { heightmap, door, spawn } = defaultRoomHeightmap();
    const last = this.db.select({ sort: rooms.sort }).from(rooms).orderBy(desc(rooms.sort)).get();
    this.db.transaction((tx) => {
      tx.insert(rooms)
        .values({
          id,
          name,
          heightmap,
          spawnX: spawn.x,
          spawnY: spawn.y,
          spawnDir: 2,
          floorColor: '#b8b09a',
          wallColor: '#a7b4c2',
          furniSeeded: true,
          sort: (last?.sort ?? 0) + 1,
        })
        .run();
      tx.insert(roomDoors)
        .values(doorRow(id, door, RECEPTION.id))
        .run();
    });
    const affected = [id, ...this.ensureBackDoors(id, defs)];
    return { id, affected };
  }

  /**
   * Aplica uma edição já validada (`validateRoomEdit`): sala, portas, móveis que saem e as
   * portas de volta que faltarem nas salas de destino. Devolve as salas cujo layout mudou.
   */
  update(
    roomId: string,
    edit: RoomEdit,
    removedFurni: readonly string[],
    defs: ReadonlyMap<string, FurniDef>,
  ): string[] {
    const before = new Set(this.doorsOf(roomId).map((d) => d.targetRoomId));
    this.db.transaction((tx) => {
      tx.update(rooms)
        .set({
          name: edit.name,
          heightmap: edit.heightmap,
          spawnX: edit.spawn.x,
          spawnY: edit.spawn.y,
          // Quem nasce olha para dentro da sala (para longe da parede da esquerda).
          spawnDir: 2,
          floorColor: edit.floorColor,
          wallColor: edit.wallColor,
        })
        .where(eq(rooms.id, roomId))
        .run();
      tx.delete(roomDoors).where(eq(roomDoors.roomId, roomId)).run();
      for (const d of edit.doors)
        tx.insert(roomDoors)
          .values(doorRow(roomId, d, d.targetRoomId))
          .run();
      if (removedFurni.length > 0) {
        tx.delete(roomFurni)
          .where(and(eq(roomFurni.roomId, roomId), inArray(roomFurni.id, [...removedFurni])))
          .run();
      }
    });
    const after = new Set(edit.doors.map((d) => d.targetRoomId));
    const linked = this.db
      .select({ roomId: roomDoors.roomId })
      .from(roomDoors)
      .where(eq(roomDoors.targetRoomId, roomId))
      .all()
      .map((r) => r.roomId);
    return [
      ...new Set([roomId, ...before, ...after, ...linked, ...this.ensureBackDoors(roomId, defs)]),
    ];
  }

  /** Exclui a sala (e o que é dela). Portas que levavam até ela somem. Devolve as salas afetadas. */
  delete(roomId: string): string[] {
    const linked = this.db
      .select({ roomId: roomDoors.roomId })
      .from(roomDoors)
      .where(eq(roomDoors.targetRoomId, roomId))
      .all()
      .map((r) => r.roomId);
    this.db.transaction((tx) => {
      tx.delete(roomDoors)
        .where(or(eq(roomDoors.roomId, roomId), eq(roomDoors.targetRoomId, roomId)))
        .run();
      tx.delete(roomFurni).where(eq(roomFurni.roomId, roomId)).run();
      tx.delete(chatMessages).where(eq(chatMessages.roomId, roomId)).run();
      tx.delete(rooms).where(eq(rooms.id, roomId)).run();
    });
    return [...new Set(linked)];
  }

  /** Para cada porta de `roomId`, garante uma porta de volta na sala de destino. */
  private ensureBackDoors(roomId: string, defs: ReadonlyMap<string, FurniDef>): string[] {
    const changed: string[] = [];
    for (const d of this.doorsOf(roomId)) {
      const target = this.db.select().from(rooms).where(eq(rooms.id, d.targetRoomId)).get();
      if (!target) continue;
      const tDoors = this.doorsOf(target.id);
      if (tDoors.some((t) => t.targetRoomId === roomId)) continue;
      const furni = this.db
        .select()
        .from(roomFurni)
        .where(eq(roomFurni.roomId, target.id))
        .all()
        .map(({ id, defId, x, y, z, rot }) => ({ id, defId, x, y, z, rot }));
      const spot = findDoorSpot(
        target.heightmap,
        { x: target.spawnX, y: target.spawnY },
        tDoors,
        furni,
        defs,
      );
      // Sem lugar livre: a porta é de mão única (a chegada é na entrada da sala).
      if (!spot || tDoors.length >= ROOM_MAX_DOORS) continue;
      const heightmap = target.heightmap.map((row, y) =>
        y === spot.y ? row.slice(0, spot.x) + '0' + row.slice(spot.x + 1) : row,
      );
      this.db.update(rooms).set({ heightmap }).where(eq(rooms.id, target.id)).run();
      this.db
        .insert(roomDoors)
        .values(doorRow(target.id, spot, roomId))
        .run();
      changed.push(target.id);
    }
    return changed;
  }
}

/** Linha de `room_doors` (o destino exato é calculado na hora em `getLayout`). */
function doorRow(roomId: string, d: { x: number; y: number }, targetRoomId: string) {
  return { roomId, x: d.x, y: d.y, targetRoomId, targetX: 0, targetY: 0, targetDir: 2 };
}
