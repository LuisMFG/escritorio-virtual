import type { FurniColorMessage, FurniMoveMessage, FurniPlaceMessage } from '@office/shared';

/** O que o histórico precisa para refazer as ações (a conexão e o estado da sala). */
export interface DecorHistoryApi {
  place(msg: FurniPlaceMessage): void;
  move(msg: FurniMoveMessage): void;
  remove(furniId: string): void;
  color(msg: FurniColorMessage): void;
  /** Espera o móvel recém-colocado aparecer no estado e devolve o id (ou `null`). */
  awaitPlaced(msg: FurniPlaceMessage): Promise<string | null>;
}

type Spot = Omit<FurniMoveMessage, 'furniId'>;

type Op =
  | { kind: 'place'; id: string; msg: FurniPlaceMessage }
  | { kind: 'remove'; id: string; msg: FurniPlaceMessage }
  | { kind: 'move'; id: string; before: Spot; after: Spot }
  | { kind: 'color'; id: string; before: string; after: string };

/** Quantas ações o histórico guarda. */
const LIMIT = 50;

/**
 * Desfazer/refazer do Decorar (Fase 47): colocar, mover/girar, remover e trocar cor. Um
 * móvel tirado e posto de volta ganha outro id no servidor; `alias` segue a troca para as
 * ações antigas continuarem valendo.
 */
export class DecorHistory {
  private done: Op[] = [];
  private undone: Op[] = [];
  private readonly alias = new Map<string, string>();
  private busy = false;

  constructor(
    private readonly api: DecorHistoryApi,
    private readonly onChange: (canUndo: boolean, canRedo: boolean) => void,
  ) {}

  get canUndo(): boolean {
    return this.done.length > 0 && !this.busy;
  }

  get canRedo(): boolean {
    return this.undone.length > 0 && !this.busy;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.alias.clear();
    this.emit();
  }

  async recordPlace(msg: FurniPlaceMessage): Promise<void> {
    const id = await this.api.awaitPlaced(msg);
    if (id) this.push({ kind: 'place', id, msg });
  }

  recordRemove(id: string, msg: FurniPlaceMessage): void {
    this.push({ kind: 'remove', id, msg });
  }

  recordMove(id: string, before: Spot, after: Spot): void {
    if (
      before.x === after.x &&
      before.y === after.y &&
      before.rot === after.rot &&
      before.z === after.z
    ) {
      return;
    }
    this.push({ kind: 'move', id, before, after });
  }

  recordColor(id: string, before: string, after: string): void {
    if (before !== after) this.push({ kind: 'color', id, before, after });
  }

  async undo(): Promise<void> {
    const op = this.done.pop();
    if (!op || this.busy) return;
    await this.run(op, true);
    this.undone.push(op);
    this.emit();
  }

  async redo(): Promise<void> {
    const op = this.undone.pop();
    if (!op || this.busy) return;
    await this.run(op, false);
    this.done.push(op);
    this.emit();
  }

  private resolve(id: string): string {
    let cur = id;
    for (let i = 0; i < 20 && this.alias.has(cur); i++) cur = this.alias.get(cur)!;
    return cur;
  }

  /** Põe o móvel (de novo) e segue o id novo. */
  private async placeAgain(id: string, msg: FurniPlaceMessage): Promise<void> {
    this.api.place(msg);
    const fresh = await this.api.awaitPlaced(msg);
    if (fresh && fresh !== this.resolve(id)) this.alias.set(this.resolve(id), fresh);
  }

  private async run(op: Op, undo: boolean): Promise<void> {
    this.busy = true;
    this.emit();
    try {
      const id = this.resolve(op.id);
      switch (op.kind) {
        case 'place':
          if (undo) this.api.remove(id);
          else await this.placeAgain(op.id, op.msg);
          break;
        case 'remove':
          if (undo) await this.placeAgain(op.id, op.msg);
          else this.api.remove(id);
          break;
        case 'move':
          this.api.move({ furniId: id, ...(undo ? op.before : op.after) });
          break;
        case 'color':
          this.api.color({ furniId: id, defId: undo ? op.before : op.after });
          break;
      }
    } finally {
      this.busy = false;
    }
  }

  private push(op: Op): void {
    this.done.push(op);
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
    this.emit();
  }

  private emit(): void {
    this.onChange(this.canUndo, this.canRedo);
  }
}
