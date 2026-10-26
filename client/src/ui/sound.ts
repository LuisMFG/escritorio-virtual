/**
 * Chave da escolha no navegador. A `.v2` (26/10/2026) faz todo mundo começar com o som ligado,
 * inclusive quem ficou com ele desligado quando o padrão era desligado.
 */
const KEY = 'escritorio.som.v2';

/**
 * Som curto de mensagem, sintetizado com Web Audio (sem arquivo de áudio para licenciar).
 * Começa ligado (para todo mundo ouvir os avisos); o sino desliga e a escolha fica salva.
 */
export class ChatSound {
  private ctx: AudioContext | null = null;
  enabled: boolean;
  /** Em silêncio agora (modo foco ou status Ocupado): os avisos só aparecem na tela. */
  quiet: () => boolean = () => false;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // Sem armazenamento: fica ligado.
    }
    this.enabled = saved !== '0';
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
    if (this.quiet()) return;
    this.tones([880, 1320]);
  }

  /**
   * Menção (e os outros avisos): três notas subindo, um pouco mais alto. `always` toca mesmo
   * em foco ou ocupado (o fim do próprio Pomodoro, que a pessoa quer ouvir).
   */
  mention(always = false): void {
    if (!always && this.quiet()) return;
    this.tones([660, 990, 1320], 0.09);
  }

  /**
   * Chamando (Fase 49): duas notas, como um telefone. Toca mesmo com o som de mensagem
   * desligado (convite de chamada é importante); quem está em Foco/Ocupado não ouve.
   */
  ring(): void {
    this.tones([523, 659, 523, 659], 0.08, true);
  }

  private tones(freqs: number[], volume = 0.06, force = false): void {
    if (!this.enabled && !force) return;
    try {
      this.ctx ??= new AudioContext();
      const t = this.ctx.currentTime;
      for (const [i, freq] of freqs.entries()) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const start = t + i * 0.07;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
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
