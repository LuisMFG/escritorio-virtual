import { ANNOUNCEMENT_HISTORY, type Announcement, type AnnouncementCreate } from '@office/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import type { Db } from '../db/client.js';
import { announcementReads, announcements, users } from '../db/schema.js';

/** Avisos antigos param de aparecer como faixa para quem ainda não leu. */
const UNREAD_WINDOW_MS = 30 * 86_400_000;

type Row = typeof announcements.$inferSelect & { createdByName: string };

/** Avisos da diretoria: publicar, histórico, "Li" por pessoa. */
export class AnnouncementService {
  readonly events = new EventEmitter<{
    created: [announcement: Announcement, authorId: string];
    removed: [id: number];
  }>();

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events.setMaxListeners(100);
  }

  create(userId: string, data: Required<AnnouncementCreate>): Announcement {
    const row = this.db
      .insert(announcements)
      .values({ ...data, createdBy: userId, createdAt: this.now() })
      .returning()
      .get();
    // Quem publicou já leu.
    this.markRead(row.id, userId);
    const name = this.db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get();
    const announcement = this.toApi({ ...row, createdByName: name?.name ?? '?' }, false, 1);
    this.events.emit('created', announcement, userId);
    return announcement;
  }

  /** Histórico (mais novos primeiro), com "li ou não" para quem pediu. */
  list(userId: string, isAdmin: boolean): Announcement[] {
    return this.rows()
      .limit(ANNOUNCEMENT_HISTORY)
      .all()
      .map((r) => this.withRead(r, userId, isAdmin));
  }

  /** O que a pessoa ainda não leu (dos últimos 30 dias), do mais antigo para o mais novo. */
  unread(userId: string): Announcement[] {
    const since = new Date(this.now().getTime() - UNREAD_WINDOW_MS);
    return this.rows()
      .where(gte(announcements.createdAt, since))
      .all()
      .map((r) => this.withRead(r, userId, false))
      .filter((a) => !a.read)
      .reverse();
  }

  exists(id: number): boolean {
    return Boolean(this.db.select().from(announcements).where(eq(announcements.id, id)).get());
  }

  markRead(id: number, userId: string): void {
    this.db
      .insert(announcementReads)
      .values({ announcementId: id, userId, readAt: this.now() })
      .onConflictDoNothing()
      .run();
  }

  remove(id: number): boolean {
    const res = this.db.delete(announcements).where(eq(announcements.id, id)).run();
    if (res.changes > 0) this.events.emit('removed', id);
    return res.changes > 0;
  }

  private rows() {
    return this.db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        urgent: announcements.urgent,
        createdBy: announcements.createdBy,
        createdAt: announcements.createdAt,
        createdByName: users.name,
      })
      .from(announcements)
      .innerJoin(users, eq(users.id, announcements.createdBy))
      .orderBy(desc(announcements.createdAt), desc(announcements.id))
      .$dynamic();
  }

  private withRead(r: Row, userId: string, isAdmin: boolean): Announcement {
    const read = Boolean(
      this.db
        .select()
        .from(announcementReads)
        .where(
          and(eq(announcementReads.announcementId, r.id), eq(announcementReads.userId, userId)),
        )
        .get(),
    );
    const readCount = isAdmin
      ? (this.db
          .select({ n: sql<number>`count(*)` })
          .from(announcementReads)
          .where(eq(announcementReads.announcementId, r.id))
          .get()?.n ?? 0)
      : 0;
    return this.toApi(r, read, readCount);
  }

  private toApi(r: Row, read: boolean, readCount: number): Announcement {
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      urgent: r.urgent,
      createdByName: r.createdByName,
      createdAt: r.createdAt.getTime(),
      read,
      readCount,
    };
  }
}
