import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/** Cargos da equipe (Diretor, Coordenador de TI…). Só admins atribuem. */
export const cargos = sqliteTable('cargos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  /** Cor da etiqueta (`#rrggbb`). */
  color: text('color').notNull(),
  /** Ordem na lista da equipe (menor primeiro). */
  sort: integer('sort').notNull().default(0),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Nome exibido: livre (só é recusado se alguém online já usa o mesmo). */
  name: text('name').notNull(),
  /** Login (minúsculo, único). Vazio só em contas antigas que ainda não criaram senha. */
  username: text('username').unique(),
  /** `scrypt$N$r$p$sal$hash` (ver `passwords.ts`). */
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['admin', 'member'] })
    .notNull()
    .default('member'),
  cargoId: integer('cargo_id').references(() => cargos.id, { onDelete: 'set null' }),
  bio: text('bio').notNull().default(''),
  /** Aniversário `MM-DD` (sem ano). */
  birthday: text('birthday'),
  /** Conta desativada por um admin: não entra mais (sessões apagadas). */
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  /** Pode criar e editar salas (admins sempre podem). */
  canEditRooms: integer('can_edit_rooms', { mode: 'boolean' }).notNull().default(false),
  /** Emblemas exibidos no cartão (até 3 ids de conquistas, separados por vírgula). */
  badges: text('badges').notNull().default(''),
  /** Efeito escolhido para usar (Fase 34); vazio = nenhum. */
  effect: text('effect').notNull().default(''),
  /** O que aparece quando a pessoa programa: 'hidden' | 'coding' | 'language' | 'project'. */
  codeShare: text('code_share').notNull().default('language'),
  figure: text('figure').notNull(),
  gender: text('gender', { enum: ['M', 'F'] })
    .notNull()
    .default('M'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Um token por aparelho/navegador. Guarda só o SHA-256. */
export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

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
  /** Já recebeu os móveis iniciais? (Para não repor móveis que alguém removeu.) */
  furniSeeded: integer('furni_seeded', { mode: 'boolean' }).notNull().default(false),
  /** Só admins decoram esta sala. */
  decorLocked: integer('decor_locked', { mode: 'boolean' }).notNull().default(false),
  /** Ordem nas listas (salas novas vão para o fim). */
  sort: integer('sort').notNull().default(0),
  /** Som ambiente: 'none' | 'office' | 'cafe' | 'rain'. */
  ambient: text('ambient').notNull().default('none'),
});

/** Configurações editáveis pelo painel Admin (ex.: código de convite). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Registro das ações de administração e moderação. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    /** Ex.: `invite.change`, `user.role`, `chat.delete`. */
    action: text('action').notNull(),
    targetUserId: text('target_user_id').references(() => users.id),
    /** Texto curto legível (PT-BR), ex.: "Cargo: DBA". */
    details: text('details').notNull().default(''),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
);

export const roomFurni = sqliteTable(
  'room_furni',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id),
    /** Classname do catálogo (`furni/manifest.json`). */
    defId: text('def_id').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    z: real('z').notNull(),
    rot: integer('rot').notNull(),
    /** Estado (luz acesa, TV ligada…); 0 = padrão. */
    state: integer('state').notNull().default(0),
    placedBy: text('placed_by').references(() => users.id),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('room_furni_room_id_idx').on(t.roomId)],
);

