const KEY = 'escritorio.notificacoes';

export type NotifyState = 'unsupported' | 'blocked' | 'off' | 'on';

/**
 * Notificações do navegador (menção, mensagem privada…) quando a aba não está visível.
 * A permissão só é pedida quando a pessoa clica para ativar; dá para desligar sem revogar.
 */
export class SystemNotifier {
  private enabled: boolean;
  private readonly listeners = new Set<(s: NotifyState) => void>();

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // sem armazenamento: começa desligado
    }
    this.enabled = saved === '1';
  }

  get state(): NotifyState {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return this.enabled && Notification.permission === 'granted' ? 'on' : 'off';
  }

  onChange(listener: (s: NotifyState) => void): void {
    this.listeners.add(listener);
  }

  /** Liga (pedindo permissão se preciso) ou desliga. Devolve o estado final. */
  async toggle(): Promise<NotifyState> {
    if (this.state === 'on') {
      this.save(false);
    } else if (this.state === 'off') {
      const permission =
        Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      this.save(permission === 'granted');
    }
    const s = this.state;
    for (const l of this.listeners) l(s);
    return s;
  }

  /** Mostra a notificação só se ativada e se a aba estiver escondida. */
  notify(title: string, body: string, opts: { tag?: string; onClick?: () => void } = {}): void {
    if (this.state !== 'on' || document.visibilityState === 'visible') return;
    try {
      const n = new Notification(title, { body, tag: opts.tag, icon: '/favicon.svg' });
      n.onclick = () => {
        window.focus();
        opts.onClick?.();
        n.close();
      };
    } catch {
      // Alguns navegadores (ex.: Android) só notificam via service worker; ignoramos.
    }
  }

  private save(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // sem armazenamento: vale só nesta visita
    }
  }
}

export const NOTIFY_LABELS: Record<NotifyState, string> = {
  unsupported: 'Este navegador não tem notificações',
  blocked: 'Notificações bloqueadas no navegador',
  off: 'Ativar notificações',
  on: 'Notificações ativadas',
};
