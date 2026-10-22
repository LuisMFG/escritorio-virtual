import {
  addPongPoint,
  ARCADE_SLOTS,
  ballAt,
  canHit,
  clampPaddle,
  encodeBall,
  hitBall,
  isDeuce,
  newPongScore,
  PONG,
  serveBall,
  servingSlot,
  sideOf,
  simulate,
  type ArcadeGame,
  type ArcadeReply,
  type ArcadeSlot,
  type PongBall,
  type PongPoint,
  type PongScore,
  type PongSide,
} from '@office/shared';

/** Fim da partida no jogo: quem venceu e os sets. */
export interface PongEnd {
  winner: PongSide;
  sets: Record<PongSide, number>;
}

/** Pedido de rebatida: quando a raquete tocou a bola (hora do servidor), onde e a que velocidade. */
export interface PongHitClaim extends PongPoint {
  t: number;
  vx: number;
  vy: number;
}

const refuse = (reason: string): ArcadeReply => ({ ok: false, reason });

/** Onde a raquete fica no começo: atrás do meio de cada ponta; no 2×2, um parceiro de cada lado. */
function home(slot: ArcadeSlot, mode: number): PongPoint {
  const W = PONG.tableW;
  const y = mode === 2 ? (slot.endsWith('1') ? W * 0.3 : W * 0.7) : W / 2;
  return { x: slot.startsWith('a') ? -0.25 : PONG.tableL + 0.25, y };
}

/**
 * Uma partida de ping-pong no servidor (Fase 58): placar, saque, a bola em jogo e as raquetes,
 * escritos no estado da mesa para todo mundo ver. A sala chama `tick` a 60 Hz.
 *
 * A bola só muda de trecho no saque e na rebatida (os quiques todo mundo calcula igual). A
 * rebatida vem do navegador de quem jogou, com o instante do toque: o servidor confere se a
 * bola estava ao alcance naquele instante (volta no tempo até `maxRewindMs`) e, se sim, lança a
 * bola de lá. Por isso o ponto só fecha `graceMs` depois do lance que o decidiu: uma rebatida que
 * chegou atrasada ainda vale.
 */
export class PongMatch {
  private score: PongScore = newPongScore();
  private phase: 'serve' | 'rally' | 'point' = 'serve';
  private ball: PongBall | null = null;
  /** Ponto já decidido pela bola, esperando a folga de uma rebatida atrasada. */
  private pending: { side: PongSide; t: number } | null = null;
  private resumeAt = 0;
  private readonly paddles = new Map<ArcadeSlot, PongPoint>();

  constructor(
    private readonly game: ArcadeGame,
    /** Nomes de um lado ("Ana" ou "Ana e Bia"), para os avisos. */
    private readonly names: (side: PongSide) => string,
  ) {
    for (const slot of ARCADE_SLOTS) this.setPaddle(slot, home(slot, game.mode));
    this.game.detail = '';
    this.write();
  }

  /** Vaga de quem saca agora. */
  get server(): ArcadeSlot {
    return servingSlot(this.score, this.game.mode);
  }

  /** Alguém da partida está fora (saiu e tem o prazo para voltar). */
  private someoneAway(): string | null {
    for (const s of ARCADE_SLOTS) if (this.game[`${s}Away`]) return this.game[`${s}Name`];
    return null;
  }

  /** Saque de quem tem a vez. `t`: quando o navegador sacou (hora do servidor). */
  serve(slot: ArcadeSlot, p: PongPoint & { t: number }, now: number): ArcadeReply {
    if (this.phase !== 'serve') return refuse('Ainda não é hora de sacar.');
    if (slot !== this.server) return refuse('Não é o seu saque.');
    const away = this.someoneAway();
    if (away) return refuse(`Esperando ${away} voltar.`);
    const side = sideOf(slot);
    const paddle = clampPaddle(side, p);
    const t = Math.min(now, Math.max(now - PONG.maxRewindMs, p.t));
    this.ball = serveBall(side, paddle, t);
    this.phase = 'rally';
    this.pending = null;
    this.game.detail = '';
    this.setPaddle(slot, paddle);
    this.write();
    return { ok: true };
  }

