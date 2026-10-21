import { describe, expect, it } from 'vitest';
import { TV_PER_PERSON_MAX, tvPosition } from '@office/shared';
import { OEmbedTvMeta, TvService, type TvLookup } from './TvService.js';

const V = (n: number) => `video${String(n).padStart(6, '0')}`; // 11 caracteres
const ana = { userId: 'ana', name: 'Ana' };
const beto = { userId: 'beto', name: 'Beto' };
const caio = { userId: 'caio', name: 'Caio' };

function setup(meta: Record<string, TvLookup> = {}) {
  let now = 1_000_000;
  let timer: { fn: () => void; at: number } | null = null;
  const svc = new TvService(
    { lookup: async (id) => meta[id] ?? { title: `Título ${id}`, author: 'Canal' } },
    () => now,
    {
      set: (fn, ms) => ((timer = { fn, at: now + ms }), 1 as never),
      clear: () => (timer = null),
    },
  );
  const screens: [string, string | null][] = [];
  svc.events.on('screen', (f, v) => screens.push([f, v]));
  return {
    svc,
    screens,
    tick: (ms: number) => {
      now += ms;
      if (timer && timer.at <= now) {
        const t = timer;
        timer = null;
        t.fn();
      }
    },
    get now() {
      return now;
    },
  };
}

