import { z } from 'zod';
import { nameKey } from './protocol.js';

// ---------- Comandos rápidos do chat ----------

/** Tipo da mensagem de chat: texto comum ou resultado gerado pelo servidor. */
export const CHAT_KINDS = ['text', 'dice', 'coin', 'game', 'poll'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export type QuickCommand = 'dice' | 'coin';

/** `/dado` ou `/moeda` (sem diferenciar maiúsculas e acentos); `null` se não for um deles. */
export function parseQuickCommand(text: string): QuickCommand | null {
  const m = /^\s*\/(\S+)\s*$/.exec(text);
  if (!m) return null;
  const cmd = nameKey(m[1]!);
  if (cmd === 'dado') return 'dice';
  if (cmd === 'moeda') return 'coin';
  return null;
}

/** Texto que aparece no chat (e no balão) com o resultado sorteado. */
export function quickCommandText(cmd: QuickCommand, roll: number): string {
  return cmd === 'dice'
    ? `🎲 tirou ${roll} no dado`
    : `🪙 jogou a moeda: deu ${roll === 0 ? 'cara' : 'coroa'}`;
}

// ---------- Jogo da velha ----------

export type TttMark = 'X' | 'O';
/** Tabuleiro vazio: 9 casas, `.` = livre, linha a linha de cima para baixo. */
export const TTT_EMPTY = '.........';

export const TTT_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** Quem fechou uma linha (e qual), ou `null`. */
export function tttWinner(board: string): { mark: TttMark; line: readonly number[] } | null {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    const m = board[a];
    if ((m === 'X' || m === 'O') && board[b] === m && board[c] === m) return { mark: m, line };
  }
  return null;
}

/** Sem casas livres. */
export function tttFull(board: string): boolean {
  return !board.includes('.');
}

export function otherMark(mark: TttMark): TttMark {
  return mark === 'X' ? 'O' : 'X';
}

const furniId = z.string().min(1).max(40);
export const tttRefSchema = z.object({ furniId });
export const tttMoveSchema = z.object({ furniId, cell: z.number().int().min(0).max(8) });
export type TttMove = z.infer<typeof tttMoveSchema>;

/** Placar de uma pessoa num jogo. */
export interface GameScore {
  userId: string;
  name: string;
  wins: number;
  losses: number;
  draws: number;
}

/** Resposta de `ttt.scores`: os melhores e o placar de quem está na mesa. */
export interface TttScores {
  top: GameScore[];
  players: GameScore[];
}

export const TTT_GAME = 'tictactoe';
export const TTT_TOP = 5;
