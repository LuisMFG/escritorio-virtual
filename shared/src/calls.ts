import { z } from 'zod';

/**
 * Chamadas por convite (Fase 49): áudio entre pessoas que aceitaram, em qualquer sala. O
 * servidor (canal global) guarda convites e participantes e repassa a sinalização WebRTC; o
 * áudio vai direto entre os navegadores. Vídeo e tela (Fase 50) usam a mesma chamada: cada
 * participante já anuncia `cam` e `screen`.
 */

/** Pessoas por chamada (cada uma se conecta com cada outra). */
export const CALL_MAX_PEOPLE = 6;
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
  /** Cliente → servidor `{ toUserId, data }`; servidor → cliente `{ fromUserId, data }`. */
  Signal: 'call.signal',
  /** Cliente → servidor `CallMedia`: microfone, câmera e tela ligados. */
  Media: 'call.media',
  /** Requisição: servidores ICE (STUN e, se configurado, TURN). */
  Ice: 'call.ice',
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

/** Candidatos ICE por mensagem (no máximo). */
export const CALL_ICE_BATCH_MAX = 20;

/** Sinalização WebRTC repassada pelo servidor (descrição de sessão ou candidato ICE). */
export const callSignalDataSchema = z.union([
  z.object({
    kind: z.literal('sdp'),
    type: z.enum(['offer', 'answer']),
    sdp: z.string().max(20_000),
  }),
  z.object({
    kind: z.literal('ice'),
    // Em lotes: no começo da chamada (com TURN) o navegador acha dezenas de candidatos de uma
    // vez, e um por mensagem estourava o limite de mensagens por segundo do canal global.
    candidates: z
      .array(
        z.object({
          candidate: z.string().max(1_000),
          sdpMid: z.string().max(64).nullable(),
          sdpMLineIndex: z.number().int().min(0).max(64).nullable(),
        }),
      )
      .min(1)
      .max(CALL_ICE_BATCH_MAX),
  }),
]);
export type CallSignalData = z.infer<typeof callSignalDataSchema>;

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
export const callSignalSchema = z.object({ toUserId: userId, data: callSignalDataSchema });
export const callMediaSchema = z.object({
  mic: z.boolean(),
  cam: z.boolean(),
  screen: z.boolean(),
});

/** Quem começa a conexão entre dois participantes (o de id menor), para não haver duas ofertas. */
export function callInitiator(a: string, b: string): string {
  return a < b ? a : b;
}

/** Servidores ICE para o navegador (formato do `RTCIceServer`). */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
