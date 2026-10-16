import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Nome livre (pode repetir; só é recusado se alguém online já usa o mesmo). */
  name: text('name').notNull(),
  /** SHA-256 do token guardado no navegador; o token em si nunca é salvo. */
  sessionTokenHash: text('session_token_hash').notNull().unique(),
  figure: text('figure').notNull(),
  gender: text('gender', { enum: ['M', 'F'] })
    .notNull()
    .default('M'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
});

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** JSON: linhas do heightmap no formato Habbo. */
  heightmap: text('heightmap', { mode: 'json' }).$type<string[]>().notNull(),
  spawnX: integer('spawn_x').notNull(),
  spawnY: integer('spawn_y').notNull(),
  spawnDir: integer('spawn_dir').notNull(),
  floorColor: text('floor_color').notNull(),
  wallColor: text('wall_color').notNull(),
});

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** Nome na hora da mensagem (a pessoa pode mudar de nome depois). */
    nameSnapshot: text('name_snapshot').notNull(),
    text: text('text').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('chat_messages_room_id_idx').on(t.roomId, t.id)],
);

export type UserRow = typeof users.$inferSelect;
export type RoomRow = typeof rooms.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
