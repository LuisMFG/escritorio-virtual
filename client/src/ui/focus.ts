import { FOCUS_PRESETS, type FocusKind, type FocusPhase } from '@office/shared';
import { setIcon } from './icons.js';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Modo foco do lado da pessoa: botão de foco com a contagem, janelinha para começar/parar e a
 * "porta fechada" para avisos (menções e mensagens não tocam som nem notificação durante o
 * foco; chegam num resumo no fim).
 */
export class FocusController {
  private kind: FocusKind | null = null;
  private until = 0;
  private held = { mentions: 0, dms: 0, kudos: 0 };
  private popover: HTMLElement | null = null;
  private tickTimer = 0;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly actions: {
      start(minutes: number, breakMinutes: number): void;
      stop(): void;
      notify(message: string): void;
      systemNotify(title: string, body: string): void;
      sound(): void;
      /** Título da aba com o tempo (ou `null` para tirar). */
      title(prefix: string | null): void;
    },
  ) {
    button.addEventListener('click', () => this.toggle());
    this.render();
  }

  /** Durante o foco, os avisos ficam segurados (o chamador não toca som nem notifica). */
  get focusing(): boolean {
    return this.kind === 'focus';
  }

  /** Conta um aviso segurado para o resumo do fim. */
  hold(kind: 'mentions' | 'dms' | 'kudos'): void {
    this.held[kind]++;
  }

  /** Fase nova vinda do servidor. */
  phase(p: FocusPhase): void {
    const wasFocusing = this.kind === 'focus';
    this.kind = p.kind;
    this.until = p.until;
    if (wasFocusing && p.kind !== 'focus') this.summary(p);
    else if (p.finished && p.kind === null) {
      this.actions.sound();
      this.actions.notify('☕ A pausa acabou. Bora mais um ciclo?');
      this.actions.systemNotify('☕ Pausa acabou', 'Bora mais um ciclo de foco?');
    }
    clearInterval(this.tickTimer);
    if (this.kind) this.tickTimer = window.setInterval(() => this.render(), 1000);
    this.closePopover();
    this.render();
  }

  private summary(p: FocusPhase): void {
    const { mentions, dms, kudos } = this.held;
    this.held = { mentions: 0, dms: 0, kudos: 0 };
    const parts = [
      mentions && `${mentions} menç${mentions === 1 ? 'ão' : 'ões'}`,
      dms && `${dms} mensage${dms === 1 ? 'm' : 'ns'}`,
      kudos && `${kudos} elogio${kudos === 1 ? '' : 's'}`,
    ].filter(Boolean);
    const missed = parts.length ? ` Enquanto isso: ${parts.join(', ')}.` : '';
    const head = p.finished
      ? p.kind === 'break'
        ? `🍅 Foco concluído! Pausa de ${Math.round((p.until - Date.now()) / 60_000)} min ☕.`
        : '🍅 Foco concluído!'
      : '🍅 Foco encerrado.';
    if (p.finished) {
      this.actions.sound();
      this.actions.systemNotify('🍅 Foco concluído', `${head}${missed}`);
    }
    this.actions.notify(`${head}${missed}`);
  }

  private render(): void {
    const ico = this.button.querySelector('.ico');
    const lbl = this.button.querySelector('.lbl');
    if (!this.kind) {
      if (ico) setIcon(ico, 'timer');
      if (lbl) lbl.textContent = 'Foco';
      this.button.classList.remove('focusing', 'on-break');
      this.button.setAttribute('aria-label', 'Modo foco');
      this.actions.title(null);
      return;
    }
    const left = mmss(this.until - Date.now());
    if (ico) setIcon(ico, this.kind === 'focus' ? 'timer' : 'coffee');
    if (lbl) lbl.textContent = left;
    this.button.classList.toggle('focusing', this.kind === 'focus');
    this.button.classList.toggle('on-break', this.kind === 'break');
    this.button.setAttribute(
      'aria-label',
      this.kind === 'focus' ? `Em foco, faltam ${left}` : `Em pausa, faltam ${left}`,
    );
    this.actions.title(`${this.kind === 'focus' ? '🍅' : '☕'} ${left}`);
  }

  private toggle(): void {
    if (this.popover) return this.closePopover();
    const box = el('div', { className: 'focus-popover', role: 'dialog' });
    box.setAttribute('aria-label', 'Modo foco');
    if (this.kind) {
      box.append(
        el('p', {
          textContent:
            this.kind === 'focus'
              ? '🍅 Em foco: menções e mensagens ficam sem som até acabar.'
              : '☕ Em pausa.',
        }),
      );
      const stop = el('button', {
        type: 'button',
        className: 'btn-secondary',
        textContent: 'Parar',
      });
      stop.addEventListener('click', () => {
        this.actions.stop();
        this.closePopover();
      });
      box.append(stop);
    } else {
      box.append(
        el('strong', { textContent: '🍅 Modo foco' }),
        el('p', {
          className: 'muted',
          textContent:
            'Os outros veem 🍅 no seu avatar. Menções e mensagens ficam sem som e chegam num resumo no fim.',
        }),
      );
      const presets = el('div', { className: 'focus-presets' });
      for (const [f, b] of FOCUS_PRESETS) {
        const btn = el('button', {
          type: 'button',
          className: 'btn-primary btn-small',
          textContent: `${f} + ${b} min`,
        });
        btn.setAttribute('aria-label', `Foco de ${f} minutos com pausa de ${b}`);
        btn.addEventListener('click', () => this.actions.start(f, b));
        presets.append(btn);
      }
      const custom = el('form', { className: 'focus-custom' });
      const min = el('input', { type: 'number', min: 1, max: 120, value: 25, name: 'minutes' });
      min.setAttribute('aria-label', 'Minutos de foco');
      const brk = el('input', { type: 'number', min: 0, max: 30, value: 5, name: 'break' });
      brk.setAttribute('aria-label', 'Minutos de pausa');
      custom.append(min, el('span', { textContent: '+' }), brk, el('span', { textContent: 'min' }));
      const go = el('button', {
        type: 'submit',
        className: 'btn-secondary btn-small',
        textContent: 'Começar',
      });
      custom.append(go);
      custom.addEventListener('keydown', (e) => e.stopPropagation());
      custom.addEventListener('submit', (e) => {
        e.preventDefault();
        this.actions.start(
          Math.min(120, Math.max(1, Math.round(Number(min.value) || 25))),
          Math.min(30, Math.max(0, Math.round(Number(brk.value) || 0))),
        );
      });
      box.append(presets, custom);
    }
    document.body.append(box);
    const r = this.button.getBoundingClientRect();
    box.style.left = `${Math.max(8, r.left)}px`;
    box.style.bottom = `${window.innerHeight - r.top + 8}px`;
    this.popover = box;
    setTimeout(() => document.addEventListener('pointerdown', this.outside), 0);
  }

  private readonly outside = (e: PointerEvent) => {
    if (
      this.popover &&
      !this.popover.contains(e.target as Node) &&
      !this.button.contains(e.target as Node)
    ) {
      this.closePopover();
    }
  };

  private closePopover(): void {
    this.popover?.remove();
    this.popover = null;
    document.removeEventListener('pointerdown', this.outside);
  }
}
