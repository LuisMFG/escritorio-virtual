import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  TV_PER_PERSON_MAX,
  TV_QUEUE_MAX,
  tvPosition,
  tvSkipNeeded,
  type TvErrorCode,
  type TvItem,
  type TvPlayback,
  type TvState,
  type TvViewer,
} from '@office/shared';

/** Título e canal de um vídeo, ou por que ele não pode entrar na fila. */
export type TvLookup = { title: string; author: string } | 'blocked' | 'not_found';

export interface TvMeta {
  lookup(videoId: string): Promise<TvLookup>;
}

/** Folga depois do fim do vídeo antes de passar para o próximo (ms). */
const END_GRACE_MS = 1500;
/** "Acabou" vindo de um player só vale perto do fim (s), contra relógio adiantado. */
const ENDED_SLACK_S = 5;

interface Tv {
  queue: TvItem[];
  playing: TvPlayback | null;
  /** Sessão → quem está com a TV aberta. */
  viewers: Map<string, TvViewer>;
  votes: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * TVs com YouTube (Fase 51), só em memória: fila, vídeo atual (por hora de início, para todo
 * mundo calcular o mesmo ponto), quem assiste e os votos para pular. Quem usa (a sala) escuta
 * os eventos e manda o estado.
 */
export class TvService {
  readonly events = new EventEmitter<{
    /** O estado da TV mudou (quem assiste recebe `state`). */
    changed: [furniId: string];
    /** Mudou o vídeo na tela (todo mundo na sala vê a capa). */
    screen: [furniId: string, videoId: string | null];
  }>();

  private readonly tvs = new Map<string, Tv>();

