import { describe, expect, it } from 'vitest';
import { personMenuItems, type PersonActions } from './personMenu.js';

function actions(mode: 'call' | 'add' | 'with' | 'none' = 'call') {
  const done: string[] = [];
  const a: PersonActions = {
    callMode: () => mode,
    call: (id) => done.push(`call:${id}`),
    message: (id) => done.push(`dm:${id}`),
    praise: (id) => done.push(`praise:${id}`),
    find: (sid) => done.push(`find:${sid}`),
    goTo: (id, room) => done.push(`go:${id}:${room}`),
  };
  return { a, done };
}

describe('menu de uma pessoa (o mesmo em todas as listas)', () => {
  it('nesta sala: chamar, mensagem, achar na sala e elogiar', () => {
    const { a, done } = actions();
    const items = personMenuItems({ userId: 'u1', name: 'Beto', sessionId: 's1' }, a);
    expect(items.map((i) => i.label)).toEqual([
      '📞 Chamar para conversa',
      '✉️ Mensagem',
      '📍 Achar na sala',
      '🙌 Elogiar',
    ]);
    for (const i of items) i.run();
    expect(done).toEqual(['call:u1', 'dm:u1', 'find:s1', 'praise:u1']);
  });

  it('em outra sala: dá para ligar e ir até lá; já numa chamada, adiciona', () => {
    const { a, done } = actions('add');
    const items = personMenuItems(
      { userId: 'u2', name: 'Caio', roomId: 'pantry', roomName: 'Copa' },
      a,
    );
    expect(items.map((i) => i.label)).toEqual([
      '📞 Adicionar à chamada',
      '✉️ Mensagem',
      '🚶 Ir até lá (Copa)',
      '🙌 Elogiar',
    ]);
    items[2]!.run();
    expect(done).toEqual(['go:u2:pantry']);
  });

  it('offline (Equipe) ou já na chamada comigo: sem chamar nem ir até', () => {
    expect(
      personMenuItems({ userId: 'u3', name: 'Duda' }, actions().a).map((i) => i.label),
    ).toEqual(['✉️ Mensagem', '🙌 Elogiar']);
    expect(
      personMenuItems({ userId: 'u3', name: 'Duda', sessionId: 's3' }, actions('with').a).map(
        (i) => i.label,
      ),
    ).toEqual(['✉️ Mensagem', '📍 Achar na sala', '🙌 Elogiar']);
  });
});
