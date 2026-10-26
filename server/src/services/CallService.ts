import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  CALL_INVITE_MS,
  CALL_MAX_PEOPLE,
  CALL_REJOIN_MS,
  type CallInvite,
  type CallInviteOutcome,
  type CallInviteResult,
  type CallMedia,
  type CallView,
} from '@office/shared';

/** O que o serviço precisa saber de quem está online (presença e foco). */
export interface CallDirectory {
  isOnline(userId: string): boolean;
  nameOf(userId: string): string;
  /** Visual do avatar (o rosto aparece na chamada quando a câmera está desligada). */
  figureOf(userId: string): string;
  /** Em Foco ou Ocupado: o convite chega sem som. */
  isQuiet(userId: string): boolean;
}

type Member = { name: string; figure: string; away: boolean } & CallMedia;

interface Call {
  id: string;
  startedAt: number;
  members: Map<string, Member>;
}

/** Uma chamada guardada ao desligar o servidor. */
export interface CallSnapshot {
  id: string;
  startedAt: number;
  members: [userId: string, member: Member][];
}

interface PendingInvite {
  invite: CallInvite;
  toUserId: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Chamadas por convite (Fase 49), só em memória: quem está em qual chamada e os convites
 * pendentes. Quem usa (o canal global) escuta os eventos e manda as mensagens.
 */
export class CallService {
  readonly events = new EventEmitter<{
    /** Convite novo para `toUserId`. */
    invited: [toUserId: string, invite: CallInvite];
    /** O convite não vale mais (para quem recebeu). */
    inviteGone: [toUserId: string, inviteId: string];
    /** Resposta para quem convidou. */
    result: [fromUserId: string, result: CallInviteResult];
    /** A chamada dessas pessoas mudou (cada uma recebe `callOf`). */
    changed: [userIds: string[]];
    /** Essas pessoas saíram da chamada (ou ela acabou): saem também da sala de mídia. */
    left: [callId: string, userIds: string[]];
  }>();

