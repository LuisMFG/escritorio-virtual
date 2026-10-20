/**
 * Contador global de downloads de arte (Fase 45): quantos foram pedidos e quantos terminaram,
 * para a tela de carregamento mostrar o progresso da sala.
 */
let requested = 0;
let finished = 0;
const listeners = new Set<(done: number, total: number) => void>();

function emit(): void {
  for (const l of listeners) l(finished, requested);
}

/** Conta a promessa até ela terminar (com sucesso ou não). */
export function track<T>(p: Promise<T>): Promise<T> {
  requested++;
  emit();
  void p.finally(() => {
    finished++;
    emit();
  });
  return p;
}

export function onProgress(fn: (done: number, total: number) => void): () => void {
  listeners.add(fn);
  fn(finished, requested);
  return () => listeners.delete(fn);
}

export function progressSnapshot(): { done: number; total: number } {
  return { done: finished, total: requested };
}
