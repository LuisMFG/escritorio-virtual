import { MEETING_REMINDER_MIN } from '@office/shared';
import type { DmService } from './DmService.js';
import type { MeetingService } from './MeetingService.js';
import { guarded } from '../util/guard.js';

/**
 * Roda a cada 30 s: manda os lembretes de 5 minutos (aviso ao vivo pelo lobby + mensagem
 * privada de quem marcou para cada convidado que não recusou) e avisa o lobby para atualizar
 * as placas "Em reunião" das portas.
 */
export class MeetingScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly meetings: MeetingService,
    private readonly dms: DmService,
  ) {}

  start(intervalMs = 30_000): void {
    this.stop();
    this.timer = setInterval(
      guarded('lembretes', () => this.tick()),
      intervalMs,
    );
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    for (const m of this.meetings.dueReminders()) {
      this.meetings.markReminded(m.id);
      this.meetings.events.emit('reminder', m);
      // Sem hora no texto: cada pessoa pode estar num fuso diferente (a agenda mostra no fuso dela).
      const text = `⏰ Lembrete: a reunião “${m.title}” na ${m.roomName} começa em até ${MEETING_REMINDER_MIN} minutos.`;
      for (const a of m.attendees) {
        if (a.userId === m.createdBy || a.response === 'no') continue;
        // O lobby entrega ao vivo para quem estiver conectado.
        this.meetings.events.emit('dm', this.dms.send(m.createdBy, a.userId, text));
      }
    }
    this.meetings.events.emit('tick');
  }
}
