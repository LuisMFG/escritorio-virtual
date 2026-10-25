import type { GameScore } from '@office/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { gameScores, users } from '../db/schema.js';

/** Placar dos mini-jogos (vitórias, derrotas e empates por pessoa). */
export class GameService {
  constructor(private readonly db: Db) {}

  /** Partida com vencedor. Devolve as vitórias seguidas de quem venceu. */
  recordWin(game: string, winnerId: string, loserId: string): number {
    const streak = this.win(game, winnerId);
    this.lose(game, loserId);
    return streak;
  }

  /**
   * Partida de duplas (Salão de Jogos, Fase 57): vitória para cada um de um lado, derrota do
   * outro. Devolve as vitórias seguidas de cada vencedor.
   */
  recordTeams(
    game: string,
    winners: readonly string[],
    losers: readonly string[],
  ): Map<string, number> {
    const streaks = new Map(winners.map((id) => [id, this.win(game, id)]));
    for (const id of losers) this.lose(game, id);
    return streaks;
  }

  recordDraw(game: string, a: string, b: string): void {
    this.bump(game, a, 'draws');
    this.bump(game, b, 'draws');
  }

  /** Mais vitórias primeiro (desempate: menos derrotas). */
  top(game: string, limit: number): GameScore[] {
    return this.query(game)
      .orderBy(desc(gameScores.wins), gameScores.losses, desc(gameScores.draws))
      .limit(limit)
      .all();
  }

  /** Placar de algumas pessoas (quem não jogou ainda vem zerado). */
  of(game: string, userIds: string[]): GameScore[] {
    if (userIds.length === 0) return [];
    const found = new Map(
      this.query(game)
        .where(and(eq(gameScores.game, game), inArray(gameScores.userId, userIds)))
        .all()
        .map((s) => [s.userId, s]),
    );
    const names = new Map(
      this.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, userIds))
        .all()
        .map((u) => [u.id, u.name]),
    );
    return userIds.map(
      (userId) =>
        found.get(userId) ?? {
          userId,
          name: names.get(userId) ?? '?',
          wins: 0,
          losses: 0,
          draws: 0,
          streak: 0,
          bestStreak: 0,
        },
    );
  }

  private query(game: string) {
    return this.db
      .select({
        userId: gameScores.userId,
        name: users.name,
        wins: gameScores.wins,
        losses: gameScores.losses,
        draws: gameScores.draws,
        streak: gameScores.streak,
        bestStreak: gameScores.bestStreak,
      })
      .from(gameScores)
      .innerJoin(users, eq(users.id, gameScores.userId))
      .where(eq(gameScores.game, game))
      .$dynamic();
  }

  /** Mais uma vitória e mais uma na sequência (a melhor sequência acompanha). */
  private win(game: string, userId: string): number {
    const row = this.db
      .insert(gameScores)
      .values({ userId, game, wins: 1, streak: 1, bestStreak: 1 })
      .onConflictDoUpdate({
        target: [gameScores.userId, gameScores.game],
        // No UPDATE do SQLite, as colunas à direita ainda são os valores de antes.
        set: {
          wins: sql`${gameScores.wins} + 1`,
          streak: sql`${gameScores.streak} + 1`,
          bestStreak: sql`max(${gameScores.bestStreak}, ${gameScores.streak} + 1)`,
        },
      })
      .returning({ streak: gameScores.streak })
      .get();
    return row?.streak ?? 1;
  }

  /** Perdeu: mais uma derrota e a sequência volta a zero. */
  private lose(game: string, userId: string): void {
    this.db
      .insert(gameScores)
      .values({ userId, game, losses: 1 })
      .onConflictDoUpdate({
        target: [gameScores.userId, gameScores.game],
        set: { losses: sql`${gameScores.losses} + 1`, streak: 0 },
      })
      .run();
  }

  private bump(game: string, userId: string, field: 'draws'): void {
    const col = gameScores[field];
    this.db
      .insert(gameScores)
      .values({ userId, game, [field]: 1 })
      .onConflictDoUpdate({
        target: [gameScores.userId, gameScores.game],
        set: { [field]: sql`${col} + 1` },
      })
      .run();
  }
}
