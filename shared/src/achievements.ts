import { z } from 'zod';

/** Contadores que o servidor guarda por pessoa (`user_stats`). */
export const ACHIEVEMENT_STATS = [
  'chat',
  'furni',
  'reactions',
  'tttWins',
  'arcadeWins',
  'poolWins',
  'pingpongWins',
  'meetings',
  'streak',
  'rooms',
  'kudosGiven',
  'kudosReceived',
] as const;
export type AchievementStat = (typeof ACHIEVEMENT_STATS)[number];

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Emblema do Habbo (Fase 39): código na CDN (`ACH_RoomEntry1`…). */
  badge: string;
  /** Reserva sem internet: emoji sobre um círculo colorido (arte própria). */
  emoji: string;
  color: string;
  /** Conquista por contador: desbloqueia quando `stat` chega em `goal`. */
  stat?: AchievementStat;
  goal?: number;
}

/**
 * Conquistas do escritório. As de contador desbloqueiam sozinhas ao atingir a meta; as outras
 * o servidor dá no momento da ação. A ordem é a de exibição.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first_message',
    badge: 'ACH_GuideChatReviewer1',
    name: 'Primeira palavra',
    description: 'Mandou a primeira mensagem no chat.',
    emoji: '💬',
    color: '#60a5fa',
    stat: 'chat',
    goal: 1,
  },
  {
    id: 'chatter',
    badge: 'ACH_GuideChatReviewer5',
    name: 'Tagarela',
    description: 'Mandou 100 mensagens no chat.',
    emoji: '📣',
    color: '#3b82f6',
    stat: 'chat',
    goal: 100,
  },
  {
    id: 'first_dm',
    badge: 'ACH_EmailVerification1',
    name: 'Correio',
    description: 'Mandou a primeira mensagem privada.',
    emoji: '✉️',
    color: '#a78bfa',
  },
  {
    id: 'reactions',
    badge: 'ACH_AvatarTags1',
    name: 'Expressivo',
    description: 'Reagiu a 10 mensagens.',
    emoji: '😄',
    color: '#fbbf24',
    stat: 'reactions',
    goal: 10,
  },
  {
    id: 'first_furni',
    badge: 'ACH_AllTimeHotelPresence1',
    name: 'Decorador',
    description: 'Colocou o primeiro móvel.',
    emoji: '🪑',
    color: '#34d399',
    stat: 'furni',
    goal: 1,
  },
  {
    id: 'architect',
    badge: 'ACH_GiftGiver1',
    name: 'Arquiteto de interiores',
    description: 'Colocou 25 móveis.',
    emoji: '🛋️',
    color: '#10b981',
    stat: 'furni',
    goal: 25,
  },
  {
    id: 'explorer',
    badge: 'ACH_RoomEntry1',
    name: 'Explorador',
    description: 'Visitou todas as salas do escritório.',
    emoji: '🧭',
    color: '#f97316',
  },
  {
    id: 'streak',
    badge: 'ACH_Login5',
    name: 'Assíduo',
    description: 'Entrou 7 dias seguidos.',
    emoji: '📅',
    color: '#ef4444',
    stat: 'streak',
    goal: 7,
  },
  {
    id: 'coffee',
    badge: 'ACH_HappyHour1',
    name: 'Cafezinho',
    description: 'Tomou um café na máquina.',
    emoji: '☕',
    color: '#a16207',
  },
  {
    id: 'board_note',
    badge: 'ACH_Motto1',
    name: 'Recado dado',
    description: 'Pregou um recado no mural.',
    emoji: '📌',
    color: '#f43f5e',
  },
  {
    id: 'artist',
    badge: 'ACH_AvatarLooks1',
    name: 'Artista',
    description: 'Desenhou no quadro branco.',
    emoji: '🎨',
    color: '#ec4899',
  },
  {
    id: 'organizer',
    badge: 'ACH_Name1',
    name: 'Organizador',
    description: 'Marcou a primeira reunião.',
    emoji: '🗓️',
    color: '#0ea5e9',
  },
  {
    id: 'meetings',
    badge: 'ACH_TraderPass1',
    name: 'Sempre presente',
    description: 'Confirmou presença em 5 reuniões que aconteceram.',
    emoji: '🤝',
    color: '#14b8a6',
    stat: 'meetings',
    goal: 5,
  },
  {
    id: 'ttt_win',
    badge: 'ACH_BattleBallTilesLocked1',
    name: 'Primeira vitória',
    description: 'Ganhou uma partida de jogo da velha.',
    emoji: '🏆',
    color: '#eab308',
    stat: 'tttWins',
    goal: 1,
  },
  {
    id: 'ttt_master',
    badge: 'ACH_GamePlayerExperience5',
    name: 'Mestre da velha',
    description: 'Ganhou 5 partidas de jogo da velha.',
    emoji: '👑',
    color: '#ca8a04',
    stat: 'tttWins',
    goal: 5,
  },
  {
    id: 'arcade_first',
    badge: 'ACH_GamePlayerExperience1',
    name: 'Estreia no Salão',
    description: 'Ganhou a primeira partida no Salão de Jogos.',
    emoji: '🎮',
    color: '#22c55e',
    stat: 'arcadeWins',
    goal: 1,
  },
  {
    id: 'pool_master',
    badge: 'ACH_BattleBallWinner5',
    name: 'Mestre da Sinuca',
    description: 'Ganhou 10 partidas de sinuca.',
    emoji: '🎱',
    color: '#0f766e',
    stat: 'poolWins',
    goal: 10,
  },
  {
    id: 'pingpong_king',
    badge: 'ACH_FootballGoalScored5',
    name: 'Rei do Ping-pong',
    description: 'Ganhou 10 partidas de ping-pong.',
    emoji: '🏓',
    color: '#ea580c',
    stat: 'pingpongWins',
    goal: 10,
  },
  {
    id: 'unbeatable',
    badge: 'ACH_SnowWarTotalScore5',
    name: 'Imbatível',
    description: 'Ganhou 5 partidas seguidas do mesmo jogo no Salão de Jogos.',
    emoji: '🔥',
    color: '#dc2626',
  },
  {
    id: 'lucky',
    badge: 'ACH_GamePlayed5',
    name: 'Sorte grande',
    description: 'Tirou 6 no /dado.',
    emoji: '🎲',
    color: '#8b5cf6',
  },
  {
    id: 'pet_owner',
    badge: 'ACH_PetLover1',
    name: 'Melhor amigo',
    description: 'Adotou um pet.',
    emoji: '🐾',
    color: '#d97706',
  },
  {
    id: 'recognizer',
    badge: 'ACH_RespectGiven1',
    name: 'Reconhece os colegas',
    description: 'Elogiou 5 vezes alguém da equipe.',
    emoji: '👏',
    color: '#f472b6',
    stat: 'kudosGiven',
    goal: 5,
  },
  {
    id: 'beloved',
    badge: 'ACH_RespectEarned1',
    name: 'Querido pela equipe',
    description: 'Recebeu 5 elogios.',
    emoji: '💖',
    color: '#e11d48',
    stat: 'kudosReceived',
    goal: 5,
  },
];

export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);
export type AchievementId = string;

export function findAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Quantos emblemas a pessoa exibe no cartão. */
export const SHOWCASE_MAX = 3;

export const showcaseSchema = z.object({
  ids: z
    .array(z.string().max(40))
    .max(SHOWCASE_MAX, `Escolha no máximo ${SHOWCASE_MAX} emblemas.`)
    .refine((ids) => new Set(ids).size === ids.length, 'Emblema repetido.'),
});

/** `badges` do estado/perfil: ids separados por vírgula → lista válida. */
export function parseShowcase(badges: string | null | undefined): string[] {
  return (badges ?? '')
    .split(',')
    .filter((id) => ACHIEVEMENT_IDS.includes(id))
    .slice(0, SHOWCASE_MAX);
}

/** `GET /api/achievements/me`. */
export interface AchievementsResponse {
  unlocked: { id: string; at: number }[];
  stats: Partial<Record<AchievementStat, number>>;
  showcase: string[];
}

/** Lobby → pessoa: conquista nova. */
export const AchievementMessage = { Unlocked: 'achievement.unlocked' } as const;
export interface AchievementUnlocked {
  id: string;
}

/** Imagem do emblema do Habbo pelo proxy do servidor (só os das conquistas). */
export function badgeImageUrl(code: string): string {
  return `/hh/badge/${encodeURIComponent(code)}.gif`;
}
