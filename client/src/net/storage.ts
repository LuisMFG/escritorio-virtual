/** O que o navegador lembra entre visitas (nome, visual e token da sessão). */
export interface StoredSession {
  name: string;
  figure?: string;
  token?: string;
}

const KEY = 'escritorio.sessao';

/** localStorage pode falhar (aba anônima, bloqueio); nunca deixa isso quebrar a entrada. */
export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredSession>;
    return typeof data.name === 'string' ? (data as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Sem armazenamento: o app funciona, só não lembra na próxima visita.
  }
}

export function forgetToken(): void {
  const s = loadSession();
  if (s) saveSession({ name: s.name, figure: s.figure });
}