  constructor(
    private readonly meta: TvMeta,
    private readonly now: () => number = Date.now,
    private readonly timers: {
      set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
      clear: (t: ReturnType<typeof setTimeout>) => void;
    } = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) },
  ) {}

  state(furniId: string): TvState {
    const tv = this.tvs.get(furniId);
    const viewers = tv ? this.uniqueViewers(tv) : [];
    return {
      furniId,
      now: this.now(),
      playing: tv?.playing ?? null,
      queue: tv?.queue ?? [],
      viewers,
      skipVotes: tv ? [...tv.votes] : [],
      skipNeeded: tvSkipNeeded(viewers.length),
    };
  }

  /** Vídeo na tela da TV (`null` = nada passando). */
  screen(furniId: string): string | null {
    return this.tvs.get(furniId)?.playing?.item.videoId ?? null;
  }

  /** Quem está assistindo agora (sessões). */
  viewerSessions(furniId: string): string[] {
    return [...(this.tvs.get(furniId)?.viewers.keys() ?? [])];
  }

  open(furniId: string, sessionId: string, viewer: TvViewer): void {
    this.tv(furniId).viewers.set(sessionId, viewer);
    this.events.emit('changed', furniId);
  }

  close(furniId: string, sessionId: string): void {
    const tv = this.tvs.get(furniId);
    if (!tv?.viewers.delete(sessionId)) return;
    this.afterViewersChanged(furniId, tv);
  }

  /** A sessão saiu da sala: fecha todas as TVs dela. */
  leave(sessionId: string): void {
    for (const [id, tv] of this.tvs)
      if (tv.viewers.delete(sessionId)) this.afterViewersChanged(id, tv);
  }

  /** Adiciona vídeos à fila (um link ou uma playlist). Devolve o erro, se nenhum entrou. */
  async add(furniId: string, user: TvViewer, videoIds: string[]): Promise<TvErrorCode | null> {
    const tv = this.tv(furniId);
    const room = Math.min(
      TV_QUEUE_MAX - tv.queue.length,
      TV_PER_PERSON_MAX - tv.queue.filter((i) => i.addedBy === user.userId).length,
    );
    if (room <= 0) {
      return tv.queue.length >= TV_QUEUE_MAX ? 'queue_full' : 'too_many';
    }
    const ids = videoIds.slice(0, room);
    const found = await Promise.all(
      ids.map((id) => this.meta.lookup(id).catch((): TvLookup => ({ title: '', author: '' }))),
    );
    const items: TvItem[] = [];
    for (const [i, info] of found.entries()) {
      if (typeof info === 'string') continue;
      items.push({
        id: randomUUID(),
        videoId: ids[i]!,
        title: info.title || 'Vídeo do YouTube',
        author: info.author,
        addedBy: user.userId,
        addedByName: user.name,
        duration: null,
      });
    }
    if (!items.length) {
      const first = found[0];
      return typeof first === 'string' ? first : 'invalid';
    }
    // A TV pode ter sido apagada enquanto buscava os títulos.
    const current = this.tvs.get(furniId) ?? tv;
    current.queue.push(...items.slice(0, TV_QUEUE_MAX - current.queue.length));
    if (!current.playing) this.advance(furniId, current);
    else this.events.emit('changed', furniId);
    return null;
  }

  /** Tira um vídeo da fila (o seu, ou qualquer um sendo admin). */
  remove(furniId: string, userId: string, itemId: string, admin = false): boolean {
    const tv = this.tvs.get(furniId);
    const i = tv?.queue.findIndex((it) => it.id === itemId) ?? -1;
    if (!tv || i < 0 || (!admin && tv.queue[i]!.addedBy !== userId)) return false;
    tv.queue.splice(i, 1);
    this.events.emit('changed', furniId);
    return true;
  }

  /** Tocar, pausar ou ir para um ponto: vale para todo mundo. */
  control(furniId: string, action: 'play' | 'pause' | 'seek', position: number): void {
    const tv = this.tvs.get(furniId);
    const p = tv?.playing;
    if (!tv || !p) return;
    const max = p.item.duration ?? Infinity;
    const at = Math.min(Math.max(0, position), max);
    if (action === 'pause') {
      p.pausedAt = at;
    } else if (action === 'play') {
      p.startedAt = this.now() - at * 1000;
      p.pausedAt = null;
    } else if (p.pausedAt !== null) {
      p.pausedAt = at;
    } else {
      p.startedAt = this.now() - at * 1000;
    }
    this.schedule(furniId, tv);
    this.events.emit('changed', furniId);
  }

  /** Voto para pular. Quem adicionou o vídeo (ou um admin) pula na hora. */
  skip(furniId: string, userId: string, admin = false): void {
    const tv = this.tvs.get(furniId);
    const p = tv?.playing;
    if (!tv || !p) return;
    if (admin || p.item.addedBy === userId) return this.advance(furniId, tv);
    if (!this.uniqueViewers(tv).some((v) => v.userId === userId)) return;
    if (tv.votes.has(userId)) tv.votes.delete(userId);
    else tv.votes.add(userId);
    this.checkVotes(furniId, tv);
  }

  /** O player descobriu a duração: agora dá para saber quando o vídeo acaba. */
  duration(furniId: string, itemId: string, seconds: number): void {
    const tv = this.tvs.get(furniId);
    const p = tv?.playing;
    if (!tv || !p || p.item.id !== itemId || p.item.duration !== null) return;
    p.item.duration = Math.round(seconds);
    this.schedule(furniId, tv);
    this.events.emit('changed', furniId);
  }

  /** O vídeo acabou num player (vale se for o atual e estiver perto do fim). */
  ended(furniId: string, itemId: string): void {
    const tv = this.tvs.get(furniId);
    const p = tv?.playing;
    if (!tv || !p || p.item.id !== itemId) return;
    if (p.item.duration && tvPosition(p, this.now()) < p.item.duration - ENDED_SLACK_S) return;
    this.advance(furniId, tv);
  }

  /** A TV saiu da sala (apagada no Decorar). */
  drop(furniId: string): void {
    const tv = this.tvs.get(furniId);
    if (!tv) return;
    if (tv.timer) this.timers.clear(tv.timer);
    this.tvs.delete(furniId);
    if (tv.playing) this.events.emit('screen', furniId, null);
  }

  // ---------- Interno ----------

  private tv(furniId: string): Tv {
    let tv = this.tvs.get(furniId);
    if (!tv) {
      tv = { queue: [], playing: null, viewers: new Map(), votes: new Set(), timer: null };
      this.tvs.set(furniId, tv);
    }
    return tv;
  }

  /** Uma entrada por pessoa (duas abas contam uma vez). */
  private uniqueViewers(tv: Tv): TvViewer[] {
    const out = new Map<string, TvViewer>();
    for (const v of tv.viewers.values()) out.set(v.userId, v);
    return [...out.values()];
  }

  private afterViewersChanged(furniId: string, tv: Tv): void {
    // Quem saiu não vota mais (e com menos gente os votos podem já bastar).
    const here = new Set(this.uniqueViewers(tv).map((v) => v.userId));
    for (const id of tv.votes) if (!here.has(id)) tv.votes.delete(id);
    if (tv.playing && tv.votes.size && this.checkVotes(furniId, tv)) return;
    this.events.emit('changed', furniId);
    this.forgetIfIdle(furniId, tv);
  }

  /** Pula se os votos bastam. Devolve se pulou. */
  private checkVotes(furniId: string, tv: Tv): boolean {
    if (tv.votes.size >= tvSkipNeeded(this.uniqueViewers(tv).length)) {
      this.advance(furniId, tv);
      return true;
    }
    this.events.emit('changed', furniId);
    return false;
  }

  /** Próximo da fila (ou nada). */
  private advance(furniId: string, tv: Tv): void {
    const before = tv.playing?.item.videoId ?? null;
    const next = tv.queue.shift();
    tv.playing = next ? { item: next, startedAt: this.now(), pausedAt: null } : null;
    tv.votes.clear();
    this.schedule(furniId, tv);
    this.events.emit('changed', furniId);
    const after = tv.playing?.item.videoId ?? null;
    // Mesmo vídeo duas vezes seguidas: a tela não muda, mas recomeça.
    if (after !== before || next) this.events.emit('screen', furniId, after);
    this.forgetIfIdle(furniId, tv);
  }

  /** Marca a passagem para o próximo vídeo no fim do atual (se a duração é conhecida). */
  private schedule(furniId: string, tv: Tv): void {
    if (tv.timer) this.timers.clear(tv.timer);
    tv.timer = null;
    const p = tv.playing;
    if (!p || p.pausedAt !== null || !p.item.duration) return;
    const left = (p.item.duration - tvPosition(p, this.now())) * 1000;
    tv.timer = this.timers.set(() => {
      tv.timer = null;
      if (this.tvs.get(furniId) === tv && tv.playing === p) this.advance(furniId, tv);
    }, left + END_GRACE_MS);
  }

  private forgetIfIdle(furniId: string, tv: Tv): void {
    if (!tv.playing && !tv.queue.length && !tv.viewers.size) this.tvs.delete(furniId);
  }
}

