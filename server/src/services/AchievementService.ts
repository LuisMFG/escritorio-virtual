import {
  ACHIEVEMENTS,
  OFFICE_TIME_ZONE,
  findAchievement,
  parseShowcase,
  type AchievementDef,
  type AchievementStat,
  type AchievementsResponse,
} from '@office/shared';
import { and, eq, sql } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import type { Db } from '../db/client.js';
import { rooms, userAchievements, userStats, userVisits } from '../db/schema.js';
import type { UserService } from './UserService.js';

/** Dia (contado desde 1970) no fuso do escritório, para os "dias seguidos". */
export function officeDay(date: Date, timeZone = OFFICE_TIME_ZONE): number {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

/**
 * Conquistas: contadores por pessoa e desbloqueio. `unlocked` avisa o canal global, que
 * mostra o aviso para a pessoa.
 */
export class AchievementService {
  readonly events = new EventEmitter<{ unlocked: [userId: string, def: AchievementDef] }>();
  /**
   * Conquistas que já se sabe que a pessoa tem (`usuário:conquista`). Várias são pedidas a cada
   * ação (cada traço no quadro, cada mensagem): sem isso, uma gravação no banco por ação.
   */
  private readonly known = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly users: UserService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events.setMaxListeners(100);
  }

  /** Desbloqueia (uma vez só). Devolve `true` se foi agora. */
  unlock(userId: string, id: string): boolean {
    const def = findAchievement(id);
    if (!def) return false;
    const key = `${userId}:${id}`;
    if (this.known.has(key)) return false;
    this.known.add(key);
    const res = this.db
      .insert(userAchievements)
      .values({ userId, achievementId: id, unlockedAt: this.now() })
      .onConflictDoNothing()
      .run();
    if (res.changes === 0) return false;
    this.events.emit('unlocked', userId, def);
    return true;
  }

  /** Soma no contador e desbloqueia o que tiver chegado na meta. */
  bump(userId: string, stat: AchievementStat, by = 1): number {
    const value = this.setStat(userId, stat, sql`${userStats.value} + ${by}`, by);
    this.checkGoals(userId, stat, value);
    return value;
  }

  /** Entrou numa sala: conta a visita e o dia (para os dias seguidos). */
  visit(userId: string, roomId: string): void {
    this.db.insert(userVisits).values({ userId, roomId }).onConflictDoNothing().run();
    const total =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(rooms)
        .get()?.n ?? 0;
    const seen =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(userVisits)
        .where(eq(userVisits.userId, userId))
        .get()?.n ?? 0;
    this.setStat(userId, 'rooms', seen, seen);
    if (total > 1 && seen >= total) this.unlock(userId, 'explorer');
    this.touchDay(userId);
  }

  /** Dias seguidos: mesmo dia não conta de novo; pular um dia recomeça do 1. */
  touchDay(userId: string): void {
    const today = officeDay(this.now());
    const last = this.stat(userId, 'streakDay');
    if (last === today) return;
    const streak = last === today - 1 ? this.stat(userId, 'streak') + 1 : 1;
    this.setStat(userId, 'streakDay', today, today);
    this.setStat(userId, 'streak', streak, streak);
    this.checkGoals(userId, 'streak', streak);
  }

  get(userId: string): AchievementsResponse {
    const unlocked = this.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId))
      .all()
      .map((r) => ({ id: r.achievementId, at: r.unlockedAt.getTime() }));
    const stats = Object.fromEntries(
      this.db
        .select()
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .all()
        .map((r) => [r.key, r.value]),
    );
    const user = this.users.findById(userId);
    return { unlocked, stats, showcase: parseShowcase(user?.badges) };
  }

  /** Escolhe os emblemas exibidos (só conquistas desbloqueadas). */
  setShowcase(userId: string, ids: string[]): string[] | null {
    const mine = new Set(this.get(userId).unlocked.map((u) => u.id));
    if (!ids.every((id) => mine.has(id))) return null;
    this.users.update(userId, { badges: ids.join(',') });
    return ids;
  }

  private stat(userId: string, key: string): number {
    return (
      this.db
        .select({ value: userStats.value })
        .from(userStats)
        .where(and(eq(userStats.userId, userId), eq(userStats.key, key)))
        .get()?.value ?? 0
    );
  }

  private setStat(
    userId: string,
    key: string,
    update: ReturnType<typeof sql> | number,
    initial: number,
  ): number {
    return this.db
      .insert(userStats)
      .values({ userId, key, value: initial })
      .onConflictDoUpdate({ target: [userStats.userId, userStats.key], set: { value: update } })
      .returning({ value: userStats.value })
      .get()!.value;
  }

  private checkGoals(userId: string, stat: AchievementStat, value: number): void {
    for (const a of ACHIEVEMENTS) {
      if (a.stat === stat && a.goal !== undefined && value >= a.goal) this.unlock(userId, a.id);
    }
  }
}