describe('TvService', () => {
  it('adicionar com a TV parada já começa; os outros entram na fila', async () => {
    const t = setup();
    t.svc.open('tv', 's1', ana);
    expect(await t.svc.add('tv', ana, [V(1), V(2)])).toBeNull();
    const st = t.svc.state('tv');
    expect(st.playing?.item).toMatchObject({
      videoId: V(1),
      title: `Título ${V(1)}`,
      addedByName: 'Ana',
    });
    expect(st.queue.map((i) => i.videoId)).toEqual([V(2)]);
    expect(t.screens).toEqual([['tv', V(1)]]);
    expect(st.viewers).toEqual([ana]);
  });

  it('vídeo bloqueado ou inexistente não entra (e diz por quê)', async () => {
    const t = setup({ [V(1)]: 'blocked', [V(2)]: 'not_found' });
    expect(await t.svc.add('tv', ana, [V(1)])).toBe('blocked');
    expect(await t.svc.add('tv', ana, [V(2)])).toBe('not_found');
    // Numa playlist, os que dão certo entram.
    expect(await t.svc.add('tv', ana, [V(1), V(3)])).toBeNull();
    expect(t.svc.state('tv').playing?.item.videoId).toBe(V(3));
  });

  it('limite por pessoa', async () => {
    const t = setup();
    const ids = Array.from({ length: TV_PER_PERSON_MAX + 2 }, (_, i) => V(i));
    await t.svc.add('tv', ana, ids.slice(0, 1));
    await t.svc.add('tv', ana, ids.slice(1, 20));
    expect(t.svc.state('tv').queue).toHaveLength(TV_PER_PERSON_MAX);
    expect(await t.svc.add('tv', ana, [V(99)])).toBe('too_many');
    expect(await t.svc.add('tv', beto, [V(99)])).toBeNull();
  });

  it('pausar, voltar a tocar e ir para um ponto valem para todos', async () => {
    const t = setup();
    await t.svc.add('tv', ana, [V(1)]);
    const itemId = t.svc.state('tv').playing!.item.id;
    t.svc.duration('tv', itemId, 300);
    t.tick(10_000);
    t.svc.control('tv', 'pause', 10);
    t.tick(60_000);
    expect(tvPosition(t.svc.state('tv').playing!, t.now)).toBe(10);
    t.svc.control('tv', 'play', 10);
    t.tick(5_000);
    expect(tvPosition(t.svc.state('tv').playing!, t.now)).toBe(15);
    t.svc.control('tv', 'seek', 120);
    expect(tvPosition(t.svc.state('tv').playing!, t.now)).toBe(120);
  });

  it('no fim do vídeo passa sozinho para o próximo (e desliga sem fila)', async () => {
    const t = setup();
    await t.svc.add('tv', ana, [V(1), V(2)]);
    t.svc.duration('tv', t.svc.state('tv').playing!.item.id, 60);
    t.tick(30_000);
    expect(t.svc.state('tv').playing?.item.videoId).toBe(V(1));
    t.tick(32_000);
    expect(t.svc.state('tv').playing?.item.videoId).toBe(V(2));
    // Sem duração conhecida: acaba quando um player avisa.
    t.svc.ended('tv', t.svc.state('tv').playing!.item.id);
    expect(t.svc.state('tv').playing).toBeNull();
    expect(t.screens.at(-1)).toEqual(['tv', null]);
  });

  it('"acabou" cedo demais (relógio adiantado) não pula', async () => {
    const t = setup();
    await t.svc.add('tv', ana, [V(1), V(2)]);
    const id = t.svc.state('tv').playing!.item.id;
    t.svc.duration('tv', id, 200);
    t.tick(20_000);
    t.svc.ended('tv', id);
    expect(t.svc.state('tv').playing?.item.videoId).toBe(V(1));
  });

  it('pular: maioria de quem assiste; quem adicionou pula na hora', async () => {
    const t = setup();
    t.svc.open('tv', 's1', ana);
    t.svc.open('tv', 's2', beto);
    t.svc.open('tv', 's3', caio);
    t.svc.open('tv', 's3b', caio); // segunda aba conta uma vez
    await t.svc.add('tv', ana, [V(1), V(2), V(3)]);
    expect(t.svc.state('tv').skipNeeded).toBe(2);
    t.svc.skip('tv', 'beto');
    expect(t.svc.state('tv').skipVotes).toEqual(['beto']);
    t.svc.skip('tv', 'caio');
    expect(t.svc.state('tv').playing?.item.videoId).toBe(V(2));
    expect(t.svc.state('tv').skipVotes).toEqual([]);
    // Quem não está assistindo não vota.
    t.svc.skip('tv', 'duda');
    expect(t.svc.state('tv').skipVotes).toEqual([]);
    // Quem adicionou pula sozinho.
    t.svc.skip('tv', 'ana');
    expect(t.svc.state('tv').playing?.item.videoId).toBe(V(3));
  });

  it('quem sai deixa de votar, e com menos gente os votos podem bastar', async () => {
    const t = setup();
    t.svc.open('tv', 's1', ana);
    t.svc.open('tv', 's2', beto);
    t.svc.open('tv', 's3', caio);
    await t.svc.add('tv', ana, [V(1), V(2)]);
    t.svc.skip('tv', 'beto'); // 1 de 2
    t.svc.leave('s3'); // agora 2 assistindo: precisa de 2… ainda 1
    expect(t.svc.state('tv').playing?.item.videoId).toBe(V(1));
    t.svc.close('tv', 's1'); // só o Beto: 1 basta
    expect(t.svc.state('tv').playing?.item.videoId).toBe(V(2));
  });

  it('tirar da fila: o seu, ou qualquer um sendo admin', async () => {
    const t = setup();
    await t.svc.add('tv', ana, [V(1), V(2)]);
    await t.svc.add('tv', beto, [V(3)]);
    const [mine, his] = t.svc.state('tv').queue;
    expect(t.svc.remove('tv', 'ana', his!.id)).toBe(false);
    expect(t.svc.remove('tv', 'ana', mine!.id)).toBe(true);
    expect(t.svc.remove('tv', 'caio', his!.id, true)).toBe(true);
    expect(t.svc.state('tv').queue).toEqual([]);
  });

  it('TV apagada some (e a tela apaga)', async () => {
    const t = setup();
    await t.svc.add('tv', ana, [V(1)]);
    t.svc.drop('tv');
    expect(t.svc.state('tv').playing).toBeNull();
    expect(t.screens.at(-1)).toEqual(['tv', null]);
  });
});

describe('OEmbedTvMeta', () => {
  const res = (status: number, body: unknown = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('título e canal; bloqueado e inexistente pelo status', async () => {
    const calls: string[] = [];
    const meta = new OEmbedTvMeta(((url: string) => {
      calls.push(url);
      if (url.includes('bloqueado00')) return res(401);
      if (url.includes('naoexiste00')) return res(404);
      return res(200, {
        title: 'Rick Astley - Never Gonna Give You Up',
        author_name: 'Rick Astley',
      });
    }) as typeof fetch);
    expect(await meta.lookup('dQw4w9WgXcQ')).toEqual({
      title: 'Rick Astley - Never Gonna Give You Up',
      author: 'Rick Astley',
    });
    expect(await meta.lookup('bloqueado00')).toBe('blocked');
    expect(await meta.lookup('naoexiste00')).toBe('not_found');
    await meta.lookup('dQw4w9WgXcQ'); // cache
    expect(calls).toHaveLength(3);
  });

  it('sem internet: entra com título genérico', async () => {
    const meta = new OEmbedTvMeta((() => Promise.reject(new Error('offline'))) as typeof fetch);
    expect(await meta.lookup('dQw4w9WgXcQ')).toEqual({ title: '', author: '' });
  });
});