/**
 * Título e canal pelo oEmbed do YouTube (sem chave de API). 401/403 = o dono não deixa
 * incorporar; 400/404 = não existe ou é privado. Sem internet, entra com um título genérico.
 */
export class OEmbedTvMeta implements TvMeta {
  private readonly cache = new Map<string, TvLookup>();

  constructor(private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async lookup(videoId: string): Promise<TvLookup> {
    const hit = this.cache.get(videoId);
    if (hit) return hit;
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}`;
    let result: TvLookup;
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(5000) });
      if (res.status === 401 || res.status === 403) result = 'blocked';
      else if (res.status === 400 || res.status === 404) result = 'not_found';
      else if (!res.ok) return { title: '', author: '' };
      else {
        const body = (await res.json()) as { title?: string; author_name?: string };
        result = {
          title: String(body.title ?? '').slice(0, 200),
          author: String(body.author_name ?? '').slice(0, 100),
        };
      }
    } catch {
      return { title: '', author: '' };
    }
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(videoId, result);
    return result;
  }
}

/** Testes e servidor sem internet: todo vídeo entra, com o id no título. */
export class OfflineTvMeta implements TvMeta {
  async lookup(videoId: string): Promise<TvLookup> {
    return { title: `Vídeo ${videoId}`, author: '' };
  }
}
