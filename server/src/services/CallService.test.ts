import { describe, expect, it } from 'vitest';
import { CALL_MAX_PEOPLE, type CallInvite, type CallInviteResult } from '@office/shared';
import { CallService } from './CallService.js';

function setup(online = ['ana', 'beto', 'caio', 'duda', 'eva', 'fabi', 'gil']) {
  const names: Record<string, string> = Object.fromEntries(online.map((u) => [u, u.toUpperCase()]));
  const quiet = new Set<string>();
  const pending: (() => void)[] = [];
  const svc = new CallService(
    {
      isOnline: (u) => u in names,
      nameOf: (u) => names[u] ?? u,
      figureOf: (u) => `hd-180-1.fig-${u}`,
      isQuiet: (u) => quiet.has(u),
    },
    () => 1000,
    { set: (fn) => (pending.push(fn), 0 as never), clear: () => undefined },
  );
  const invited: [string, CallInvite][] = [];
  const results: [string, CallInviteResult][] = [];
  const gone: [string, string][] = [];
  const changed: string[][] = [];
  svc.events.on('invited', (to, inv) => invited.push([to, inv]));
  svc.events.on('result', (from, r) => results.push([from, r]));
  svc.events.on('inviteGone', (to, id) => gone.push([to, id]));
  svc.events.on('changed', (ids) => changed.push(ids));
  const last = () => invited.at(-1)![1];
  return { svc, names, quiet, pending, invited, results, gone, changed, last };
}

describe('CallService', () => {
  it('convite com motivo; aceitar abre a chamada dos dois', () => {
    const t = setup();
    expect(t.svc.invite('ana', 'beto', 'Dúvida no deploy')).toBe('sent');
    expect(t.last()).toMatchObject({
      fromName: 'ANA',
      reason: 'Dúvida no deploy',
      members: ['ANA'],
      callId: null,
    });
    t.svc.answer('beto', t.last().id, true);
    expect(t.results.at(-1)![1]).toMatchObject({ toUserId: 'beto', outcome: 'accepted' });
    const view = t.svc.callOf('ana')!;
    expect(view.members.map((m) => m.userId).sort()).toEqual(['ana', 'beto']);
    // O visual de cada um vai junto (rosto do avatar com a câmera desligada).
    expect(view.members.find((m) => m.userId === 'beto')!.figure).toBe('hd-180-1.fig-beto');
    expect(t.svc.callOf('beto')!.id).toBe(view.id);
    expect(t.svc.sameCall('ana', 'beto')).toBe(true);
    expect(t.changed.at(-1)!.sort()).toEqual(['ana', 'beto']);
  });

  it('recusar, expirar, offline e ocupado', () => {
    const t = setup();
    t.svc.invite('ana', 'beto', '');
    t.svc.answer('beto', t.last().id, false);
    expect(t.results.at(-1)![1].outcome).toBe('declined');
    expect(t.svc.callOf('ana')).toBeNull();

    t.svc.invite('ana', 'caio', '');
    t.pending.at(-1)!(); // passou o tempo
    expect(t.results.at(-1)![1].outcome).toBe('expired');
    expect(t.gone.at(-1)![0]).toBe('caio');

    expect(t.svc.invite('ana', 'zeca', '')).toBe('offline');

    t.svc.invite('beto', 'caio', '');
    t.svc.answer('caio', t.last().id, true);
    expect(t.svc.invite('ana', 'caio', '')).toBe('busy');
  });

  it('em Foco/Ocupado o convite chega sem som', () => {
    const t = setup();
    t.quiet.add('beto');
    t.svc.invite('ana', 'beto', '');
    expect(t.last().quiet).toBe(true);
  });

  it(`em grupo: quem está na chamada adiciona outra pessoa; até ${CALL_MAX_PEOPLE}`, () => {
    const extra = Array.from({ length: CALL_MAX_PEOPLE }, (_, i) => `p${i}`);
    const t = setup(['ana', 'beto', 'caio', 'gil', ...extra]);
    t.svc.invite('ana', 'beto', '');
    t.svc.answer('beto', t.last().id, true);
    const id = t.svc.callOf('ana')!.id;
    t.svc.invite('beto', 'caio', 'Reunião rápida');
    expect(t.last()).toMatchObject({ callId: id, members: ['ANA', 'BETO'] });
    t.svc.answer('caio', t.last().id, true);
    expect(t.svc.callOf('caio')!.members).toHaveLength(3);
    for (let i = 3; i < CALL_MAX_PEOPLE; i++) {
      t.svc.invite('ana', `p${i}`, '');
      t.svc.answer(`p${i}`, t.last().id, true);
    }
    expect(t.svc.callOf('ana')!.members).toHaveLength(CALL_MAX_PEOPLE);
    expect(t.svc.invite('ana', 'gil', '')).toBe('full');
  });

  it('sair: com uma pessoa só a chamada acaba; sair do escritório cancela convites', () => {
    const t = setup();
    const left: [string, string[]][] = [];
    t.svc.events.on('left', (callId, ids) => left.push([callId, ids]));
    t.svc.invite('ana', 'beto', '');
    t.svc.answer('beto', t.last().id, true);
    t.svc.invite('ana', 'caio', '');
    t.svc.answer('caio', t.last().id, true);
    const id = t.svc.callOf('ana')!.id;
    // Com três, quem sai sai sozinho (da sala de mídia também); com dois, a chamada acaba.
    t.svc.leave('caio');
    expect(left).toEqual([[id, ['caio']]]);
    t.svc.leave('beto');
    expect(left.at(-1)).toEqual([id, ['beto', 'ana']]);
    expect(t.svc.callOf('ana')).toBeNull();
    expect(t.svc.callOf('beto')).toBeNull();

    t.svc.invite('ana', 'caio', '');
    const inv = t.last().id;
    t.svc.disconnect('caio');
    expect(t.gone.at(-1)).toEqual(['caio', inv]);
    expect(t.results.at(-1)![1].outcome).toBe('offline');
  });

  it('microfone, câmera e tela de cada participante (prontos para a Fase 50)', () => {
    const t = setup();
    t.svc.invite('ana', 'beto', '');
    t.svc.answer('beto', t.last().id, true);
    t.svc.setMedia('beto', { mic: false, cam: true, screen: false });
    const beto = t.svc.callOf('ana')!.members.find((m) => m.userId === 'beto')!;
    expect(beto).toMatchObject({ mic: false, cam: true, screen: false });
  });
});
