import type { PlacedFurni } from '@office/shared';

/**
 * Móveis com ação do Decorar esperando o servidor (Fase 53). A tela mostra na hora o resultado
 * esperado: soltar não pisca de volta para o lugar antigo e R R gira 180°. Enquanto houver pedido
 * pendente de um móvel, o estado que chega do servidor só é guardado. Quando o último responde, a
 * tela fica com a verdade: o que o servidor aceitou, ou o que ele tinha (recusa).
 */
export class FurniPending {
  private readonly truth = new Map<string, PlacedFurni>();
  private readonly pending = new Map<string, number>();

  /** Chegou o estado do servidor. Devolve o que mostrar agora, ou `null` se há pedido pendente. */
  server(placed: PlacedFurni): PlacedFurni | null {
    this.truth.set(placed.id, placed);
    return this.pending.get(placed.id) ? null : placed;
  }

  /** Começou um pedido para o móvel (a tela já mostra o esperado). */
  start(id: string): void {
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
  }

  /**
   * O servidor respondeu: aceito (com como o móvel ficou) ou recusado (`null`). Quando não sobra
   * pedido pendente, devolve o que mostrar; senão `null` (o próximo a responder decide).
   */
  finish(id: string, accepted: PlacedFurni | null): PlacedFurni | null {
    if (accepted) this.truth.set(id, accepted);
    const left = (this.pending.get(id) ?? 1) - 1;
    if (left > 0) {
      this.pending.set(id, left);
      return null;
    }
    this.pending.delete(id);
    return this.truth.get(id) ?? null;
  }

  /** O móvel saiu da sala. */
  forget(id: string): void {
    this.truth.delete(id);
    this.pending.delete(id);
  }
}
