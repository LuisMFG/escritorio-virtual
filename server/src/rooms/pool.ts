import {
  ARCADE_SLOTS,
  canPlaceCue,
  GROUP_NAMES,
  judgeShot,
  newPoolRules,
  onEight,
  otherGroup,
  POOL,
  rackBalls,
  remaining,
  shooterSlot,
  sideGroup,
  sideOf,
  simulateShot,
  timeoutRules,
  type ArcadeGame,
  type ArcadeReply,
  type ArcadeSlot,
  type PoolBalls,
  type PoolRules,
  type PoolShotMessage,
  type PoolShotRecord,
  type PoolSide,
} from '@office/shared';

/** Fim da partida: quem venceu e por quê. */
export interface PoolEnd {
  winner: PoolSide;
  reason: string;
}

/** Folga antes de a tacada começar na tela de todos (o pacote chega antes). */
const LEAD_MS = 150;
/** Pausa depois de as bolas pararem, antes da próxima vez. */
const SETTLE_MS = 400;

const refuse = (reason: string): ArcadeReply => ({ ok: false, reason });

/**
 * Uma partida de sinuca 8 Ball no servidor (Fase 59): as bolas, as regras e o tempo por tacada,
 * escritos no estado da mesa. Quem tem a vez manda a tacada (direção, força, efeito, onde pôs a
 * branca e a caçapa da 8); o servidor simula até as bolas pararem, julga e manda a tacada e as
 * posições finais. Os navegadores animam a mesma simulação e terminam nas mesmas posições.
 */
export class PoolMatch {
  private rules: PoolRules = newPoolRules();
  private balls: PoolBalls = rackBalls();
  /** A tacada em andamento termina (na tela) neste instante. */
  private busyUntil = 0;
  private deadline: number;
  private lastTick: number;
  /** Fim da partida, mostrado depois que as bolas param. */
  private pendingEnd: PoolEnd | null = null;
  /** O que a última tacada deu (falta, grupos, a vez), mostrado quando as bolas param. */
  private outcome = '';

  constructor(
    private readonly game: ArcadeGame,
    private readonly names: (side: PoolSide) => string,
    now: number,
  ) {
    this.deadline = now + POOL.shotMs;
    this.lastTick = now;
    this.game.shot = '';
    this.game.detail = 'Abertura: a branca pode ir em qualquer lugar atrás da linha.';
    this.write();
  }

  /** Vaga de quem taca agora. */
  get shooter(): ArcadeSlot {
    return shooterSlot(this.rules, this.game.mode);
  }

  private someoneAway(): string | null {
    for (const s of ARCADE_SLOTS) if (this.game[`${s}Away`]) return this.game[`${s}Name`];
    return null;
  }

  /** Nome de quem está numa vaga. */
  private nameOf(slot: ArcadeSlot): string {
    return this.game[`${slot}Name`] || this.names(sideOf(slot));
  }