  /** A raquete tocou a bola: confere no instante do toque e lança a bola de volta. */
  hit(slot: ArcadeSlot, c: PongHitClaim, now: number): ArcadeReply {
    if (this.phase !== 'rally' || !this.ball) return refuse('Não há bola em jogo.');
    if (c.t > now + 50 || c.t < now - PONG.maxRewindMs || c.t < this.ball.t0) {
      return refuse('Rebatida fora de hora.');
    }
    if (this.pending && c.t >= this.pending.t) return refuse('O ponto já tinha acabado.');
    const sim = simulate(this.ball, c.t);
    if (sim.point || !sim.ball) return refuse('O ponto já tinha acabado.');
    const side = sideOf(slot);
    const paddle = clampPaddle(side, c);
    const last = this.paddles.get(slot);
    if (last && Math.hypot(last.x - paddle.x, last.y - paddle.y) > 1) {
      return refuse('A raquete não estava lá.');
    }
    const at = ballAt(sim.ball, c.t);
    if (!canHit(sim.ball, at, side, paddle, PONG.reachSlack)) {
      return refuse('Não deu para alcançar a bola.');
    }
    this.ball = hitBall(at, paddle, { x: c.vx, y: c.vy }, side, sim.ball.hits, c.t);
    this.pending = null;
    this.setPaddle(slot, paddle);
    this.write();
    return { ok: true };
  }

  /** Onde está a raquete (o navegador manda enquanto ela mexe). */
  paddle(slot: ArcadeSlot, p: PongPoint): void {
    this.setPaddle(slot, clampPaddle(sideOf(slot), p));
  }

  /** Alguém saiu no meio do ponto: o ponto vale de novo, e o saque espera a volta. */
  suspend(): void {
    if (this.phase === 'serve') return;
    this.phase = 'serve';
    this.ball = null;
    this.pending = null;
    this.write();
  }

  /** Passo do jogo (60 Hz). Devolve o fim da partida, quando alguém fecha os sets. */
  tick(now: number): PongEnd | null {
    if (this.phase === 'rally' && this.ball) {
      if (!this.pending) {
        const sim = simulate(this.ball, now);
        if (sim.point) this.pending = sim.point;
      }
      if (this.pending && now >= this.pending.t + PONG.graceMs) {
        return this.award(this.pending.side, now);
      }
    } else if (this.phase === 'point' && now >= this.resumeAt) {
      this.phase = 'serve';
      this.ball = null;
      this.game.detail = isDeuce(this.score) ? 'Deuce!' : '';
      this.write();
    }
    return null;
  }

  private award(side: PongSide, now: number): PongEnd | null {
    const res = addPongPoint(this.score, side);
    this.score = res.score;
    this.pending = null;
    this.phase = 'point';
    this.resumeAt = now + PONG.pointPauseMs;
    const who = this.names(side);
    this.game.detail = res.match
      ? `Fim de jogo: ${who}`
      : res.set
        ? `Set de ${who}!`
        : `Ponto de ${who}`;
    this.write();
    return res.match ? { winner: res.match, sets: res.score.sets } : null;
  }

  private setPaddle(slot: ArcadeSlot, p: PongPoint): void {
    this.paddles.set(slot, p);
    this.game[`${slot}Px`] = p.x;
    this.game[`${slot}Py`] = p.y;
  }

  /** Escreve o placar, a vez, o momento e a bola no estado da mesa. */
  private write(): void {
    Object.assign(this.game, {
      scoreA: this.score.points.a,
      scoreB: this.score.points.b,
      setsA: this.score.sets.a,
      setsB: this.score.sets.b,
      turn: this.server,
      phase: this.phase,
      ball: encodeBall(this.ball),
    });
  }
}
