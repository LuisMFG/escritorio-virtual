import { z } from 'zod';

/** Contadores que o servidor guarda por pessoa (`user_stats`). */
export const ACHIEVEMENT_STATS = [
  'chat',
  'furni',
  'reactions',
  'tttWins',
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
  /** Desenho do emblema (emoji sobre um círculo colorido; arte própria). */
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
    name: 'Primeira palavra',
    description: 'Mandou a primeira mensagem no chat.',
    emoji: '💬',
    color: '#60a5fa',
    stat: 'chat',
    goal: 1,
  },
  {
    id: 'chatter',
    name: 'Tagarela',
    description: 'Mandou 100 mensagens no chat.',
    emoji: '📣',
    color: '#3b82f6',
    stat: 'chat',
    goal: 100,
  },
  {
    id: 'first_dm',
    name: 'Correio',
    description: 'Mandou a primeira mensagem privada.',
    emoji: '✉️',
    color: '#a78bfa',
  },
  {
    id: 'reactions',
    name: 'Expressivo',
    description: 'Reagiu a 10 mensagens.',
    emoji: '😄',
    color: '#fbbf24',
    stat: 'reactions',
    goal: 10,
  },
  {
    id: 'first_furni',
    name: 'Decorador',
    description: 'Colocou o primeiro móvel.',
    emoji: '🪑',
    color: '#34d399',
    stat: 'furni',
    goal: 1,
  },
  {
    id: 'architect',
    name: 'Arquiteto de interiores',
    description: 'Colocou 25 móveis.',
    emoji: '🛋️',
    color: '#10b981',
    stat: 'furni',
    goal: 25,
  },
  {
    id: 'explorer',
    name: 'Explorador',
    description: 'Visitou todas as salas do escritório.',
    emoji: '🧭',
    color: '#f97316',
  },
  {
    id: 'streak',
    name: 'Assíduo',
    description: 'Entrou 7 dias seguidos.',
    emoji: '📅',
    color: '#ef4444',
    stat: 'streak',
    goal: 7,
  },
  {
    id: 'coffee',
    name: 'Cafezinho',
    description: 'Tomou um café na máquina.',
    emoji: '☕',
    color: '#a16207',
  },
  {
    id: 'board_note',
    name: 'Recado dado',
    description: 'Pregou um recado no mural.',
    emoji: '📌',
    color: '#f43f5e',
  },
  {
    id: 'artist',
    name: 'Artista',
    description: 'Desenhou no quadro branco.',
    emoji: '🎨',
    color: '#ec4899',
  },
  {
    id: 'organizer',
    name: 'Organizador',
    description: 'Marcou a primeira reunião.',
    emoji: '🗓️',
    color: '#0ea5e9',
  },
  {
    id: 'meetings',
    name: 'Sempre presente',
    description: 'Confirmou presença em 5 reuniões que aconteceram.',
    emoji: '🤝',
    color: '#14b8a6',
    stat: 'meetings',
    goal: 5,
  },
  {
    id: 'ttt_win',
    name: 'Primeira vitória',
    description: 'Ganhou uma partida de jogo da velha.',
    emoji: '🏆',
    color: '#eab308',
    stat: 'tttWins',
    goal: 1,
  },
  {
    id: 'ttt_master',
    name: 'Mestre da velha',
    description: 'Ganhou 5 partidas de jogo da velha.',
    emoji: '👑',
    color: '#ca8a04',
    stat: 'tttWins',
    goal: 5,
  },
  {
    id: 'lucky',
    name: 'Sorte grande',
    description: 'Tirou 6 no /dado.',
    emoji: '🎲',
    color: '#8b5cf6',
  },
  {
    id: 'pet_owner',
    name: 'Melhor amigo',
    description: 'Adotou um pet.',
    emoji: '🐾',
    color: '#d97706',
  },
  {
    id: 'recognizer',
    name: 'Reconhece os colegas',
    description: 'Elogiou 5 vezes alguém da equipe.',
    emoji: '👏',
    color: '#f472b6',
    stat: 'kudosGiven',
    goal: 5,
  },
  {
    id: 'beloved',
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
