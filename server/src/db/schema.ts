import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export type UserRow = typeof users.$inferSelect;
export type RoomRow = typeof rooms.$inferSelect;