  private readonly calls = new Map<string, Call>();
  private readonly userCall = new Map<string, string>();
  private readonly invites = new Map<string, PendingInvite>();
  /** Quem caiu e ainda pode voltar: prazo para sair de vez. */
  private readonly holds = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly dir: CallDirectory,
    private readonly now: () => number = Date.now,
    private readonly timers: {
      set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
      clear: (t: ReturnType<typeof setTimeout>) => void;
    } = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) },
  ) {}

  /** Chamada de alguém, como os participantes veem. */
  callOf(userId: string): CallView | null {
    const call = this.callFor(userId);
    if (!call) return null;
    return {
      id: call.id,
      startedAt: call.startedAt,
      members: [...call.members].map(([id, m]) => ({ userId: id, ...m })),
    };
  }

  /** Os dois estão na mesma chamada. */
  sameCall(a: string, b: string): boolean {
    const ca = this.userCall.get(a);
    return Boolean(ca && ca === this.userCall.get(b));
  }

  invite(fromUserId: string, toUserId: string, reason: string): CallInviteOutcome {
    if (fromUserId === toUserId) return 'busy';
    if (!this.dir.isOnline(toUserId)) return 'offline';
    const call = this.callFor(fromUserId);
    if (this.userCall.has(toUserId)) return 'busy';
    if (call && call.members.size >= CALL_MAX_PEOPLE) return 'full';
    // Um convite por par: chamar de novo troca o anterior.
    for (const [id, p] of this.invites) {
      if (p.invite.fromUserId === fromUserId && p.toUserId === toUserId) this.drop(id);
    }
    const invite: CallInvite = {
      id: randomUUID(),
      callId: call?.id ?? null,
      fromUserId,
      fromName: this.dir.nameOf(fromUserId),
      reason,
      members: call ? [...call.members.values()].map((m) => m.name) : [this.dir.nameOf(fromUserId)],
      expiresAt: this.now() + CALL_INVITE_MS,
      quiet: this.dir.isQuiet(toUserId),
    };
    const timer = this.timers.set(() => this.expire(invite.id), CALL_INVITE_MS);
    this.invites.set(invite.id, { invite, toUserId, timer });
    this.events.emit('invited', toUserId, invite);
    return 'sent';
  }

  answer(userId: string, inviteId: string, accept: boolean): void {
    const pending = this.invites.get(inviteId);
    if (!pending || pending.toUserId !== userId) return;
    this.drop(inviteId);
    const { invite } = pending;
    if (!accept) return this.report(invite, userId, 'declined');
    if (!this.dir.isOnline(invite.fromUserId)) return this.report(invite, userId, 'offline');
    // Entra na chamada de quem chamou (a do convite, ou a que ele estiver agora).
    let call = this.callFor(invite.fromUserId);
    if (call && call.members.size >= CALL_MAX_PEOPLE) return this.report(invite, userId, 'full');
    if (this.userCall.has(userId)) this.leave(userId);
    if (!call) {
      call = { id: randomUUID(), startedAt: this.now(), members: new Map() };
      this.calls.set(call.id, call);
      this.join(call, invite.fromUserId);
    }
    this.join(call, userId);
    this.report(invite, userId, 'accepted');
    this.events.emit('changed', [...call.members.keys()]);
  }

  setMedia(userId: string, media: CallMedia): void {
    const call = this.callFor(userId);
    const me = call?.members.get(userId);
    if (!call || !me) return;
    Object.assign(me, media);
    this.events.emit('changed', [...call.members.keys()]);
  }

  /**
   * A conexão caiu (aba fechada, recarregada ou sem internet): continua na chamada como
   * "reconectando" por `CALL_REJOIN_MS`, mas sai da sala de mídia já. Os convites acabam.
   */
  hold(userId: string): void {
    this.dropInvites(userId);
    const call = this.callFor(userId);
    const me = call?.members.get(userId);
    if (!call || !me || me.away) return;
    // A câmera e a tela não voltam sozinhas (a aba nova começa com elas desligadas).
    Object.assign(me, { away: true, cam: false, screen: false });
    const timer = this.timers.set(() => {
      // Só se ainda for esta queda (voltou e caiu de novo: vale o prazo novo).
      if (this.holds.get(userId) !== timer) return;
      this.leave(userId);
    }, CALL_REJOIN_MS);
    this.holds.set(userId, timer);
    this.events.emit('changed', [...call.members.keys()]);
    this.events.emit('left', call.id, [userId]);
  }

  /** Voltou a tempo: está de novo na chamada. `false` se não estava esperando por ela. */
  resume(userId: string): boolean {
    const timer = this.holds.get(userId);
    const me = this.callFor(userId)?.members.get(userId);
    if (!timer || !me) return false;
    this.timers.clear(timer);
    this.holds.delete(userId);
    me.away = false;
    this.events.emit('changed', [...this.callFor(userId)!.members.keys()]);
    return true;
  }

  /** Para guardar ao desligar o servidor (atualização): as chamadas e quem está nelas. */
  snapshot(): CallSnapshot[] {
    return [...this.calls.values()].map((c) => ({
      id: c.id,
      startedAt: c.startedAt,
      members: [...c.members].map(([id, m]) => [id, { ...m }]),
    }));
  }

  /**
   * Volta as chamadas guardadas com todo mundo "reconectando": quem voltar em `CALL_REJOIN_MS`
   * (o canal global reconecta sozinho) continua na chamada, como numa queda de rede; quem não
   * voltar sai. A mídia nem para (o servidor de mídia não reinicia junto).
   */
  restore(list: readonly CallSnapshot[]): void {
    for (const s of list) {
      const call: Call = { id: s.id, startedAt: s.startedAt, members: new Map() };
      for (const [userId, m] of s.members) {
        if (this.userCall.has(userId)) continue;
        call.members.set(userId, { ...m, away: true, cam: false, screen: false });
        this.userCall.set(userId, call.id);
        const timer = this.timers.set(() => {
          if (this.holds.get(userId) === timer) this.leave(userId);
        }, CALL_REJOIN_MS);
        this.holds.set(userId, timer);
      }
      if (call.members.size) this.calls.set(call.id, call);
    }
  }

  /** Está na chamada, mas caiu e ainda não voltou. */
  isAway(userId: string): boolean {
    return this.holds.has(userId);
  }

  /** Sai da chamada; com uma pessoa só, a chamada acaba. */
  leave(userId: string): void {
    const hold = this.holds.get(userId);
    if (hold) {
      this.timers.clear(hold);
      this.holds.delete(userId);
    }
    const call = this.callFor(userId);
    if (!call) return;
    call.members.delete(userId);
    this.userCall.delete(userId);
    const affected = [userId, ...call.members.keys()];
    const gone = [userId];
    if (call.members.size < 2) {
      for (const id of call.members.keys()) {
        this.userCall.delete(id);
        const t = this.holds.get(id);
        if (t) this.timers.clear(t);
        this.holds.delete(id);
      }
      gone.push(...call.members.keys());
      call.members.clear();
      this.calls.delete(call.id);
    }
    this.events.emit('changed', affected);
    this.events.emit('left', call.id, gone);
  }

  /** Saiu do escritório: sai da chamada e os convites dele/para ele acabam. */
  disconnect(userId: string): void {
    this.leave(userId);
    this.dropInvites(userId);
  }

  /** Convites dele e para ele acabam (ele saiu ou caiu). */
  private dropInvites(userId: string): void {
    for (const [id, p] of this.invites) {
      if (p.toUserId === userId) {
        this.drop(id);
        this.report(p.invite, userId, 'offline');
      } else if (p.invite.fromUserId === userId) {
        this.drop(id);
      }
    }
  }

  private callFor(userId: string): Call | undefined {
    const id = this.userCall.get(userId);
    return id ? this.calls.get(id) : undefined;
  }

  private join(call: Call, userId: string): void {
    call.members.set(userId, {
      name: this.dir.nameOf(userId),
      figure: this.dir.figureOf(userId),
      mic: true,
      cam: false,
      screen: false,
      away: false,
    });
    this.userCall.set(userId, call.id);
  }

  private expire(inviteId: string): void {
    const pending = this.invites.get(inviteId);
    if (!pending) return;
    this.drop(inviteId);
    this.report(pending.invite, pending.toUserId, 'expired');
  }

  /** Tira o convite e avisa quem recebeu que ele não vale mais. */
  private drop(inviteId: string): void {
    const pending = this.invites.get(inviteId);
    if (!pending) return;
    this.timers.clear(pending.timer);
    this.invites.delete(inviteId);
    this.events.emit('inviteGone', pending.toUserId, inviteId);
  }

  private report(invite: CallInvite, toUserId: string, outcome: CallInviteOutcome): void {
    this.events.emit('result', invite.fromUserId, {
      inviteId: invite.id,
      toUserId,
      toName: this.dir.nameOf(toUserId),
      outcome,
    });
  }
}
