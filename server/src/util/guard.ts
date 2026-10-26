/**
 * Embrulha uma tarefa de cronômetro: um erro (ou promessa rejeitada) é registrado no log em vez
 * de derrubar o servidor inteiro (todas as salas) — a próxima rodada tenta de novo.
 */
export function guarded(name: string, fn: () => unknown): () => void {
  return () => {
    try {
      const result = fn();
      if (result instanceof Promise) result.catch((err: unknown) => logError(name, err));
    } catch (err) {
      logError(name, err);
    }
  };
}

export function logError(name: string, err: unknown): void {
  console.error(`[${name}] erro:`, err);
}
