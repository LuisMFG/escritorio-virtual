import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_CARGOS,
  isBirthdayToday,
  parseShowcase,
  type CargoInfo,
  type Role,
  type SessionResponse,
} from '@office/shared';
import { and, asc, desc, eq, isNotNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { cargos, sessions, users, type UserRow } from '../db/schema.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** O que aparece sobre o avatar e na lista de pessoas. */
export interface PublicProfile {
  name: string;
  cargo: string;
  cargoColor: string;
  role: Role;
  birthday: boolean;
  canEditRooms: boolean;
  /** Emblemas exibidos (ids separados por vírgula). */
  badges: string;
}

export interface NewUser {
  name: string;
  figure: string;
  gender?: 'M' | 'F';
  username?: string;
  passwordHash?: string;
  role?: Role;
}

type UserChanges = Partial<
  Pick<
    UserRow,
    | 'name'
    | 'figure'
    | 'gender'
    | 'username'
    | 'passwordHash'
    | 'role'
    | 'cargoId'
    | 'bio'
    | 'badges'
    | 'codeShare'
    | 'birthday'
    | 'disabled'
    | 'canEditRooms'
  >
>;

export class UserService {
  /** `updated` (UserRow): nome, cargo, papel… mudaram; as salas atualizam os avatares. */
  readonly events = new EventEmitter<{ updated: [UserRow] }>();

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events.setMaxListeners(100);
  }

  // ---------- Sessões (um token por aparelho) ----------

  findByToken(token: string | undefined): UserRow | undefined {
    if (!token) return undefined;
    const row = this.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, hashToken(token)), eq(users.disabled, false)))
      .get();
    return row?.user;
  }

  /** Abre uma sessão nova e devolve o token (em texto puro só aqui). */
  createSession(userId: string): string {
    const token = randomBytes(24).toString('base64url');
    const now = this.now();
    this.db
      .insert(sessions)
      .values({ tokenHash: hashToken(token), userId, createdAt: now, lastUsedAt: now })
      .run();
    return token;
  }

  touchSession(token: string): void {
    this.db
      .update(sessions)
      .set({ lastUsedAt: this.now() })
      .where(eq(sessions.tokenHash, hashToken(token)))
      .run();
  }

  deleteSession(token: string): void {
    this.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .run();
  }

  /** Sai de todos os aparelhos, menos (opcionalmente) o atual. */
  deleteAllSessions(userId: string, exceptToken?: string): void {
    const where = exceptToken
      ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(exceptToken)))
      : eq(sessions.userId, userId);
    this.db.delete(sessions).where(where).run();
  }

  // ---------- Usuários ----------

  findById(id: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }

  findByUsername(username: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.username, username)).get();
  }

  /** Cria um usuário já com uma sessão aberta. */
  create(input: NewUser | string, figure?: string): { user: UserRow; token: string } {
    // Atalho dos testes: create('Ana', figure).
    const data: NewUser = typeof input === 'string' ? { name: input, figure: figure! } : input;
    const now = this.now();
    const user = this.db
      .insert(users)
      .values({
        id: randomUUID(),
        name: data.name,
        figure: data.figure,
        gender: data.gender ?? 'M',
        username: data.username ?? null,
        passwordHash: data.passwordHash ?? null,
        role: data.role ?? 'member',
        createdAt: now,
        lastSeenAt: now,
      })
      .returning()
      .get();
    return { user, token: this.createSession(user.id) };
  }

  update(id: string, changes: UserChanges): UserRow {
    const user = this.db
      .update(users)
      .set({ ...changes, lastSeenAt: this.now() })
      .where(eq(users.id, id))
      .returning()
      .get();
    this.events.emit('updated', user);
    return user;
  }

  touch(id: string): void {
    this.db.update(users).set({ lastSeenAt: this.now() }).where(eq(users.id, id)).run();
  }

  /** Todas as contas com usuário (as antigas sem usuário ainda aparecem pelo nome). */
  list(): UserRow[] {
    return this.db.select().from(users).orderBy(asc(users.name)).all();
  }

  /** Admins ativos com login (para não deixar o escritório sem nenhum). */
  countAdmins(): number {
    return this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.disabled, false), isNotNull(users.username)))
      .all().length;
  }

  hasAdmin(): boolean {
    return Boolean(
      this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), isNotNull(users.username)))
        .get(),
    );
  }

  // ---------- Cargos ----------

  /** Na primeira vez, cria os cargos padrão (a diretoria). */
  seedCargos(): void {
    if (this.db.select({ id: cargos.id }).from(cargos).get()) return;
    DEFAULT_CARGOS.forEach((c, i) =>
      this.db
        .insert(cargos)
        .values({ ...c, sort: i })
        .run(),
    );
  }

  listCargos(): CargoInfo[] {
    return this.db
      .select({ id: cargos.id, name: cargos.name, color: cargos.color })
      .from(cargos)
      .orderBy(asc(cargos.sort), asc(cargos.id))
      .all();
  }

  createCargo(name: string, color: string): CargoInfo {
    const last = this.db
      .select({ sort: cargos.sort })
      .from(cargos)
      .orderBy(desc(cargos.sort))
      .get();
    return this.db
      .insert(cargos)
      .values({ name, color, sort: (last?.sort ?? -1) + 1 })
      .returning({ id: cargos.id, name: cargos.name, color: cargos.color })
      .get();
  }

  updateCargo(id: number, changes: { name?: string; color?: string }): void {
    this.db.update(cargos).set(changes).where(eq(cargos.id, id)).run();
    this.emitCargoHolders(id);
  }

  /** Apaga o cargo; quem o tinha fica sem cargo. */
  deleteCargo(id: number): void {
    const holders = this.db.select().from(users).where(eq(users.cargoId, id)).all();
    this.db.update(users).set({ cargoId: null }).where(eq(users.cargoId, id)).run();
    this.db.delete(cargos).where(eq(cargos.id, id)).run();
    for (const u of holders) this.events.emit('updated', { ...u, cargoId: null });
  }

  reorderCargos(ids: number[]): void {
    this.db.transaction((tx) => {
      ids.forEach((id, i) => tx.update(cargos).set({ sort: i }).where(eq(cargos.id, id)).run());
    });
  }

  /** Cargo renomeado/recolorido: os avatares de quem o tem mudam na hora. */
  private emitCargoHolders(cargoId: number): void {
    for (const u of this.db.select().from(users).where(eq(users.cargoId, cargoId)).all()) {
      this.events.emit('updated', u);
    }
  }

  cargoOf(user: UserRow): CargoInfo | null {
    if (user.cargoId === null) return null;
    return this.listCargos().find((c) => c.id === user.cargoId) ?? null;
  }

  // ---------- Formatos de resposta ----------

  publicProfile(user: UserRow): PublicProfile {
    const cargo = this.cargoOf(user);
    return {
      name: user.name,
      cargo: cargo?.name ?? '',
      cargoColor: cargo?.color ?? '',
      role: user.role,
      birthday: isBirthdayToday(user.birthday, this.now()),
      canEditRooms: user.role === 'admin' || user.canEditRooms,
      badges: parseShowcase(user.badges).join(','),
    };
  }

  toSession(user: UserRow, token: string): SessionResponse {
    return {
      userId: user.id,
      token,
      username: user.username,
      name: user.name,
      figure: user.figure,
      gender: user.gender,
      role: user.role,
      cargo: this.cargoOf(user),
      bio: user.bio,
      birthday: user.birthday,
      canEditRooms: user.role === 'admin' || user.canEditRooms,
    };
  }
}
