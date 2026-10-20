import { onProgress, progressSnapshot } from '../assets/progress.js';

/** Etapas da entrada e quanto da barra cada uma ocupa (a arte da sala fica com o resto). */
const STEPS = {
  prepare: { label: 'Preparando o escritório…', at: 0.05 },
  connect: { label: 'Conectando…', at: 0.2 },
  room: { label: 'Entrando na sala…', at: 0.35 },
  art: { label: 'Carregando a sala…', at: 0.45 },
} as const;
export type BootStep = keyof typeof STEPS;

/** Depois de entrar na sala, espera a arte no máximo isto antes de sair da frente (ms). */
const ART_TIMEOUT_MS = 8000;

/**
 * Tela de carregamento (Fase 45): logo, frase da etapa e barra de progresso. Na etapa da
 * arte a barra acompanha os downloads da sala; some quando quase tudo chegou.
 */
export class BootScreen {
  private readonly el = document.createElement('div');
  private readonly bar = document.createElement('div');
  private readonly text = document.createElement('p');
  private value = 0;
  private stopArt: (() => void) | null = null;

  constructor() {
    this.el.className = 'boot';
    this.el.setAttribute('role', 'progressbar');
    this.el.setAttribute('aria-label', 'Carregando o escritório');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    const title = Object.assign(document.createElement('h1'), {
      textContent: 'Escritório Virtual',
    });
    const track = Object.assign(document.createElement('div'), { className: 'boot-track' });
    this.bar.className = 'boot-bar';
    track.append(this.bar);
    this.text.className = 'boot-text';
    this.el.append(title, track, this.text);
    document.body.append(this.el);
    this.step('prepare');
  }

  step(step: BootStep): void {
    if (!this.el.isConnected) return;
    this.el.hidden = false;
    this.text.textContent = STEPS[step].label;
    this.set(STEPS[step].at);
    if (step !== 'art') return;
    // Arte da sala: só conta o que foi pedido daqui para frente.
    const base = progressSnapshot();
    const started = performance.now();
    this.stopArt?.();
    this.stopArt = onProgress((done, total) => {
      const d = done - base.done;
      const t = total - base.total;
      const frac = t > 0 ? d / t : 0;
      this.set(STEPS.art.at + (1 - STEPS.art.at) * frac);
      if ((t > 0 && frac >= 0.9) || performance.now() - started > ART_TIMEOUT_MS) this.finish();
    });
    window.setTimeout(() => this.finish(), ART_TIMEOUT_MS);
  }

  /** A tela de entrada (login) aparece por cima: esconde a de carregamento. */
  hide(): void {
    this.el.hidden = true;
  }

  finish(): void {
    if (!this.el.isConnected) return;
    this.stopArt?.();
    this.set(1);
    this.el.classList.add('done');
    window.setTimeout(() => this.el.remove(), 350);
  }

  private set(v: number): void {
    this.value = Math.max(this.value, Math.min(1, v));
    this.bar.style.width = `${Math.round(this.value * 100)}%`;
    this.el.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
  }
}
