import { EventEmitter } from 'node:events';
import {
  MEETING_REMINDER_MIN,
  meetingEnd,
  overlaps,
  type DirectMessage,
  type Meeting,
  type MeetingResponse,
} from '@office/shared';
import { and, asc, eq, gt, inArray, isNull, lt, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { meetingAttendees, meetings, rooms, users } from '../db/schema.js';

export interface MeetingEvents {
  /** Algo mudou na agenda (o lobby avisa todo mundo para recarregar). */
  changed: [];
  /** Convidados novos de uma reunião. */
  invited: [Meeting, string[]];
  /** Faltam 5 minutos. */
  reminder: [Meeting];
  /** A cada rodada do agendador (reuniões começando/terminando mudam as placas das portas). */
  tick: [];
  /** Mensagem privada automática (lembrete) para o lobby entregar ao vivo. */
  dm: [DirectMessage];
}

/** Agenda de reuniões. */
export class MeetingService {
  readonly events = new EventEmitter<MeetingEvents>();

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events.setMaxListeners(100);
  }

  /** Reuniões que começam entre `from` e `to` (epoch ms), da mais cedo para a mais tarde. */
  list(from: number, to: number): Meeting[] {
    const rows = this.db
      .select()
      .from(meetings)
      .where(and(gt(meetings.startsAt, new Date(from)), lt(meetings.startsAt, new Date(to))))
      .orderBy(asc(meetings.startsAt))
      .all();
    return this.hydrate(rows);
  }

  get(id: number): Meeting | undefined {
    const row = this.db.select().from(meetings).where(eq(meetings.id, id)).get();
    return row ? this.hydrate([row])[0] : undefined;
  }

  /** Reunião na mesma sala que se sobrepõe ao horário pedido, se houver. */
  conflict(roomId: string, startsAt: number, durationMin: number): Meeting | undefined {
    const end = startsAt + durationMin * 60_000;
    return this.list(startsAt - 8 * 3_600_000, end).find(
      (m) => m.roomId === roomId && overlaps(m, { startsAt, durationMin }),
    );
  }

  create(input: {
    title: string;
    description: string;
    roomId: string;
    startsAt: number;
    durationMin: number;
    createdBy: string;
    attendeeIds: string[];
  }): Meeting {
    const row = this.db
      .insert(meetings)
      .values({
        title: input.title,
        description: input.description,
        roomId: input.roomId,
        startsAt: new Date(input.startsAt),
        durationMin: input.durationMin,
        createdBy: input.createdBy,
        createdAt: this.now(),
      })
      .returning()
      .get();
    // Quem marcou já vai; os outros respondem.
    const people = [...new Set([input.createdBy, ...input.attendeeIds])];
    for (const userId of people) {
      this.db
        .insert(meetingAttendees)
        .values({
          meetingId: row.id,
          userId,
          response: userId === input.createdBy ? 'yes' : 'pending',
        })
        .run();
    }
    return this.get(row.id)!;
  }

  respond(meetingId: number, userId: string, response: MeetingResponse): boolean {
    const res = this.db
      .update(meetingAttendees)
      .set({ response })
      .where(and(eq(meetingAttendees.meetingId, meetingId), eq(meetingAttendees.userId, userId)))
      .run();
    return res.changes > 0;
  }

  cancel(meetingId: number): void {
    this.db.delete(meetings).where(eq(meetings.id, meetingId)).run();
  }

  /** Reuniões que começam nos próximos 5 minutos e ainda não tiveram lembrete. */
  dueReminders(): Meeting[] {
    const now = this.now().getTime();
    const rows = this.db
      .select()
      .from(meetings)
      .where(
        and(
          isNull(meetings.remindedAt),
          lte(meetings.startsAt, new Date(now + MEETING_REMINDER_MIN * 60_000)),
          // Reunião que já começou há mais de 1 minuto não recebe lembrete atrasado.
          gt(meetings.startsAt, new Date(now - 60_000)),
        ),
      )
      .all();
    return this.hydrate(rows);
  }

  markReminded(meetingId: number): void {
    this.db
      .update(meetings)
      .set({ remindedAt: this.now() })
      .where(eq(meetings.id, meetingId))
      .run();
  }

  /** Título da reunião acontecendo agora em cada sala. */
  currentByRoom(): Map<string, string> {
    const now = this.now().getTime();
    const out = new Map<string, string>();
    for (const m of this.list(now - 8 * 3_600_000, now + 1)) {
      if (m.startsAt <= now && now < meetingEnd(m)) out.set(m.roomId, m.title);
    }
    return out;
  }

  private hydrate(rows: (typeof meetings.$inferSelect)[]): Meeting[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const attendees = this.db
      .select({
        meetingId: meetingAttendees.meetingId,
        userId: users.id,
        name: users.name,
        response: meetingAttendees.response,
      })
      .from(meetingAttendees)
      .innerJoin(users, eq(meetingAttendees.userId, users.id))
      .where(inArray(meetingAttendees.meetingId, ids))
      .orderBy(asc(users.name))
      .all();
    const names = new Map(
      this.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .all()
        .map((u) => [u.id, u.name]),
    );
    const roomNames = new Map(
      this.db
        .select({ id: rooms.id, name: rooms.name })
        .from(rooms)
        .all()
        .map((r) => [r.id, r.name]),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      roomId: r.roomId,
      roomName: roomNames.get(r.roomId) ?? r.roomId,
      startsAt: r.startsAt.getTime(),
      durationMin: r.durationMin,
      createdBy: r.createdBy,
      createdByName: names.get(r.createdBy) ?? '?',
      attendees: attendees
        .filter((a) => a.meetingId === r.id)
        .map((a) => ({ userId: a.userId, name: a.name, response: a.response as MeetingResponse })),
    }));
  }
}
