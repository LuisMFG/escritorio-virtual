import { z } from 'zod';

/** Minutos antes do início em que o lembrete sai. */
export const MEETING_REMINDER_MIN = 5;
export const MEETING_MIN_DURATION = 15;
export const MEETING_MAX_DURATION = 480;
export const MEETING_MAX_ATTENDEES = 50;

export const MEETING_RESPONSES = ['pending', 'yes', 'no'] as const;
export type MeetingResponse = (typeof MEETING_RESPONSES)[number];
export const RESPONSE_LABELS: Record<MeetingResponse, string> = {
  pending: 'sem resposta',
  yes: 'vai',
  no: 'não vai',
};

export const meetingCreateSchema = z.object({
  title: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(2, 'Título muito curto.').max(80, 'Título muito longo.')),
  description: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(500, 'Descrição muito longa.'))
    .default(''),
  roomId: z.string().min(1).max(40),
  /** Epoch ms. */
  startsAt: z.number().int().positive(),
  durationMin: z
    .number()
    .int()
    .min(MEETING_MIN_DURATION, `Mínimo de ${MEETING_MIN_DURATION} minutos.`)
    .max(MEETING_MAX_DURATION, 'No máximo 8 horas.'),
  attendeeIds: z.array(z.string().min(1).max(64)).max(MEETING_MAX_ATTENDEES).default([]),
});
export type MeetingCreate = z.input<typeof meetingCreateSchema>;

export const meetingResponseSchema = z.object({ response: z.enum(['yes', 'no']) });

export interface MeetingAttendee {
  userId: string;
  name: string;
  response: MeetingResponse;
}

export interface Meeting {
  id: number;
  title: string;
  description: string;
  roomId: string;
  roomName: string;
  /** Epoch ms. */
  startsAt: number;
  durationMin: number;
  createdBy: string;
  createdByName: string;
  attendees: MeetingAttendee[];
}

/** Fim da reunião (epoch ms). */
export function meetingEnd(m: Pick<Meeting, 'startsAt' | 'durationMin'>): number {
  return m.startsAt + m.durationMin * 60_000;
}

/** Duas reuniões na mesma sala se sobrepõem? */
export function overlaps(
  a: Pick<Meeting, 'startsAt' | 'durationMin'>,
  b: Pick<Meeting, 'startsAt' | 'durationMin'>,
): boolean {
  return a.startsAt < meetingEnd(b) && b.startsAt < meetingEnd(a);
}

/** Lobby → cliente. */
export const MeetingMessage = {
  /** Agenda mudou (reunião marcada, cancelada, resposta): recarregar a lista. */
  Changed: 'meetings.changed',
  /** `MeetingNotice` com kind `invite`: você foi convidado. */
  Invited: 'meeting.invited',
  /** `MeetingNotice` com kind `reminder`: começa em 5 minutos. */
  Reminder: 'meeting.reminder',
} as const;

export interface MeetingNotice {
  meeting: Meeting;
}
