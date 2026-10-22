import type { GameScore } from '@office/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { gameScores, users } from '../db/schema.js';

/** Placar dos mini-jogos (vitórias, derrotas e empates por pessoa). */
export class GameService {
  constructor(private readonly db: Db) {}

  /** Partida com vencedor. */
  recordWin(game: string, winnerId: string, loserId: string): void {
    this.bump(game, winnerId, 'wins');
    this.bump(game, loserId, 'losses');
  }

  /** Partida de duplas (Salão de Jogos, Fase 57): vitória para cada um de um lado, derrota do outro. */
  recordTeams(game: string, winners: readonly string[], losers: readonly string[]): void {
    for (const id of winners) this.bump(game, id, 'wins');
    for (const id of losers) this.bump(game, id, 'losses');
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
      })
      .from(gameScores)
      .innerJoin(users, eq(users.id, gameScores.userId))
      .where(eq(gameScores.game, game))
      .$dynamic();
  }

  private bump(game: string, userId: string, field: 'wins' | 'losses' | 'draws'): void {
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