export const roomDoors = sqliteTable('room_doors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roomId: text('room_id')
    .notNull()
    .references(() => rooms.id),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  targetRoomId: text('target_room_id')
    .notNull()
    .references(() => rooms.id),
  targetX: integer('target_x').notNull(),
  targetY: integer('target_y').notNull(),
  targetDir: integer('target_dir').notNull(),
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
    /** Resposta a outra mensagem da sala (some se a original for apagada). */
    replyToId: integer('reply_to_id').references((): AnySQLiteColumn => chatMessages.id, {
      onDelete: 'set null',
    }),
    /** 'text' | 'dice' | 'coin' | 'game' (resultados sorteados pelo servidor). */
    kind: text('kind').notNull().default('text'),
    /** Anexo (Fase 29). */
    attachmentId: text('attachment_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('chat_messages_room_id_idx').on(t.roomId, t.id)],
);

/** Mensagens privadas (DMs) entre duas pessoas; funcionam entre salas e para quem está offline. */
export const directMessages = sqliteTable(
  'direct_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => users.id),
    text: text('text').notNull(),
    replyToId: integer('reply_to_id').references((): AnySQLiteColumn => directMessages.id, {
      onDelete: 'set null',
    }),
    /** Anexo (Fase 29). */
    attachmentId: text('attachment_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /** Quando quem recebeu abriu a conversa (null = não lida). */
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('dm_to_unread_idx').on(t.toUserId, t.readAt),
    index('dm_pair_idx').on(t.fromUserId, t.toUserId, t.id),
  ],
);

/** Reações (emoji) nas mensagens da sala: uma por pessoa e emoji. */
export const chatReactions = sqliteTable(
  'chat_reactions',
  {
    messageId: integer('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    emoji: text('emoji').notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/** Reações nas mensagens privadas. */
export const dmReactions = sqliteTable(
  'dm_reactions',
  {
    messageId: integer('message_id')
      .notNull()
      .references(() => directMessages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    emoji: text('emoji').notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/** Recados (post-its) dos murais. Somem junto com o móvel. */
export const boardNotes = sqliteTable(
  'board_notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    furniId: text('furni_id')
      .notNull()
      .references(() => roomFurni.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    text: text('text').notNull(),
    /** Cor do papel: 'yellow' | 'pink' | 'blue' | 'green'. */
    color: text('color').notNull().default('yellow'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('board_notes_furni_idx').on(t.furniId)],
);

/** Traços dos quadros brancos (um registro por traço). Somem junto com o móvel. */
export const whiteboardStrokes = sqliteTable(
  'whiteboard_strokes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    furniId: text('furni_id')
      .notNull()
      .references(() => roomFurni.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** JSON do traço (`WbStrokeInput`: pincel, borracha ou texto). */
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('whiteboard_strokes_furni_idx').on(t.furniId, t.id)],
);

/** Reuniões marcadas numa sala. */
export const meetings = sqliteTable(
  'meetings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    durationMin: integer('duration_min').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /** Quando o lembrete (5 min antes) foi enviado; null = ainda não. */
    remindedAt: integer('reminded_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('meetings_starts_idx').on(t.startsAt)],
);

/** Convidados e a resposta de cada um. */
export const meetingAttendees = sqliteTable(
  'meeting_attendees',
  {
    meetingId: integer('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** 'pending' | 'yes' | 'no' */
    response: text('response').notNull().default('pending'),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.userId] })],
);

/** Placar por pessoa e jogo (vitórias, derrotas, empates). */
export const gameScores = sqliteTable(
  'game_scores',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    game: text('game').notNull(),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    draws: integer('draws').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.game] })],
);

/** Pet de cada pessoa (no máximo um). */
export const pets = sqliteTable('pets', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  name: text('name').notNull(),
  /** 'dog' | 'cat' | 'bunny' | 'chick' */
  species: text('species').notNull(),
  color: integer('color').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Conquistas desbloqueadas (as definições ficam em `shared/achievements.ts`). */
export const userAchievements = sqliteTable(
  'user_achievements',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    achievementId: text('achievement_id').notNull(),
    unlockedAt: integer('unlocked_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

/** Contadores para as conquistas (mensagens, móveis, vitórias, dias seguidos…). */
export const userStats = sqliteTable(
  'user_stats',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** Salas que cada pessoa já visitou (conquista Explorador). */
export const userVisits = sqliteTable(
  'user_visits',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roomId] })],
);

/** Tokens pessoais para integrações (extensão do VS Code). Só o SHA-256 fica guardado. */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
);

/** Conta do Spotify ligada (Fase 21). Só o necessário para ler a música atual. */
export const spotifyLinks = sqliteTable('spotify_links', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  refreshToken: text('refresh_token').notNull(),
  accessToken: text('access_token').notNull(),
  /** Epoch ms em que o access token vence. */
  expiresAt: integer('expires_at').notNull(),
  displayName: text('display_name'),
  /** Esconder a música por enquanto, sem desconectar. */
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Conta do Jira Cloud de cada pessoa (Fase 30). O token de API fica criptografado. */
export const jiraLinks = sqliteTable('jira_links', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  email: text('email').notNull(),
  /** Token de API cifrado (AES-256-GCM, chave fora do banco). */
  tokenEnc: text('token_enc').notNull(),
  accountId: text('account_id').notNull(),
  displayName: text('display_name'),
  /** 'hidden' | 'key' | 'title' */
  share: text('share').notNull().default('title'),
  /** Último problema ao consultar (token revogado etc.); com erro, para de consultar. */
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Avisos da diretoria (Fase 24). */
export const announcements = sqliteTable(
  'announcements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    urgent: integer('urgent', { mode: 'boolean' }).notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('announcements_created_idx').on(t.createdAt)],
);

/** Quem já marcou "Li" em cada aviso. */
export const announcementReads = sqliteTable(
  'announcement_reads',
  {
    announcementId: integer('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    readAt: integer('read_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] })],
);

/** Enquetes do chat (Fase 25): ligadas à mensagem (some junto se ela sair do histórico). */
export const polls = sqliteTable('polls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id')
    .notNull()
    .unique()
    .references(() => chatMessages.id, { onDelete: 'cascade' }),
  roomId: text('room_id').notNull(),
  question: text('question').notNull(),
  /** JSON: lista de textos das opções. */
  options: text('options').notNull(),
  anonymous: integer('anonymous', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
});

export const pollVotes = sqliteTable(
  'poll_votes',
  {
    pollId: integer('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    option: integer('option').notNull(),
    votedAt: integer('voted_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.pollId, t.userId] })],
);

/** Elogios entre colegas (Fase 26). */
export const kudos = sqliteTable(
  'kudos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => users.id),
    /** 'help' | 'idea' | 'delivered' | 'partner' */
    type: text('type').notNull(),
    message: text('message').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('kudos_created_idx').on(t.createdAt), index('kudos_to_idx').on(t.toUserId)],
);

/** Arquivos enviados no chat e nas DMs (Fase 29). O conteúdo fica em `data/uploads/<id>`. */
export const uploads = sqliteTable('uploads', {
  /** Aleatório e difícil de adivinhar (também é o nome do arquivo no disco). */
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type DirectMessageRow = typeof directMessages.$inferSelect;
export type CargoRow = typeof cargos.$inferSelect;
export type RoomRow = typeof rooms.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type RoomFurniRow = typeof roomFurni.$inferSelect;
