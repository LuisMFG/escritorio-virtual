import { describe, expect, it } from 'vitest';
import { DecorHistory } from './DecorHistory.js';

/** Sala de mentira: guarda os móveis e dá ids novos a cada colocação. */
function fakeRoom() {
  let seq = 0;
  const furni = new Map<string, { defId: string; x: number; y: number; rot: number }>();
  const api = {
    place: (m: { defId: string; x: number; y: number; rot: number }) => {
      furni.set(`f${++seq}`, { defId: m.defId, x: m.x, y: m.y, rot: m.rot });
    },
    move: (m: { furniId: string; x: number; y: number; rot: number }) => {
      const f = furni.get(m.furniId);
      if (f) Object.assign(f, { x: m.x, y: m.y, rot: m.rot });
    },
    remove: (id: string) => furni.delete(id),
    color: (m: { furniId: string; defId: string }) => {
      const f = furni.get(m.furniId);
      if (f) f.defId = m.defId;
    },
    awaitPlaced: async (m: { defId: string; x: number; y: number }) =>
      [...furni]
        .reverse()
        .find(([, f]) => f.defId === m.defId && f.x === m.x && f.y === m.y)?.[0] ?? null,
  };
  return { furni, api };
}

describe('DecorHistory', () => {
  it('desfaz e refaz colocar, mover e remover, seguindo o id novo do móvel', async () => {
    const { furni, api } = fakeRoom();
    const h = new DecorHistory(api as never, () => undefined);
    const msg = { defId: 'chair', x: 1, y: 1, rot: 0 as const };
    api.place(msg);
    await h.recordPlace(msg);
    const id = [...furni.keys()][0]!;

    // Mover e girar.
    h.recordMove(id, { x: 1, y: 1, rot: 0 }, { x: 3, y: 2, rot: 2 });
    api.move({ furniId: id, x: 3, y: 2, rot: 2 });
    // Remover.
    h.recordRemove(id, { defId: 'chair', x: 3, y: 2, rot: 2 });
    api.remove(id);
    expect(furni.size).toBe(0);

    await h.undo(); // volta o removido (id novo)
    expect([...furni.values()]).toEqual([{ defId: 'chair', x: 3, y: 2, rot: 2 }]);
    await h.undo(); // desfaz o mover no id novo
    expect([...furni.values()]).toEqual([{ defId: 'chair', x: 1, y: 1, rot: 0 }]);
    await h.undo(); // desfaz o colocar
    expect(furni.size).toBe(0);
    expect(h.canUndo).toBe(false);

    await h.redo();
    await h.redo();
    expect([...furni.values()]).toEqual([{ defId: 'chair', x: 3, y: 2, rot: 2 }]);
    await h.redo();
    expect(furni.size).toBe(0);
    expect(h.canRedo).toBe(false);
  });

  it('uma ação nova apaga o que dava para refazer; mover para o mesmo lugar não conta', async () => {
    const { api } = fakeRoom();
    const h = new DecorHistory(api as never, () => undefined);
    h.recordColor('a', 'chair_1', 'chair_2');
    await h.undo();
    expect(h.canRedo).toBe(true);
    h.recordMove('a', { x: 1, y: 1, rot: 0 }, { x: 1, y: 1, rot: 0 });
    expect(h.canRedo).toBe(true);
    h.recordMove('a', { x: 1, y: 1, rot: 0 }, { x: 2, y: 1, rot: 0 });
    expect(h.canRedo).toBe(false);
  });
});
