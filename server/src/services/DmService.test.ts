import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { DmService } from './DmService.js';
import { UserService } from './UserService.js';

const FIG = 'hd-180-1.ch-210-66.lg-270-82';
let dms: DmService;
let ana: string;
let beto: string;
let caio: string;

beforeEach(() => {
  const db = openDatabase(':memory:');
  const users = new UserService(db);
  let t = 1_000;
  dms = new DmService(db, () => new Date(t++));
  ana = users.create('Ana', FIG).user.id;
  beto = users.create('Beto', FIG).user.id;
  caio = users.create('Caio', FIG).user.id;
});

describe('DmService', () => {
  it('guarda a conversa nos dois sentidos, em ordem', () => {
    dms.send(ana, beto, 'oi Beto');
    dms.send(beto, ana, 'oi Ana');
    dms.send(ana, caio, 'outra conversa');
    expect(dms.history(beto, ana).map((m) => m.text)).toEqual(['oi Beto', 'oi Ana']);
  });

  it('pagina para trás com beforeId', () => {
    for (let i = 1; i <= 5; i++) dms.send(ana, beto, `m${i}`);
    const last2 = dms.history(ana, beto, undefined, 2);
    expect(last2.map((m) => m.text)).toEqual(['m4', 'm5']);
    expect(dms.history(ana, beto, last2[0]!.id, 2).map((m) => m.text)).toEqual(['m2', 'm3']);
  });

  it('lista conversas com a última mensagem e as não lidas', () => {
    dms.send(beto, ana, 'oi');
    dms.send(beto, ana, 'tá aí?');
    dms.send(ana, caio, 'bom dia');
    const convs = dms.conversations(ana);
    expect(convs.map((c) => [c.name, c.lastText, c.lastFromMe, c.unread])).toEqual([
      ['Caio', 'bom dia', true, 0],
      ['Beto', 'tá aí?', false, 2],
    ]);
    expect(dms.unreadCount(ana)).toBe(2);
  });

  it('marcar como lida só afeta o que a outra pessoa mandou', () => {
    dms.send(beto, ana, 'um');
    const two = dms.send(beto, ana, 'dois');
    dms.send(ana, beto, 'resposta');
    expect(dms.markRead(ana, beto)).toBe(two.id);
    expect(dms.unreadCount(ana)).toBe(0);
    expect(dms.unreadCount(beto)).toBe(1);
    expect(dms.markRead(ana, beto)).toBeNull();
  });
});
