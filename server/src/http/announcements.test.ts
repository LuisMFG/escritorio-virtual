import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  readAnnouncement,
  unreadAnnouncements,
} from './announcements.js';
import { callerOf, makeDeps, registered, type TestDeps } from './testDeps.js';

let deps: TestDeps;

beforeEach(() => {
  deps = makeDeps();
});

describe('avisos da diretoria', () => {
  it('só admin publica; "Li" é por pessoa; quem chega depois ainda vê', async () => {
    const admin = await registered(deps); // primeira conta: admin
    const beto = await registered(deps, { username: 'beto', name: 'Beto' });
    const asAdmin = () => callerOf(deps, admin.token);
    const asBeto = () => callerOf(deps, beto.token);
    const live: string[] = [];
    deps.announcements.events.on('created', (a) => live.push(a.title));

    expect(createAnnouncement(asBeto(), { title: 'Oi', body: 'x' }, deps).status).toBe(403);
    expect(createAnnouncement(asAdmin(), { title: 'Oi', body: '' }, deps).ok).toBe(false);
    const made = createAnnouncement(
      asAdmin(),
      { title: '  Ponto facultativo ', body: 'Sexta não tem expediente.', urgent: true },
      deps,
    );
    if (!made.ok) throw new Error(made.body.message);
    expect(made.body).toMatchObject({ title: 'Ponto facultativo', urgent: true, read: false });
    expect(live).toEqual(['Ponto facultativo']);

    // Quem publicou já leu; Beto ainda não.
    expect(unreadAnnouncements(asAdmin(), deps)).toMatchObject({ body: [] });
    expect(unreadAnnouncements(asBeto(), deps)).toMatchObject({
      body: [{ title: 'Ponto facultativo' }],
    });
    readAnnouncement(asBeto(), made.body.id, deps);
    expect(unreadAnnouncements(asBeto(), deps)).toMatchObject({ body: [] });

    // Conta nova (depois do aviso) também recebe.
    const caio = await registered(deps, { username: 'caio', name: 'Caio' });
    expect(unreadAnnouncements(callerOf(deps, caio.token), deps)).toMatchObject({
      body: [{ title: 'Ponto facultativo' }],
    });

    // Admin vê quantos leram; membro não.
    expect(listAnnouncements(asAdmin(), deps)).toMatchObject({ body: [{ readCount: 2 }] });
    expect(listAnnouncements(asBeto(), deps)).toMatchObject({
      body: [{ readCount: 0, read: true }],
    });

    expect(deleteAnnouncement(asBeto(), made.body.id, deps).status).toBe(403);
    expect(deleteAnnouncement(asAdmin(), made.body.id, deps).ok).toBe(true);
    expect(listAnnouncements(asAdmin(), deps)).toMatchObject({ body: [] });
    expect(readAnnouncement(asBeto(), made.body.id, deps).status).toBe(404);
  });
});
