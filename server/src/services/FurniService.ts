import { randomUUID } from 'node:crypto';
import type { PlacedFurni } from '@office/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { roomFurni, teleportLinks } from '../db/schema.js';

/** Móveis posicionados nas salas (tabela `room_furni`). */
export class FurniService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(roomId: string): PlacedFurni[] {
    return this.db
      .select()
      .from(roomFurni)
      .where(eq(roomFurni.roomId, roomId))
      .all()
      .map(({ id, defId, x, y, z, rot, state }) => ({ id, defId, x, y, z, rot, state }));
  }

  add(roomId: string, f: Omit<PlacedFurni, 'id'>, placedBy: string): PlacedFurni {
    const id = randomUUID().slice(0, 12);
    this.db
      .insert(roomFurni)
      .values({ id, roomId, ...f, placedBy, updatedAt: this.now() })
      .run();
    return { id, ...f, state: 0 };
  }

  setState(roomId: string, id: string, state: number): void {
    this.db
      .update(roomFurni)
      .set({ state, updatedAt: this.now() })
      .where(and(eq(roomFurni.roomId, roomId), eq(roomFurni.id, id)))
      .run();
  }

  /** Troca a variação (cor) do móvel. */
  setDef(roomId: string, id: string, defId: string, state: number): void {
    this.db
      .update(roomFurni)
      .set({ defId, state, updatedAt: this.now() })
      .where(and(eq(roomFurni.roomId, roomId), eq(roomFurni.id, id)))
      .run();
  }

  update(roomId: string, id: string, changes: Pick<PlacedFurni, 'x' | 'y' | 'z' | 'rot'>): void {
    this.db
      .update(roomFurni)
      .set({ ...changes, updatedAt: this.now() })
      .where(and(eq(roomFurni.roomId, roomId), eq(roomFurni.id, id)))
      .run();
  }

  remove(roomId: string, id: string): void {
    this.unlink(id);
    this.db
      .delete(roomFurni)
      .where(and(eq(roomFurni.roomId, roomId), eq(roomFurni.id, id)))
      .run();
  }

  /** Sala e posição de um móvel (em qualquer sala). */
  locate(id: string): (PlacedFurni & { roomId: string }) | undefined {
    const r = this.db.select().from(roomFurni).where(eq(roomFurni.id, id)).get();
    return r && { id: r.id, roomId: r.roomId, defId: r.defId, x: r.x, y: r.y, z: r.z, rot: r.rot };
  }

  /** Móveis destes tipos em todas as salas (para escolher o outro lado do teleporte). */
  listByDefs(defIds: string[]): (PlacedFurni & { roomId: string })[] {
    if (!defIds.length) return [];
    return this.db
      .select()
      .from(roomFurni)
      .where(inArray(roomFurni.defId, defIds))
      .all()
      .map((r) => ({
        id: r.id,
        roomId: r.roomId,
        defId: r.defId,
        x: r.x,
        y: r.y,
        z: r.z,
        rot: r.rot,
      }));
  }

  /** Liga dois teleportes (desfaz as ligações antigas dos dois). */
  link(a: string, b: string): void {
    this.unlink(a);
    this.unlink(b);
    this.db
      .insert(teleportLinks)
      .values([
        { furniId: a, targetId: b },
        { furniId: b, targetId: a },
      ])
      .run();
  }

  linkedTo(id: string): string | null {
    return (
      this.db.select().from(teleportLinks).where(eq(teleportLinks.furniId, id)).get()?.targetId ??
      null
    );
  }

  /** Desfaz a ligação (dos dois lados). */
  unlink(id: string): void {
    this.db
      .delete(teleportLinks)
      .where(or(eq(teleportLinks.furniId, id), eq(teleportLinks.targetId, id)))
      .run();
  }
}
