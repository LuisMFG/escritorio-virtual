import type { Meeting } from '@office/shared';
import { iconHtml } from './icons.js';

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Faixa no topo: "Reunião X começa às 15:00 na Sala de reunião" com "Ir para a sala". */
export function showReminder(meeting: Meeting, goTo: (roomId: string) => void): void {
  document.querySelector(`.reminder[data-id="${meeting.id}"]`)?.remove();
  const box = document.createElement('div');
  box.className = 'reminder';
  box.dataset.id = String(meeting.id);
  box.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.append(
    '⏰ ',
    Object.assign(document.createElement('strong'), { textContent: meeting.title }),
    ` começa às ${timeFormat.format(meeting.startsAt)} na ${meeting.roomName}.`,
  );
  const go = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'btn-primary btn-small',
    textContent: 'Ir para a sala',
  });
  const dismiss = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'reminder-close',
    innerHTML: iconHtml('x', 16),
  });
  dismiss.setAttribute('aria-label', 'Fechar lembrete');
  go.addEventListener('click', () => {
    goTo(meeting.roomId);
    box.remove();
  });
  dismiss.addEventListener('click', () => box.remove());
  box.append(text, go, dismiss);
  document.body.append(box);
  // Some sozinha quando a reunião começa (mais um minuto de folga).
  setTimeout(() => box.remove(), Math.max(60_000, meeting.startsAt - Date.now() + 60_000));
}
