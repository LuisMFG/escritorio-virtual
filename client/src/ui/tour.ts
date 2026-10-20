import { iconHtml } from './icons.js';

/** O que a pessoa fez e que pode concluir uma etapa do tour. */
export type TourEvent = 'move' | 'desk' | 'chat' | 'emote';

interface Step {
  title: string;
  text: string;
  /** Elemento destacado (o cartão fica perto dele); sem alvo, o cartão fica no meio. */
  target?: string;
  /** A etapa conclui sozinha quando isto acontece (o botão vira "Pular etapa"). */
  waitFor?: TourEvent;
}

const STEPS: Step[] = [
  {
    title: 'Bem-vindo ao escritório!',
    text: 'Um tour rapidinho pelo básico: andar, escolher sua mesa, conversar e decorar. Dá para pular quando quiser.',
  },
  {
    title: 'Andar',
    text: 'Clique em qualquer ponto do piso para andar até lá. Arraste para mover a câmera.',
    waitFor: 'move',
  },
  {
    title: 'Sua mesa',
    text: 'Clique na cadeira de uma estação livre para sentar e toque em "Ficar com esta mesa". Depois o botão "Minha mesa" leva você de volta.',
    waitFor: 'desk',
  },
  {
    title: 'Conversar',
    text: 'Aperte Enter, escreva e envie. A fala aparece num balão sobre você e fica na conversa à esquerda. Use @ para mencionar alguém.',
    target: '.chat-bar',
    waitFor: 'chat',
  },
  {
    title: 'Emotes',
    text: 'Pela carinha você acena, ri, dança, senta no chão… Também dá para digitar /acenar.',
    target: '.chat-emote-btn',
    waitFor: 'emote',
  },
  {
    title: 'Decorar',
    text: 'Aqui você coloca móveis do catálogo do Habbo na sala, move, gira e tira.',
    target: '.hud-decor',
  },
  {
    title: 'Pronto!',
    text: 'Aperte ? a qualquer momento para ver comandos, atalhos e o que cada botão faz (e refazer este tour).',
  },
];

const PENDING_KEY = 'ev-tour-pendente';

/** Marca o tour para a próxima entrada (conta recém-criada). */
export function markTourPending(): void {
  try {
    localStorage.setItem(PENDING_KEY, '1');
  } catch {
    // sem armazenamento: o tour fica só pela ajuda
  }
}

export function takeTourPending(): boolean {
  try {
    const pending = localStorage.getItem(PENDING_KEY) === '1';
    localStorage.removeItem(PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}

/**
 * Tour guiado (Fase 44): um cartão por etapa, perto do botão de que fala (com um contorno
 * nele). Etapas com ação concluem sozinhas quando a pessoa faz (`notify`).
 */
export class Tour {
  private index = -1;
  private readonly card = document.createElement('div');
  private readonly ring = document.createElement('div');
  private onResize = () => this.position();

  constructor(private readonly name: string) {
    this.card.className = 'tour-card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    this.card.setAttribute('aria-labelledby', 'tour-title');
    this.ring.className = 'tour-ring';
    this.ring.setAttribute('aria-hidden', 'true');
  }

  get active(): boolean {
    return this.index >= 0;
  }

  start(): void {
    document.body.append(this.ring, this.card);
    window.addEventListener('resize', this.onResize);
    this.go(0);
  }

  /** A pessoa fez algo: se a etapa atual esperava isso, avança. */
  notify(event: TourEvent): void {
    if (this.active && STEPS[this.index]!.waitFor === event) {
      this.card.classList.add('done');
      window.setTimeout(() => this.go(this.index + 1), 600);
    }
  }

  stop(): void {
    this.index = -1;
    this.card.remove();
    this.ring.remove();
    window.removeEventListener('resize', this.onResize);
  }

  private go(i: number): void {
    if (i >= STEPS.length) return this.stop();
    this.index = i;
    const step = STEPS[i]!;
    this.card.classList.remove('done');
    const title = i === 0 ? `Bem-vindo ao escritório, ${this.name}!` : step.title;
    this.card.innerHTML = `
      <div class="tour-head">
        <span class="tour-step">${i + 1} de ${STEPS.length}</span>
        <button type="button" class="tour-close" aria-label="Sair do tour">${iconHtml('x', 14)}</button>
      </div>
      <h3 id="tour-title"></h3>
      <p></p>
      <div class="tour-actions"></div>`;
    this.card.querySelector('h3')!.textContent = title;
    this.card.querySelector('p')!.textContent = step.text;
    const actions = this.card.querySelector('.tour-actions')!;
    const btn = (label: string, primary: boolean, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `${primary ? 'btn-primary' : 'btn-secondary'} btn-small`;
      b.textContent = label;
      b.addEventListener('click', onClick);
      actions.append(b);
      return b;
    };
    if (i === 0) btn('Pular tour', false, () => this.stop());
    const last = i === STEPS.length - 1;
    const next = btn(
      last ? 'Concluir' : step.waitFor ? 'Pular etapa' : i === 0 ? 'Começar' : 'Próximo',
      !step.waitFor,
      () => this.go(i + 1),
    );
    this.card.querySelector('.tour-close')!.addEventListener('click', () => this.stop());
    this.position();
    if (!step.waitFor) next.focus();
  }

  /** Cartão perto do alvo (acima se ele estiver embaixo), ou no meio da tela. */
  private position(): void {
    const step = STEPS[this.index];
    if (!step) return;
    const target = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    const r = target?.getBoundingClientRect();
    if (!r || r.width === 0) {
      this.ring.hidden = true;
      // Etapas de fazer algo na sala: cartão no alto, para não cobrir o piso.
      this.card.classList.toggle('centered', !step.waitFor);
      this.card.classList.toggle('top', Boolean(step.waitFor));
      this.card.style.left = this.card.style.top = '';
      return;
    }
    this.card.classList.remove('centered', 'top');
    this.ring.hidden = false;
    Object.assign(this.ring.style, {
      left: `${r.left - 4}px`,
      top: `${r.top - 4}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 8}px`,
    });
    const cw = this.card.offsetWidth || 300;
    const ch = this.card.offsetHeight || 160;
    const left = Math.min(Math.max(16, r.left + r.width / 2 - cw / 2), innerWidth - cw - 16);
    const above = r.top > innerHeight / 2;
    const top = above ? r.top - ch - 14 : r.bottom + 14;
    this.card.style.left = `${Math.round(left)}px`;
    this.card.style.top = `${Math.round(Math.max(16, Math.min(top, innerHeight - ch - 16)))}px`;
  }
}
