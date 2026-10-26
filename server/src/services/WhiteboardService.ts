import type { WbStroke, WbStrokeInput } from '@office/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { whiteboardStrokes } from '../db/schema.js';

/** Traços dos quadros brancos. */
export class WhiteboardService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(furniId: string): WbStroke[] {
    return this.db
      .select()
      .from(whiteboardStrokes)
      .where(eq(whiteboardStrokes.furniId, furniId))
      .orderBy(asc(whiteboardStrokes.id))
      .all()
      .map((r) => ({ ...(r.data as WbStrokeInput), id: r.id, userId: r.userId }));
  }

  count(furniId: string): number {
    return this.db
      .select({ id: whiteboardStrokes.id })
      .from(whiteboardStrokes)
      .where(eq(whiteboardStrokes.furniId, furniId))
      .all().length;
  }

  add(furniId: string, userId: string, data: WbStrokeInput): WbStroke {
    const row = this.db
      .insert(whiteboardStrokes)
      .values({ furniId, userId, data, createdAt: this.now() })
      .returning({ id: whiteboardStrokes.id })
      .get();
    return { ...data, id: row.id, userId };
  }

  /** Apaga o último traço da pessoa nesse quadro. Devolve o id apagado. */
  undo(furniId: string, userId: string): number | null {
    const last = this.db
      .select({ id: whiteboardStrokes.id })
      .from(whiteboardStrokes)
      .where(and(eq(whiteboardStrokes.furniId, furniId), eq(whiteboardStrokes.userId, userId)))
      .orderBy(desc(whiteboardStrokes.id))
      .get();
    if (!last) return null;
    this.db.delete(whiteboardStrokes).where(eq(whiteboardStrokes.id, last.id)).run();
    return last.id;
  }

  /** Põe de volta traços apagados (desfazer a limpeza), na ordem e com os autores de antes. */
  restore(furniId: string, strokes: readonly WbStroke[]): void {
    this.db.transaction(() => {
      for (const s of strokes) {
        const data: Partial<WbStroke> = { ...s };
        delete data.id;
        delete data.userId;
        this.add(furniId, s.userId, data as WbStrokeInput);
      }
    });
  }

  clear(furniId: string): void {
    this.db.delete(whiteboardStrokes).where(eq(whiteboardStrokes.furniId, furniId)).run();
  }
}
