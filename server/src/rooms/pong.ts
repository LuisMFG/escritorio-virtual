import {
  addPongPoint,
  ARCADE_CPU_SESSION,
  ARCADE_SLOTS,
  ballAt,
  canHit,
  clampPaddle,
  encodeBall,
  hitBall,
  isDeuce,
  launch,
  newPongScore,
  PONG,
  serveBall,
  servingSlot,
  sideOf,
  simulate,
  type ArcadeGame,
  type ArcadeLevel,
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

/**
 * Como o computador joga em cada nível: quanto demora para reagir (ms), a que velocidade a
 * raquete vai para os lados (m/s), a chance de errar mesmo alcançando, para que lado ele manda
 * a bola (velocidade lateral da raquete no toque), quanto ele empurra (fundo e rápido) e o
 * quanto o toque sai fora do centro.
 */
const CPU: Record<
  ArcadeLevel,
  { reaction: number; speed: number; miss: number; aim: number; push: number; offset: number }
> = {
  facil: { reaction: 380, speed: 1.2, miss: 0.12, aim: 0.6, push: 0, offset: 0.09 },
  medio: { reaction: 250, speed: 2, miss: 0.05, aim: 1.5, push: 1, offset: 0.05 },
  dificil: { reaction: 150, speed: 3, miss: 0.015, aim: 2.6, push: 2.2, offset: 0.025 },
};

/** Máquina de bolas: tempo de voo (s) e o quanto as bolas se espalham para os lados (m). */
const MACHINE: Record<ArcadeLevel, { flight: number; spread: number; deep: number }> = {
  facil: { flight: 1.25, spread: 0.25, deep: 0.45 },
  medio: { flight: 0.95, spread: 0.5, deep: 0.6 },
  dificil: { flight: 0.72, spread: 0.68, deep: 0.8 },
};
/** Pausa da máquina antes de lançar (ms) e do computador antes de sacar. */
const MACHINE_MS = 700;
const CPU_SERVE_MS = 1200;
/** Alcance da raquete (centro da raquete até o centro da bola). */
const REACH = PONG.paddleR + PONG.ballR;

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
  /** Computador ou máquina: a vaga dele, quando ele age e a rebatida planejada. */
  private readonly cpu: ArcadeSlot | null;
  private cpuAt = 0;
  private plan: { t0: number; t: number; x: number; y: number; miss: boolean } | null = null;
  /** Treino com a máquina: bolas devolvidas e perdidas. */
  private drill = { ok: 0, miss: 0 };

  constructor(
    private readonly game: ArcadeGame,
    /** Nomes de um lado ("Ana" ou "Ana e Bia"), para os avisos. */
    private readonly names: (side: PongSide) => string,
    private readonly random: () => number = Math.random,
  ) {
    for (const slot of ARCADE_SLOTS) this.setPaddle(slot, home(slot, game.mode));
    this.cpu = ARCADE_SLOTS.find((s) => game[`${s}Session`] === ARCADE_CPU_SESSION) ?? null;
    this.game.detail = this.machine ? 'Treino: devolva as bolas da máquina.' : '';
    this.write();
  }

  /** Treino contra a máquina de bolas (ela só lança; nunca rebate). */
  private get machine(): boolean {
    return this.game.solo === 'practice' && Boolean(this.cpu);
  }

  private get level(): ArcadeLevel {
    return (['facil', 'medio', 'dificil'] as const).find((l) => l === this.game.level) ?? 'medio';
  }

  /** Vaga de quem saca agora (no treino, sempre a máquina). */
  get server(): ArcadeSlot {
    if (this.machine) return this.cpu!;
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
    if (this.cpu) this.cpuTick(now);
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
    if (this.machine) return this.drillPoint(side, now);
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

  /** Treino com a máquina: conta as devolvidas e as perdidas (sem sets nem fim). */
  private drillPoint(side: PongSide, now: number): null {
    const mine = side !== sideOf(this.cpu!);
    if (mine) this.drill.ok++;
    else this.drill.miss++;
    this.pending = null;
    this.phase = 'point';
    this.resumeAt = now + PONG.pointPauseMs / 2;
    const total = this.drill.ok + this.drill.miss;
    this.game.detail = `${mine ? 'Boa!' : 'Essa passou.'} ${this.drill.ok} de ${total} devolvidas.`;
    this.write();
    return null;
  }

  /** O computador (ou a máquina) age: saca, lança, anda até a bola e rebate. */
  private cpuTick(now: number): void {
    const slot = this.cpu!;
    const side = sideOf(slot);
    if (this.someoneAway()) {
      this.cpuAt = 0;
      return;
    }
    if (this.phase === 'serve' && this.server === slot) {
      this.cpuAt ||= now + (this.machine ? MACHINE_MS : CPU_SERVE_MS);
      if (now < this.cpuAt) return;
      this.cpuAt = 0;
      if (this.machine) this.machineLaunch(slot, now);
      else this.serve(slot, { ...home(slot, 1), y: 0.25 + this.random() * 1.0, t: now }, now);
      return;
    }
    const ball = this.ball;
    if (this.machine || this.phase !== 'rally' || !ball) return;
    if (ball.by === side) {
      // Voltando para o meio enquanto o outro rebate.
      this.moveTowards(slot, home(slot, 1));
      return;
    }
    if (this.plan?.t0 !== ball.t0) this.plan = this.planHit(ball, side, now);
    const plan = this.plan;
    if (!plan) return;
    this.moveTowards(slot, { x: plan.x, y: plan.y });
    if (plan.miss || now < plan.t) return;
    const sim = simulate(ball, plan.t);
    if (sim.point || !sim.ball) return;
    const at = ballAt(sim.ball, plan.t);
    const skill = CPU[this.level];
    const off = (this.random() * 2 - 1) * skill.offset;
    const paddle = { x: at.x, y: at.y + off };
    this.setPaddle(slot, clampPaddle(side, paddle));
    // Manda para o lado longe da raquete do outro (no fácil, quase reto).
    const rival = this.paddles.get(`${side === 'a' ? 'b' : 'a'}1` as ArcadeSlot);
    const away = rival && rival.y < PONG.tableW / 2 ? 1 : -1;
    const vy = away * skill.aim * (0.5 + this.random() * 0.5);
    const vx = (side === 'a' ? 1 : -1) * skill.push;
    this.plan = { ...plan, miss: true };
    this.hit(slot, { t: plan.t, x: paddle.x, y: paddle.y, vx, vy }, now);
  }

  /**
   * Onde e quando o computador rebate esta bola: o primeiro instante depois do quique do lado
   * dele com a bola numa altura que dá, perto da linha de fundo. Erra se não der tempo de chegar
   * (reação e velocidade do nível) ou pela chance de errar.
   */
  private planHit(ball: PongBall, side: PongSide, now: number) {
    const skill = CPU[this.level];
    const me = this.paddles.get(this.cpu!)!;
    const homeX = home(this.cpu!, 1).x;
    let best: { t: number; x: number; y: number; reachable: boolean } | null = null;
    for (let t = Math.max(now, ball.t0); t < ball.t0 + 4000; t += 10) {
      const sim = simulate(ball, t);
      if (sim.point || !sim.ball) break;
      if ((side === 'a' ? sim.ball.na : sim.ball.nb) !== 1) continue;
      const at = ballAt(sim.ball, t);
      if (at.h > PONG.reachUp - 0.1 || at.h < PONG.reachDown + 0.1) continue;
      const zone = clampPaddle(side, at);
      if (Math.abs(zone.x - at.x) > 0.01) continue;
      // Chega a tempo? Reage depois de `reaction` e anda a `speed` (para o lado e para a frente).
      const time = Math.max(0, (t - ball.t0 - skill.reaction) / 1000);
      const reachable = Math.hypot(at.y - me.y, at.x - me.x) <= time * skill.speed + REACH;
      // O ponto mais perto de onde ele espera (atrás da mesa), como quem joga de verdade.
      const better =
        !best ||
        (reachable && !best.reachable) ||
        (reachable === best.reachable && Math.abs(at.x - homeX) < Math.abs(best.x - homeX));
      if (better) best = { t, x: at.x, y: at.y, reachable };
    }
    if (!best) return null;
    return {
      t0: ball.t0,
      t: best.t,
      x: best.x,
      y: best.y,
      miss: !best.reachable || this.random() < skill.miss,
    };
  }

  /** Raquete do computador andando até um ponto, na velocidade do nível (para todos verem). */
  private moveTowards(slot: ArcadeSlot, to: PongPoint): void {
    const from = this.paddles.get(slot)!;
    const step = (CPU[this.level].speed * 1000) / 60 / 1000;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) return;
    const k = Math.min(1, step / d);
    this.setPaddle(slot, clampPaddle(sideOf(slot), { x: from.x + dx * k, y: from.y + dy * k }));
  }

  /** A máquina lança uma bola para o lado de quem treina (mais rápida e aberta nos níveis altos). */
  private machineLaunch(slot: ArcadeSlot, now: number): void {
    const side = sideOf(slot);
    const m = MACHINE[this.level];
    const from = { ...home(slot, 1), h: 0.3, y: PONG.tableW / 2 + (this.random() - 0.5) * 0.4 };
    const net = PONG.tableL / 2;
    const depth = (0.3 + this.random() * (m.deep - 0.3)) * net;
    const to = {
      x: side === 'a' ? net + depth : net - depth,
      y: PONG.tableW / 2 + (this.random() * 2 - 1) * m.spread,
    };
    this.ball = launch(from, to, m.flight, now, side, 0);
    this.phase = 'rally';
    this.pending = null;
    this.game.detail = '';
    this.write();
  }

  private setPaddle(slot: ArcadeSlot, p: PongPoint): void {
    this.paddles.set(slot, p);
    this.game[`${slot}Px`] = p.x;
    this.game[`${slot}Py`] = p.y;
  }

  /** Escreve o placar, a vez, o momento e a bola no estado da mesa. */
  private write(): void {
    // Treino com a máquina: o placar é devolvidas × perdidas (do lado de quem treina).
    const drillSide = this.machine ? (sideOf(this.cpu!) === 'a' ? 'b' : 'a') : null;
    Object.assign(this.game, {
      scoreA: drillSide
        ? drillSide === 'a'
          ? this.drill.ok
          : this.drill.miss
        : this.score.points.a,
      scoreB: drillSide
        ? drillSide === 'b'
          ? this.drill.ok
          : this.drill.miss
        : this.score.points.b,
      setsA: this.score.sets.a,
      setsB: this.score.sets.b,
      turn: this.server,
      phase: this.phase,
      ball: encodeBall(this.ball),
    });
  }
}
