import { z } from 'zod';

/**
 * Chamadas por convite (Fase 49): áudio entre pessoas que aceitaram, em qualquer sala. O
 * servidor (canal global) guarda convites e participantes; o áudio e o vídeo passam por um
 * servidor de mídia (LiveKit), que entrega a cada um a qualidade que cabe na conexão dele.
 * Vídeo e tela (Fase 50) usam a mesma chamada: cada participante anuncia `cam` e `screen`.
 */

/** Pessoas por chamada (o servidor de mídia aguenta bem mais; o limite é o painel). */
export const CALL_MAX_PEOPLE = 12;
/** Convite sem resposta expira em (ms). */
export const CALL_INVITE_MS = 45_000;
export const CALL_REASON_MAX = 80;
/** Sugestões de motivo na caixa de convite. */
export const CALL_REASONS = ['Dúvida rápida', 'Alinhar uma tarefa', 'Revisar código', 'Café?'];

export const CallMessage = {
  /** Cliente → servidor `{ toUserId, reason }` (chama para a chamada atual, se houver). */
  Invite: 'call.invite',
  /** Cliente → servidor `{ inviteId, accept }`. */
  Answer: 'call.answer',
  /** Cliente → servidor: sair da chamada. */
  Leave: 'call.leave',
  /** Cliente → servidor `CallMedia`: microfone, câmera e tela ligados. */
  Media: 'call.media',
  /** Requisição: credencial da sala de mídia da minha chamada (`CallToken`, ou `null`). */
  Token: 'call.token',
  /** Servidor → cliente `CallInvite`: alguém está chamando você. */
  Invited: 'call.invited',
  /** Servidor → cliente `{ inviteId }`: o convite não vale mais (cancelado/expirou/atendido). */
  InviteGone: 'call.inviteGone',
  /** Servidor → quem chamou `CallInviteResult`. */
  InviteResult: 'call.inviteResult',
  /** Servidor → participantes `CallView | null` (null = você não está mais em chamada). */
  State: 'call.state',
} as const;

export type CallInviteOutcome =
  'sent' | 'accepted' | 'declined' | 'expired' | 'busy' | 'offline' | 'full';

export interface CallInvite {
  id: string;
  /** Chamada a que o convite leva (já existe quando é "adicionar à chamada"). */
  callId: string | null;
  fromUserId: string;
  fromName: string;
  reason: string;
  /** Quem já está na conversa (nomes). */
  members: string[];
  expiresAt: number;
  /** Quem recebe está em Foco/Ocupado: avisa sem som. */
  quiet: boolean;
}

export interface CallInviteResult {
  inviteId: string;
  toUserId: string;
  toName: string;
  outcome: CallInviteOutcome;
}

export interface CallMedia {
  mic: boolean;
  cam: boolean;
  screen: boolean;
}

export interface CallMember extends CallMedia {
  userId: string;
  name: string;
  /** Visual do avatar (para o rosto no lugar da câmera desligada). */
  figure: string;
}

export interface CallView {
  id: string;
  startedAt: number;
  members: CallMember[];
}

/** O que cada aba recebe: a chamada e se é esta aba que fala (com duas abas, só uma conecta). */
export interface CallState extends CallView {
  here: boolean;
}

const userId = z.string().min(1).max(64);
export const callInviteSchema = z.object({
  toUserId: userId,
  reason: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(CALL_REASON_MAX)),
});
export const callAnswerSchema = z.object({
  inviteId: z.string().min(1).max(64),
  accept: z.boolean(),
});
export const callMediaSchema = z.object({
  mic: z.boolean(),
  cam: z.boolean(),
  screen: z.boolean(),
});

/** Servidores ICE para o navegador (formato do `RTCIceServer`). */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Entrada na sala de mídia (LiveKit) da chamada: o endereço do servidor de mídia (absoluto ou um
 * caminho neste site), a credencial assinada (vale só para esta chamada e esta pessoa) e os
 * servidores ICE extras (TURN da Cloudflare, para redes que bloqueiam UDP).
 */
export interface CallToken {
  url: string;
  token: string;
  iceServers: IceServer[];
}
