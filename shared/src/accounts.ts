import { z } from 'zod';
import { genderSchema, type Gender } from './manifests.js';
import { figureSchema, nameSchema } from './protocol.js';

// ---------- Usuário e senha ----------

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const BIO_MAX = 160;

/** Login sempre minúsculo e sem espaços nas pontas. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .min(USERNAME_MIN, `O usuário precisa ter pelo menos ${USERNAME_MIN} caracteres.`)
      .max(USERNAME_MAX, `O usuário pode ter no máximo ${USERNAME_MAX} caracteres.`)
      .regex(/^[a-z0-9._-]+$/, 'No usuário, use só letras sem acento, números, ponto, hífen ou _.'),
  );

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`)
  .max(PASSWORD_MAX, `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`);

export const registerSchema = z.object({
  inviteCode: z.string().max(100),
  username: usernameSchema,
  password: passwordSchema,
  name: nameSchema,
  figure: figureSchema.optional(),
  gender: genderSchema.optional(),
});
export type RegisterRequest = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  username: z.string().max(100).transform(normalizeUsername),
  password: z.string().max(PASSWORD_MAX),
});
export type LoginRequest = z.input<typeof loginSchema>;

/** Conta antiga (só token do navegador) escolhendo usuário e senha. */
export const claimSchema = z.object({ username: usernameSchema, password: passwordSchema });
export type ClaimRequest = z.input<typeof claimSchema>;

export const passwordChangeSchema = z.object({
  current: z.string().max(PASSWORD_MAX),
  next: passwordSchema,
});
export type PasswordChangeRequest = z.input<typeof passwordChangeSchema>;

export const logoutSchema = z.object({ all: z.boolean().optional() });

// ---------- Perfil ----------

/** `MM-DD` válido (29/02 aceito). */
export const birthdaySchema = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Aniversário inválido.')
  .refine((v) => {
    const [m, d] = v.split('-').map(Number) as [number, number];
    return d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  }, 'Esse dia não existe nesse mês.');

export const profileUpdateSchema = z.object({
  name: nameSchema.optional(),
  bio: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(BIO_MAX, `A bio pode ter no máximo ${BIO_MAX} caracteres.`))
    .optional(),
  birthday: birthdaySchema.nullable().optional(),
});
export type ProfileUpdate = z.input<typeof profileUpdateSchema>;

export const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export interface CargoInfo {
  id: number;
  name: string;
  /** `#rrggbb` */
  color: string;
}

/** Cargos criados na primeira vez que o banco sobe (o admin edita depois). */
export const DEFAULT_CARGOS: readonly Omit<CargoInfo, 'id'>[] = [
  { name: 'Diretor', color: '#a78bfa' },
  { name: 'Coordenador de TI', color: '#60a5fa' },
  { name: 'Coordenador de Transparência Ativa', color: '#34d399' },
  { name: 'Coordenador de Transparência Passiva', color: '#2dd4bf' },
  { name: 'Desenvolvedor', color: '#fbbf24' },
  { name: 'DBA', color: '#f87171' },
];

export const cargoAssignSchema = z.object({ cargoId: z.number().int().positive().nullable() });

/** Resposta de entrada, cadastro e `GET /api/me`. */
export interface SessionResponse {
  userId: string;
  token: string;
  /** `null` em conta antiga que ainda precisa escolher usuário e senha. */
  username: string | null;
  name: string;
  figure: string;
  gender: Gender;
  role: Role;
  cargo: CargoInfo | null;
  bio: string;
  birthday: string | null;
  /** Pode criar e editar salas (admins sempre). */
  canEditRooms: boolean;
}

/** Uma pessoa na aba Equipe. */
export interface TeamMember {
  userId: string;
  username: string | null;
  name: string;
  figure: string;
  role: Role;
  cargo: CargoInfo | null;
  bio: string;
  birthday: string | null;
  /** Epoch ms. */
  lastSeenAt: number;
  /** Sala onde está agora (`null` = offline). */
  roomId: string | null;
}

export interface TeamResponse {
  members: TeamMember[];
  cargos: CargoInfo[];
}

// ---------- Datas ----------

/** Fuso usado para "aniversário de hoje" (o escritório é em Brasília). */
export const OFFICE_TIME_ZONE = 'America/Sao_Paulo';

/** `MM-DD` de uma data no fuso do escritório. */
export function monthDay(date: Date, timeZone = OFFICE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.month}-${parts.day}`;
}

/** `AAAA-MM-DD` de uma data no fuso do escritório (o "hoje" de quem está em Brasília). */
export function officeDate(date: Date, timeZone = OFFICE_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isBirthdayToday(birthday: string | null | undefined, now = new Date()): boolean {
  return Boolean(birthday) && birthday === monthDay(now);
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `03-15` → `15 de mar`. */
export function formatBirthday(birthday: string): string {
  const [m, d] = birthday.split('-').map(Number) as [number, number];
  return `${d} de ${MONTHS[m - 1]}`;
}

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", "em 12/03/2026". */
export function formatLastSeen(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return `em ${new Date(ts).toLocaleDateString('pt-BR', { timeZone: OFFICE_TIME_ZONE })}`;
}
