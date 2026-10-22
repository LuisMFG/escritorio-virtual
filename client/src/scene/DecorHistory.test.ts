import type { FurniResult } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { DecorHistory } from './DecorHistory.js';

interface Item {
  defId: string;
  x: number;
  y: number;
  rot: number;
}

/**
 * Sala de mentira: guarda os móveis, dá ids novos a cada colocação e responde como o servidor.
 * `blocked` recusa colocar/mover para um tile; `pinned` recusa remover um móvel.
 */
function fakeRoom() {
  let seq = 0;
  const furni = new Map<string, Item>();
  /** Altura de cada móvel (sem entrada = no chão). Mover recoloca no chão, como o servidor. */
  const heights = new Map<string, number>();
  const blocked = new Set<string>();
  const pinned = new Set<string>();
  const ok = (id?: string): FurniResult =>
    id ? { ok: true, furni: { id, z: heights.get(id) ?? 0, ...furni.get(id)! } } : { ok: true };
  const no: FurniResult = { ok: false, reason: 'recusado' };
  const api = {
    place: async (m: Item) => {
      if (blocked.has(`${m.x},${m.y}`)) return no;
      const id = `f${++seq}`;
      furni.set(id, { defId: m.defId, x: m.x, y: m.y, rot: m.rot });
      return ok(id);
    },
    move: async (m: { furniId: string; x: number; y: number; rot: number }) => {
      const f = furni.get(m.furniId);
      if (!f || blocked.has(`${m.x},${m.y}`)) return no;
      Object.assign(f, { x: m.x, y: m.y, rot: m.rot });
      heights.delete(m.furniId);
      return ok(m.furniId);
    },
    height: async (m: { furniId: string; z: number }) => {
      if (!furni.has(m.furniId) || m.z > 6) return no;
      heights.set(m.furniId, m.z);
      return ok(m.furniId);
    },
    remove: async (id: string) => {
      if (pinned.has(id)) return no;
      furni.delete(id);
      return ok();
    },
    color: async (m: { furniId: string; defId: string }) => {
      const f = furni.get(m.furniId);
      if (!f) return no;
      f.defId = m.defId;
      return ok(m.furniId);
    },
  };
  /** Coloca como o Decorar faz: pede e, aceito, grava no histórico. */
  const place = async (h: DecorHistory, m: Item & { rot: 0 | 2 | 4 | 6 }) => {
    const res = await api.place(m);
    if (res.ok) h.recordPlace(res.furni!.id, m);
    return res;
  };
  return { furni, heights, blocked, pinned, api, place };
}

