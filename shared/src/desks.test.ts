import { describe, expect, it } from 'vitest';
import { deskOfSeat, deskSeatIds } from './desks.js';
import { RECEPTION } from './rooms.js';

describe('minha mesa', () => {
  it('liga a cadeira à mesa pelo prefixo', () => {
    expect(deskOfSeat('r-fila-1-cadeira')).toBe('r-fila-1-mesa');
    expect(deskOfSeat('r-sofa')).toBeNull();
  });

  it('só conta cadeiras que têm a mesa na sala', () => {
    expect([...deskSeatIds(['a-cadeira', 'a-mesa', 'b-cadeira'])]).toEqual(['a-cadeira']);
  });

  it('a Recepção tem as 24 estações (4 na fileira + 2 bancadas de 10)', () => {
    expect(deskSeatIds(RECEPTION.furni.map((f) => f.id)).size).toBe(24);
  });
});
