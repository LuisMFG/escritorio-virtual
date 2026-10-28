import { icon } from './icons.js';

/** O que a faixa da mesa mostra agora (calculado a partir do estado da sala). */
export interface DeskContext {
  /** Cadeira de estação em que a pessoa está sentada (só na Recepção); `null` = nenhuma. */
  seat: string | null;
  /** Dono da estação em que está sentada (nome), se tiver. */
  owner: string | undefined;
  /** A estação que é da pessoa (id da cadeira); vazio = nenhuma. */
  myDesk: string;
}

export interface DeskHandlers {
  claim(seat: string): void;
  release(): void;
  goToDesk(): void;
}

/** Quanto tempo o convite "Ir para minha mesa" fica na tela ao entrar (ms). */
const OFFER_MS = 15_000;

/**
 * Minha mesa (Fase 42): faixinha acima da barra de baixo. Sentado numa estação mostra se é
 * livre (ficar com ela), sua (deixar) ou de alguém; ao entrar, convida a ir para a sua mesa.
 */
export class DeskChip {
  private readonly el = document.createElement('div');
  private offering = false;
  private offerTimer = 0;
  private ctx: DeskContext = { seat: null, owner: undefined, myDesk: '' };

  constructor(private readonly on: DeskHandlers) {
    this.el.className = 'desk-chip';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    document.body.append(this.el);
  }

  get element(): HTMLElement {
    return this.el;
  }

  update(ctx: DeskContext): void {
    this.ctx = ctx;
    // Já sentou na própria mesa: o convite não faz mais sentido.
    if (ctx.seat && ctx.seat === ctx.myDesk) this.stopOffer();
    this.render();
  }

  /** Convida a ir para a própria mesa (ao entrar no escritório). */
  offerGo(): void {
    if (!this.ctx.myDesk) return;
    this.offering = true;
    clearTimeout(this.offerTimer);
    this.offerTimer = window.setTimeout(() => this.stopOffer(), OFFER_MS);
    this.render();
  }

  private stopOffer(): void {
    if (!this.offering) return;
    this.offering = false;
    clearTimeout(this.offerTimer);
    this.render();
  }

  private render(): void {
    const { seat, owner, myDesk } = this.ctx;
    const text = Object.assign(document.createElement('span'), { className: 'desk-chip-text' });
    const parts: Node[] = [icon('monitor', 16), text];
    const action = (label: string, onClick: () => void, primary = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn-primary btn-small' : 'btn-secondary btn-small';
      b.textContent = label;
      b.addEventListener('click', onClick);
      parts.push(b);
    };
    if (seat && seat === myDesk) {
      text.textContent = 'Sua mesa';
      action('Deixar mesa', () => this.on.release());
    } else if (seat && owner) {
      text.textContent = `Mesa de ${owner}`;
    } else if (seat) {
      text.textContent = 'Mesa livre';
      action(
        myDesk ? 'Mudar minha mesa para cá' : 'Ficar com esta mesa',
        () => this.on.claim(seat),
        true,
      );
    } else if (this.offering && myDesk) {
      text.textContent = 'Sua mesa está esperando';
      action(
        'Ir para minha mesa',
        () => {
          this.stopOffer();
          this.on.goToDesk();
        },
        true,
      );
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'desk-chip-close';
      close.setAttribute('aria-label', 'Fechar');
      close.append(icon('x', 14));
      close.addEventListener('click', () => this.stopOffer());
      parts.push(close);
    } else {
      this.el.hidden = true;
      this.el.replaceChildren();
      return;
    }
    this.el.replaceChildren(...parts);
    this.el.hidden = false;
  }
}
