import type { PlacedFurni } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { FurniPending } from './FurniPending.js';

const at = (x: number, rot = 0): PlacedFurni => ({ id: 'm', defId: 'mesa', x, y: 1, z: 0, rot });

describe('FurniPending (Fase 53)', () => {
  it('sem pedido pendente, o estado do servidor vai direto para a tela', () => {
    const p = new FurniPending();
    expect(p.server(at(1))).toEqual(at(1));
  });

  it('aceito: a tela fica com o novo lugar, sem piscar de volta', () => {
    const p = new FurniPending();
    p.server(at(1));
    p.start('m');
    // O estado chega depois da resposta, mas algo antigo pode chegar antes: não mexe na tela.
    expect(p.server(at(1))).toBeNull();
    expect(p.finish('m', at(4))).toEqual(at(4));
    expect(p.server(at(4))).toEqual(at(4));
  });

  it('recusado: volta para o que o servidor tinha', () => {
    const p = new FurniPending();
    p.server(at(1));
    p.start('m');
    expect(p.finish('m', null)).toEqual(at(1));
  });

  it('R R rápido: só o último a responder decide; uma recusa no meio não pisca', () => {
    const p = new FurniPending();
    p.server(at(1, 0));
    p.start('m'); // girou para 2
    p.start('m'); // girou para 4
    expect(p.finish('m', at(1, 2))).toBeNull();
    expect(p.finish('m', at(1, 4))).toEqual(at(1, 4));
    // Duas pendentes, a segunda recusada: fica com a primeira, aceita.
    p.start('m');
    p.start('m');
    expect(p.finish('m', at(1, 6))).toBeNull();
    expect(p.finish('m', null)).toEqual(at(1, 6));
  });
});
