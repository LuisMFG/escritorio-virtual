const KEY = 'escritorio.som';

/**
 * Som curto de mensagem, sintetizado com Web Audio (sem arquivo de áudio para licenciar).
 * Começa desligado; a escolha fica salva no navegador.
 */
export class ChatSound {
  private ctx: AudioContext | null = null;
  enabled: boolean;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // Sem armazenamento: fica desligado.
    }
    this.enabled = saved === '1';
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(KEY, this.enabled ? '1' : '0');
    } catch {
      // Ignora: só não lembra na próxima visita.
    }
    if (this.enabled) this.play();
    return this.enabled;
  }

  /** "Plim" de duas notas, baixinho. */
  play(): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      const t = this.ctx.currentTime;
      for (const [i, freq] of [880, 1320].entries()) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const start = t + i * 0.07;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.06, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + 0.2);
      }
    } catch {
      // Navegador sem Web Audio: segue em silêncio.
    }
  }
}