  /** Tacada de quem tem a vez. */
  shoot(slot: ArcadeSlot, msg: PoolShotMessage, now: number): ArcadeReply {
    if (now < this.busyUntil || this.game.phase === 'shot') {
      return refuse('Espere as bolas pararem.');
    }
    if (this.pendingEnd) return refuse('A partida acabou.');
    if (slot !== this.shooter) return refuse('Não é a sua vez.');
    const away = this.someoneAway();
    if (away) return refuse(`Esperando ${away} voltar.`);
    const len = Math.sqrt(msg.dx * msg.dx + msg.dy * msg.dy);
    if (len < 1e-6) return refuse('Mire antes de tacar.');
    const start = this.balls.slice();
    if (this.rules.inHand && msg.cx !== undefined && msg.cy !== undefined) {
      if (!canPlaceCue(start, [msg.cx, msg.cy], this.rules.breakShot)) {
        return refuse('A branca não cabe aí.');
      }
      start[0] = [msg.cx, msg.cy];
    }
    if (!start[0]) return refuse('Ponha a branca na mesa.');
    const side = sideOf(slot);
    if (onEight(this.rules, start, side) && msg.call === undefined) {
      return refuse('Cante a caçapa da 8: clique numa caçapa.');
    }
    const shot = { dx: msg.dx / len, dy: msg.dy / len, power: msg.power, sx: msg.sx, sy: msg.sy };
    const result = simulateShot(start, shot);
    const verdict = judgeShot(
      this.rules,
      start,
      result.final,
      result.events,
      msg.call ?? null,
      this.game.mode,
    );
    const record: PoolShotRecord = { ...shot, t0: now + LEAD_MS, start, ms: result.ms };
    this.balls = verdict.balls;
    const before = this.rules;
    this.rules = verdict.rules;
    this.busyUntil = record.t0 + result.ms + SETTLE_MS;
    this.deadline = this.busyUntil + POOL.shotMs;
    this.pendingEnd = verdict.end ?? null;
    const who = this.nameOf(slot);
    const next = this.nameOf(this.shooter);
    this.outcome = verdict.end
      ? ''
      : verdict.foul
        ? `Falta de ${who}: ${verdict.foul}. Bola na mão para ${next}.`
        : this.rules.groupA && !before.groupA
          ? `${who} fica com as ${GROUP_NAMES[sideGroup(this.rules, side) || 'solids']}.`
          : verdict.keep
            ? `${who} encaçapou e continua.`
            : `Vez de ${next}.`;
    // Vai a tacada e onde as bolas param; a vez, o placar e a falta só quando elas pararem na
    // tela de todos (não estraga a surpresa no meio da animação).
    Object.assign(this.game, {
      shot: JSON.stringify(record),
      balls: JSON.stringify(this.balls),
      phase: 'shot',
      aim: '',
    });
    return { ok: true };
  }

  /** Mira ao vivo de quem taca (os outros veem o taco). */
  aim(
    slot: ArcadeSlot,
    aim: { dx: number; dy: number; power: number; cx: number; cy: number },
  ): void {
    if (slot !== this.shooter || this.game.phase !== 'aim') return;
    this.game.aim = JSON.stringify(aim);
  }

  /** Passo do relógio (10 vezes por segundo): fim da tacada na tela, tempo esgotado, fim da partida. */
  tick(now: number): PoolEnd | null {
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (now < this.busyUntil) return null;
    if (this.game.phase === 'shot') {
      // As bolas pararam: o resultado aparece para todos ao mesmo tempo.
      this.game.detail = this.outcome;
      this.write();
    }
    if (this.pendingEnd) return this.pendingEnd;
    // Com alguém fora, o relógio da tacada para.
    if (this.someoneAway()) {
      this.deadline += dt;
      this.game.deadline = this.deadline;
      return null;
    }
    if (now > this.deadline) {
      const who = this.nameOf(this.shooter);
      this.rules = timeoutRules(this.rules, this.game.mode);
      this.deadline = now + POOL.shotMs;
      this.game.detail = `Tempo esgotado para ${who}. Bola na mão para ${this.nameOf(this.shooter)}.`;
      // A mira de quem perdeu a vez sai da mesa.
      this.game.aim = '';
      this.write();
    }
    return null;
  }

  /** Escreve as bolas, as regras, a vez e o placar (bolas do grupo encaçapadas) no estado. */
  private write(): void {
    const g = this.rules.groupA;
    const pocketed = (side: PoolSide) => {
      const group = side === 'a' ? g : g ? otherGroup(g) : '';
      return group ? 7 - remaining(this.balls, group) : 0;
    };
    Object.assign(this.game, {
      balls: JSON.stringify(this.balls),
      groupA: g,
      inHand: this.rules.inHand,
      breakShot: this.rules.breakShot,
      turn: this.shooter,
      phase: 'aim',
      deadline: this.deadline,
      scoreA: pocketed('a'),
      scoreB: pocketed('b'),
    });
  }
}
