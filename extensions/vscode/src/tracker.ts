/**
 * Regras de quando mandar sinal ao escritório, sem depender do VS Code (testável).
 *
 * - Mexeu no código (digitou, trocou de arquivo, voltou para a janela): fica "ativo".
 * - Ativo: um sinal por minuto, ou na hora se a linguagem/projeto mudar.
 * - 5 minutos sem mexer: manda "ocioso" uma vez e para.
 */
export const HEARTBEAT_MS = 60_000;
export const IDLE_MS = 5 * 60_000;

export interface Heartbeat {
  editor?: 'vscode';
  state: 'active' | 'idle' | 'closed';
  language?: string;
  project?: string;
}

export class ActivityTracker {
  private lastTouch = -Infinity;
  private lastSent = -Infinity;
  private sentKey = '';
  private active = false;
  private language: string | undefined;
  private project: string | undefined;

  constructor(
    private readonly send: (hb: Heartbeat) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** A pessoa mexeu no editor. */
  touch(language: string | undefined, project: string | undefined): void {
    this.language = language;
    this.project = project;
    this.lastTouch = this.now();
    this.tick();
  }

  /** Chamado de tempos em tempos (e a cada toque). */
  tick(): void {
    const now = this.now();
    if (now - this.lastTouch >= IDLE_MS) {
      if (this.active) {
        this.active = false;
        this.sentKey = '';
        this.send({ state: 'idle' });
      }
      return;
    }
    const key = `${this.language ?? ''}|${this.project ?? ''}`;
    if (!this.active || key !== this.sentKey || now - this.lastSent >= HEARTBEAT_MS) {
      this.active = true;
      this.sentKey = key;
      this.lastSent = now;
      this.send({ state: 'active', language: this.language, project: this.project });
    }
  }

  /** VS Code fechando, pausado ou desconectado. */
  stop(): void {
    if (this.active) this.send({ state: 'closed' });
    this.active = false;
    this.sentKey = '';
    this.lastTouch = -Infinity;
  }
}
