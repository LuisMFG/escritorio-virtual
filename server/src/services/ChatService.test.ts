import { CHAT_HISTORY_ON_JOIN, CHAT_KEEP_PER_ROOM } from '@office/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { ChatService } from './ChatService.js';
import { UserService } from './UserService.js';

function setup() {
  const db = openDatabase(':memory:');
  let t = 1_000;
  const chat = new ChatService(db, () => new Date(t++));
  const users = new UserService(db);
  const ana = users.create('Ana', 'hd-180-1.ch-210-66.lg-270-82').user;
  const beto = users.create('Beto', 'hd-180-1.ch-210-66.lg-270-82').user;
  return { chat, ana, beto };
}

describe('ChatService', () => {
  it('grava com o nome da hora e devolve em ordem cronológica', () => {
    const { chat, ana } = setup();
    const first = chat.add('reception', ana, 'oi', 'sessao-1');
    chat.add('reception', { ...ana, name: 'Ana Paula' }, 'tudo bem?');
    expect(first).toMatchObject({
      roomId: 'reception',
      name: 'Ana',
      text: 'oi',
      sessionId: 'sessao-1',
    });
    expect(chat.recent('reception').map((m) => [m.name, m.text])).toEqual([
      ['Ana', 'oi'],
      ['Ana Paula', 'tudo bem?'],
    ]);
  });

  it('separa por sala', () => {
    const { chat, ana } = setup();
    chat.add('reception', ana, 'na recepção');
    expect(chat.recent('meeting')).toEqual([]);
  });

  it(`guarda só as últimas ${CHAT_KEEP_PER_ROOM} e manda ${CHAT_HISTORY_ON_JOIN} ao entrar`, () => {
    const { chat, ana } = setup();
    for (let i = 1; i <= CHAT_KEEP_PER_ROOM + 30; i++) chat.add('reception', ana, `msg ${i}`);
    const recent = chat.recent('reception');
    expect(recent).toHaveLength(CHAT_HISTORY_ON_JOIN);
    expect(recent.at(-1)!.text).toBe(`msg ${CHAT_KEEP_PER_ROOM + 30}`);
    const all = chat.recent('reception', 1000);
    expect(all).toHaveLength(CHAT_KEEP_PER_ROOM);
    expect(all[0]!.text).toBe('msg 31');
  });

  it('reações: põe, conta por emoji com nomes e tira no segundo clique', () => {
    const { chat, ana, beto } = setup();
    const msg = chat.add('reception', ana, 'café?');
    chat.react(msg.id, beto.id, '👍');
    chat.react(msg.id, ana.id, '❤️');
    expect(chat.react(msg.id, ana.id, '👍')).toEqual([
      {
        emoji: '👍',
        users: [
          { userId: beto.id, name: 'Beto' },
          { userId: ana.id, name: 'Ana' },
        ],
      },
      { emoji: '❤️', users: [{ userId: ana.id, name: 'Ana' }] },
    ]);
    expect(chat.react(msg.id, beto.id, '👍')[0]!.users).toHaveLength(1);
    expect(chat.recent('reception')[0]!.reactions).toHaveLength(2);
  });

  it('respostas: trecho da original; outra sala não vale; apagar a original tira a citação', () => {
    const { chat, ana, beto } = setup();
    const original = chat.add('reception', ana, 'quem vai na reunião?');
    const reply = chat.add('reception', beto, 'eu vou', '', original.id);
    expect(reply.replyTo).toEqual({
      id: original.id,
      userId: ana.id,
      name: 'Ana',
      text: 'quem vai na reunião?',
    });
    expect(chat.add('meeting', beto, 'de outra sala', '', original.id).replyTo).toBeNull();

    chat.react(original.id, beto.id, '🎉');
    chat.remove(original.id);
    expect(chat.recent('reception').map((m) => [m.text, m.replyTo])).toEqual([['eu vou', null]]);
  });
});
