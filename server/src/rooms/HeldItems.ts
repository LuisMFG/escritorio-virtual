/** Item na mão de cada pessoa: vale entre salas até vencer. */
export interface HeldItem {
  item: number;
  until: number;
}

/**
 * Registro dos itens na mão, por pessoa. Os vencidos saem ao consultar: antes ficavam para sempre
 * (quem saía da sala antes do item vencer deixava a entrada para trás).
 */
export class HeldItems {
  private readonly items = new Map<string, HeldItem>();

  /** Item ainda válido da pessoa (e limpa os vencidos de todo mundo). */
  get(userId: string, now = Date.now()): HeldItem | undefined {
    for (const [id, held] of this.items) if (held.until <= now) this.items.delete(id);
    return this.items.get(userId);
  }

  set(userId: string, item: number, until: number): void {
    this.items.set(userId, { item, until });
  }

  delete(userId: string): void {
    this.items.delete(userId);
  }

  get size(): number {
    return this.items.size;
  }
}
