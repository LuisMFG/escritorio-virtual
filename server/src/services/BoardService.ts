import type { BoardNote, NoteColor } from '@office/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { boardNotes, users } from '../db/schema.js';

/** Recados dos murais (post-its). */
export class BoardService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  notes(furniId: string): BoardNote[] {
    return this.db
      .select({ n: boardNotes, name: users.name })
      .from(boardNotes)
      .innerJoin(users, eq(boardNotes.userId, users.id))
      .where(eq(boardNotes.furniId, furniId))
      .orderBy(asc(boardNotes.id))
      .all()
      .map(({ n, name }) => ({
        id: n.id,
        userId: n.userId,
        name,
        text: n.text,
        color: n.color as NoteColor,
        ts: n.createdAt.getTime(),
      }));
  }

  count(furniId: string): number {
    return this.db
      .select({ id: boardNotes.id })
      .from(boardNotes)
      .where(eq(boardNotes.furniId, furniId))
      .all().length;
  }

  add(furniId: string, userId: string, text: string, color: NoteColor): void {
    this.db
      .insert(boardNotes)
      .values({ furniId, userId, text, color, createdAt: this.now() })
      .run();
  }

  find(noteId: number) {
    return this.db.select().from(boardNotes).where(eq(boardNotes.id, noteId)).get();
  }

  remove(noteId: number): void {
    this.db.delete(boardNotes).where(eq(boardNotes.id, noteId)).run();
  }
}