describe('DecorHistory', () => {
  it('desfaz e refaz colocar, mover e remover, seguindo o id novo do móvel', async () => {
    const { furni, api, place } = fakeRoom();
    const h = new DecorHistory(api as never, () => undefined);
    const msg = { defId: 'chair', x: 1, y: 1, rot: 0 as const };
    await place(h, msg);
    const id = [...furni.keys()][0]!;

    // Mover e girar.
    await api.move({ furniId: id, x: 3, y: 2, rot: 2 });
    h.recordMove(id, { x: 1, y: 1, rot: 0 }, { x: 3, y: 2, rot: 2 });
    // Remover.
    await api.remove(id);
    h.recordRemove(id, { defId: 'chair', x: 3, y: 2, rot: 2 });
    expect(furni.size).toBe(0);

    expect(await h.undo()).toBe(true); // volta o removido (id novo)
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
    const { furni, api } = fakeRoom();
    const h = new DecorHistory(api as never, () => undefined);
    furni.set('a', { defId: 'chair_2', x: 1, y: 1, rot: 0 });
    h.recordColor('a', 'chair_1', 'chair_2');
    await h.undo();
    expect(h.canRedo).toBe(true);
    h.recordMove('a', { x: 1, y: 1, rot: 0 }, { x: 1, y: 1, rot: 0 });
    expect(h.canRedo).toBe(true);
    h.recordMove('a', { x: 1, y: 1, rot: 0 }, { x: 2, y: 1, rot: 0 });
    expect(h.canRedo).toBe(false);
  });

  it('desfazer recusado pelo servidor fica no histórico; refazer não duplica (Fase 53)', async () => {
    const { furni, pinned, blocked, api, place } = fakeRoom();
    const h = new DecorHistory(api as never, () => undefined);
    await place(h, { defId: 'mesa', x: 2, y: 2, rot: 0 });
    const id = [...furni.keys()][0]!;

    // Algo em cima da mesa: o servidor recusa tirá-la. Nada muda de pilha.
    pinned.add(id);
    expect(await h.undo()).toBe(false);
    expect(furni.size).toBe(1);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    // Liberou: o desfazer passa. Refazer com o lugar ocupado é recusado e não cria nada.
    pinned.delete(id);
    expect(await h.undo()).toBe(true);
    blocked.add('2,2');
    expect(await h.redo()).toBe(false);
    expect(furni.size).toBe(0);
    expect(h.canRedo).toBe(true);
    // Refazer de novo, já livre, põe uma mesa só.
    blocked.delete('2,2');
    expect(await h.redo()).toBe(true);
    expect([...furni.values()]).toEqual([{ defId: 'mesa', x: 2, y: 2, rot: 0 }]);
  });

  it('o "Desfazer" do aviso desfaz aquela ação, mesmo com outras depois (Fase 53)', async () => {
    const { furni, api, place } = fakeRoom();
    const h = new DecorHistory(api as never, () => undefined);
    await place(h, { defId: 'cadeira', x: 1, y: 1, rot: 0 });
    const chair = [...furni.keys()][0]!;
    await api.remove(chair);
    const removal = h.recordRemove(chair, { defId: 'cadeira', x: 1, y: 1, rot: 0 });
    await place(h, { defId: 'mesa', x: 4, y: 4, rot: 0 });

    expect(await h.undoOp(removal)).toBe(true);
    expect([...furni.values()].map((f) => f.defId).sort()).toEqual(['cadeira', 'mesa']);
    // O Ctrl+Z seguinte desfaz a mesa (a última), não a cadeira de novo.
    await h.undo();
    expect([...furni.values()].map((f) => f.defId)).toEqual(['cadeira']);
  });

  it('ajuste de altura: passos seguidos no mesmo móvel viram uma ação só (Fase 56)', async () => {
    const { furni, heights, api } = fakeRoom();
    const h = new DecorHistory(api as never, () => undefined);
    furni.set('m', { defId: 'mesa', x: 2, y: 2, rot: 0 });
    furni.set('c', { defId: 'caixa', x: 4, y: 4, rot: 0 });
    // Três passos de 0,1 (roda do mouse): um Ctrl+Z volta tudo.
    for (const [from, to] of [
      [0, 0.1],
      [0.1, 0.2],
      [0.2, 0.3],
    ] as const) {
      await api.height({ furniId: 'm', z: to });
      h.recordHeight('m', from, to);
    }
    expect(await h.undo()).toBe(true);
    expect(heights.get('m')).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(await h.redo()).toBe(true);
    expect(heights.get('m')).toBe(0.3);
    // Outro móvel é outra ação; subir e descer de volta ao mesmo lugar não conta.
    await api.height({ furniId: 'c', z: 1 });
    h.recordHeight('c', 0, 1);
    await api.height({ furniId: 'c', z: 0 });
    h.recordHeight('c', 1, 0);
    await h.undo();
    expect(heights.get('m')).toBe(0);
  });

  it('desfazer o mover de uma base erguida devolve a altura dela (Fase 56)', async () => {
    const { furni, heights, api } = fakeRoom();
    const h = new DecorHistory(api as never, () => undefined);
    furni.set('m', { defId: 'mesa', x: 2, y: 2, rot: 0 });
    heights.set('m', 0.5);
    // Mover recoloca a mesa no chão (o servidor devolve z 0).
    const res = await api.move({ furniId: 'm', x: 4, y: 2, rot: 0 });
    const after = res.ok ? res.furni!.z : NaN;
    h.recordMove('m', { x: 2, y: 2, rot: 0 }, { x: 4, y: 2, rot: 0 }, { before: 0.5, after });
    expect(heights.get('m')).toBeUndefined();
    await h.undo();
    expect(furni.get('m')).toMatchObject({ x: 2, y: 2 });
    expect(heights.get('m')).toBe(0.5);
    await h.redo();
    expect(furni.get('m')).toMatchObject({ x: 4, y: 2 });
    expect(heights.get('m') ?? 0).toBe(0);
  });
});
