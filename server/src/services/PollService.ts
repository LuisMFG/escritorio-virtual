import type { PollView } from '@office/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { polls, pollVotes, users } from '../db/schema.js';

type PollRow = typeof polls.$inferSelect;

/** Enquetes do chat: criar, votar (dá para trocar), encerrar e montar a visão de cada pessoa. */
export class PollService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(
    messageId: number,
    roomId: string,
    userId: string,
    data: { question: string; options: string[]; anonymous: boolean },
  ): PollRow {
    return this.db
      .insert(polls)
      .values({
        messageId,
        roomId,
        question: data.question,
        options: JSON.stringify(data.options),
        anonymous: data.anonymous,
        createdBy: userId,
        createdAt: this.now(),
      })
      .returning()
      .get();
  }

  find(pollId: number): PollRow | undefined {
    return this.db.select().from(polls).where(eq(polls.id, pollId)).get();
  }

  /** Vota ou troca o voto. Devolve o motivo se não der. */
  vote(pollId: number, userId: string, option: number): string | null {
    const poll = this.find(pollId);
    if (!poll) return 'Essa enquete não existe mais.';
    if (poll.closedAt) return 'A enquete já foi encerrada.';
    if (option >= (JSON.parse(poll.options) as string[]).length) return 'Opção inválida.';
    this.db
      .insert(pollVotes)
      .values({ pollId, userId, option, votedAt: this.now() })
      .onConflictDoUpdate({
        target: [pollVotes.pollId, pollVotes.userId],
        set: { option, votedAt: this.now() },
      })
      .run();
    return null;
  }

  close(pollId: number): void {
    this.db.update(polls).set({ closedAt: this.now() }).where(eq(polls.id, pollId)).run();
  }

  /** Visão da enquete para quem está vendo (com o voto dessa pessoa). */
  view(pollId: number, viewerId: string): PollView | null {
    const poll = this.find(pollId);
    return poll ? this.build(poll, viewerId) : null;
  }

  /** Enquetes de várias mensagens (histórico do chat), por id da mensagem. */
  forMessages(messageIds: number[], viewerId: string): Map<number, PollView> {
    if (messageIds.length === 0) return new Map();
    const rows = this.db.select().from(polls).where(inArray(polls.messageId, messageIds)).all();
    return new Map(rows.map((p) => [p.messageId, this.build(p, viewerId)]));
  }

  private build(poll: PollRow, viewerId: string): PollView {
    const texts = JSON.parse(poll.options) as string[];
    const votes = this.db
      .select({ userId: pollVotes.userId, option: pollVotes.option, name: users.name })
      .from(pollVotes)
      .innerJoin(users, eq(users.id, pollVotes.userId))
      .where(eq(pollVotes.pollId, poll.id))
      .orderBy(pollVotes.votedAt)
      .all();
    const creator = this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, poll.createdBy))
      .get();
    return {
      id: poll.id,
      messageId: poll.messageId,
      question: poll.question,
      options: texts.map((text, i) => {
        const mine = votes.filter((v) => v.option === i);
        return { text, votes: mine.length, voters: poll.anonymous ? [] : mine.map((v) => v.name) };
      }),
      total: votes.length,
      anonymous: poll.anonymous,
      closed: Boolean(poll.closedAt),
      createdBy: poll.createdBy,
      createdByName: creator?.name ?? '?',
      myVote: votes.find((v) => v.userId === viewerId)?.option ?? null,
    };
  }
}
