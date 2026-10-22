import type {
  FurniColorMessage,
  FurniHeightMessage,
  FurniMoveMessage,
  FurniPlaceMessage,
  FurniResult,
} from '@office/shared';

/** O que o histórico precisa para refazer as ações: a conexão, que responde se deu certo. */
export interface DecorHistoryApi {
  place(msg: FurniPlaceMessage): Promise<FurniResult>;
  move(msg: FurniMoveMessage): Promise<FurniResult>;
  remove(furniId: string): Promise<FurniResult>;
  color(msg: FurniColorMessage): Promise<FurniResult>;
  height(msg: FurniHeightMessage): Promise<FurniResult>;
}

type Spot = Omit<FurniMoveMessage, 'furniId'>;

/** Altura do móvel no piso antes e depois de mover (a ajustada volta junto ao desfazer). */
export interface Lift {
  before: number;
  after: number;
}

/** Uma ação do Decorar já aceita pelo servidor (o "Desfazer" do aviso guarda a sua). */
export type DecorOp =
  | { kind: 'place'; id: string; msg: FurniPlaceMessage }
  | { kind: 'remove'; id: string; msg: FurniPlaceMessage }
  | { kind: 'move'; id: string; before: Spot; after: Spot; lift?: Lift }
  | { kind: 'color'; id: string; before: string; after: string }
  | { kind: 'height'; id: string; before: number; after: number };

/** Quantas ações o histórico guarda. */
const LIMIT = 50;

/**
 * Desfazer/refazer do Decorar (Fase 47): colocar, mover/girar, remover e trocar cor. Um
 * móvel tirado e posto de volta ganha outro id no servidor; `alias` segue a troca para as
 * ações antigas continuarem valendo.
 *
 * Fase 53: só entra no histórico o que o servidor aceitou, e desfazer/refazer só mudam de pilha
 * quando o servidor confirma. Antes gravava antes da resposta: uma recusa ficava no histórico e,
 * refeita, punha uma segunda mesa em cima da primeira.
 *
 * Fase 56: o ajuste de altura também (passos seguidos no mesmo móvel viram uma ação só). Mover a
 * base leva a pilha junto no servidor, então desfazer o mover devolve tudo; se a base estava
 * erguida, a altura dela volta depois.
 */
export class DecorHistory {
  private done: DecorOp[] = [];
  private undone: DecorOp[] = [];
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

  recordPlace(id: string, msg: FurniPlaceMessage): DecorOp {
    return this.push({ kind: 'place', id, msg });
  }

  recordRemove(id: string, msg: FurniPlaceMessage): DecorOp {
    return this.push({ kind: 'remove', id, msg });
  }

  recordMove(id: string, before: Spot, after: Spot, lift?: Lift): DecorOp | null {
    if (
      before.x === after.x &&
      before.y === after.y &&
      before.rot === after.rot &&
      before.z === after.z
    ) {
      return null;
    }
    return this.push({ kind: 'move', id, before, after, ...(lift ? { lift } : {}) });
  }

  /** Ajuste de altura aceito. Seguido de outro no mesmo móvel, vira uma ação só. */
  recordHeight(id: string, before: number, after: number): DecorOp | null {
    const last = this.done.at(-1);
    if (
      last?.kind === 'height' &&
      this.resolve(last.id) === this.resolve(id) &&
      !this.undone.length
    ) {
      last.after = after;
      if (Math.abs(last.before - last.after) < 0.001) {
        this.done.pop();
        this.emit();
        return null;
      }
      return last;
    }
    if (Math.abs(before - after) < 0.001) return null;
    return this.push({ kind: 'height', id, before, after });
  }

  recordColor(id: string, before: string, after: string): DecorOp | null {
    return before !== after ? this.push({ kind: 'color', id, before, after }) : null;
  }

  /** Desfaz a última ação. Recusada pelo servidor, ela continua no histórico. */
  async undo(): Promise<boolean> {
    const op = this.done.at(-1);
    if (!op || this.busy || !(await this.run(op, true))) return false;
    this.done.splice(this.done.lastIndexOf(op), 1);
    this.undone.push(op);
    this.emit();
    return true;
  }

  async redo(): Promise<boolean> {
    const op = this.undone.at(-1);
    if (!op || this.busy || !(await this.run(op, false))) return false;
    this.undone.splice(this.undone.lastIndexOf(op), 1);
    this.done.push(op);
    this.emit();
    return true;
  }

  /**
   * Desfaz uma ação específica (o "Desfazer" do aviso de remoção). Se outras vieram depois, ela
   * só sai do histórico, sem dar para refazer (refazer depois das outras embaralharia a ordem).
   */
  async undoOp(op: DecorOp): Promise<boolean> {
    if (this.done.at(-1) === op) return this.undo();
    const i = this.done.indexOf(op);
    if (i < 0 || this.busy || !(await this.run(op, true))) return false;
    this.done.splice(this.done.indexOf(op), 1);
    this.emit();
    return true;
  }

  private resolve(id: string): string {
    let cur = id;
    for (let i = 0; i < 20 && this.alias.has(cur); i++) cur = this.alias.get(cur)!;
    return cur;
  }

  /** Põe o móvel (de novo) e segue o id novo. */
  private async placeAgain(id: string, msg: FurniPlaceMessage): Promise<boolean> {
    const res = await this.api.place(msg);
    const fresh = res.ok ? res.furni?.id : undefined;
    if (fresh && fresh !== this.resolve(id)) this.alias.set(this.resolve(id), fresh);
    return res.ok;
  }

  private async run(op: DecorOp, undo: boolean): Promise<boolean> {
    this.busy = true;
    this.emit();
    try {
      const id = this.resolve(op.id);
      switch (op.kind) {
        case 'place':
          return undo ? (await this.api.remove(id)).ok : await this.placeAgain(op.id, op.msg);
        case 'remove':
          return undo ? await this.placeAgain(op.id, op.msg) : (await this.api.remove(id)).ok;
        case 'move': {
          const res = await this.api.move({ furniId: id, ...(undo ? op.before : op.after) });
          // Base erguida pelo ajuste de altura: mover recoloca no apoio, então a altura volta.
          const z = op.lift && (undo ? op.lift.before : op.lift.after);
          if (res.ok && z !== undefined && res.furni && Math.abs(res.furni.z - z) > 0.001) {
            await this.api.height({ furniId: id, z });
          }
          return res.ok;
        }
        case 'color':
          return (await this.api.color({ furniId: id, defId: undo ? op.before : op.after })).ok;
        case 'height':
          return (await this.api.height({ furniId: id, z: undo ? op.before : op.after })).ok;
      }
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private push(op: DecorOp): DecorOp {
    this.done.push(op);
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
    this.emit();
    return op;
  }

  private emit(): void {
    this.onChange(this.canUndo, this.canRedo);
  }
}
