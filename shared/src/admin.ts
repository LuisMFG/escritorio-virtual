import { z } from 'zod';
import { ROLES, type CargoInfo, type TeamMember } from './accounts.js';

// ---------- Pessoas ----------

export const adminUserUpdateSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    disabled: z.boolean().optional(),
    cargoId: z.number().int().positive().nullable().optional(),
    canEditRooms: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para mudar.');
export type AdminUserUpdate = z.input<typeof adminUserUpdateSchema>;

export const KICK_SCOPES = ['room', 'office'] as const;
export type KickScope = (typeof KICK_SCOPES)[number];
export const kickSchema = z.object({ scope: z.enum(KICK_SCOPES) });

/** Pessoa no painel Admin. */
export interface AdminUser extends TeamMember {
  disabled: boolean;
  canEditRooms: boolean;
  /** Está no `ADMIN_USERNAMES`: o papel não muda pelo painel. */
  fixedAdmin: boolean;
}

// ---------- Cargos ----------

const cargoName = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Nome do cargo muito curto.').max(40, 'Nome do cargo muito longo.'));
const cargoColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.');

export const cargoCreateSchema = z.object({ name: cargoName, color: cargoColor });
export const cargoUpdateSchema = z
  .object({ name: cargoName.optional(), color: cargoColor.optional() })
  .refine((v) => v.name !== undefined || v.color !== undefined, 'Nada para mudar.');
export const cargoOrderSchema = z.object({ ids: z.array(z.number().int().positive()).max(100) });

// ---------- Convite e salas ----------

export const inviteSchema = z.object({
  inviteCode: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(4, 'Use pelo menos 4 caracteres.').max(100)),
});

export const roomSettingsSchema = z.object({ decorLocked: z.boolean() });

export interface AdminRoom {
  id: string;
  name: string;
  decorLocked: boolean;
}

export interface AdminOverview {
  inviteCode: string;
  /** Endereço do Jira Cloud (`null` = desligado) e se veio do `.env` (não muda pelo painel). */
  jiraSite: string | null;
  jiraSiteLocked: boolean;
  /** Categorias do catálogo de móveis escondidas (Fase 36). */
  hiddenFurniCategories: string[];
  rooms: AdminRoom[];
  users: AdminUser[];
  cargos: CargoInfo[];
}

/** Resposta de "gerar senha temporária": mostrada uma vez para o admin. */
export interface TempPasswordResponse {
  password: string;
}

// ---------- Registro ----------

export interface AuditEntry {
  id: number;
  /** Epoch ms. */
  at: number;
  actorName: string;
  action: string;
  targetName: string | null;
  details: string;
}

/** Como cada ação aparece no registro. */
export const AUDIT_LABELS: Record<string, string> = {
  'invite.change': 'trocou o código de convite',
  'jira.site': 'mudou o endereço do Jira',
  'user.role': 'mudou o papel de',
  'user.cargo': 'mudou o cargo de',
  'user.disable': 'desativou a conta de',
  'user.enable': 'reativou a conta de',
  'user.password': 'gerou senha temporária para',
  'user.kick': 'tirou',
  'user.rooms': 'mudou a permissão de editar salas de',
  'room.create': 'criou a sala',
  'room.update': 'editou a sala',
  'room.delete': 'excluiu a sala',
  'cargo.create': 'criou o cargo',
  'cargo.update': 'editou o cargo',
  'cargo.delete': 'apagou o cargo',
  'cargo.order': 'reordenou os cargos',
  'room.decor': 'mudou a decoração da sala',
  'chat.delete': 'apagou uma mensagem de',
  'backup.create': 'fez um backup do banco',
  'backup.download': 'baixou o backup',
  'announcement.create': 'publicou o aviso',
  'announcement.delete': 'apagou o aviso',
  'furni.remove': 'tirou um móvel',
  'whiteboard.clear': 'limpou um quadro',
  'whiteboard.restore': 'desfez a limpeza de um quadro',
};

// ---------- Backups (Fase 22) ----------

/** Um arquivo de backup do banco (`GET /api/admin/backups`). */
export interface BackupInfo {
  name: string;
  /** Bytes. */
  size: number;
  /** Epoch ms. */
  createdAt: number;
}

export interface BackupList {
  backups: BackupInfo[];
  /** Quantos ficam guardados (os mais antigos saem). */
  keep: number;
  /** Hora (no fuso do escritório) do backup diário. */
  dailyHour: number;
}

// ---------- Mensagens em tempo real ----------

export const chatDeleteSchema = z.object({ id: z.number().int().positive() });

export interface ChatDeletedMessage {
  id: number;
}

/** Você foi tirado da sala (vai para a Recepção) ou do escritório (volta para a entrada). */
export interface KickedMessage {
  scope: KickScope;
  message: string;
}
