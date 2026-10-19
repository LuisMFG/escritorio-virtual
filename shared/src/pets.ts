import { z } from 'zod';
import { nameKey, normalizeName } from './protocol.js';
import { HABBO_PET_NAMES, HABBO_PET_PREFIX } from './habboPets.js';

/** Espécies de pet (arte própria desenhada por código no cliente). */
export const PET_SPECIES = ['dog', 'cat', 'bunny', 'chick'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export const PET_SPECIES_LABELS: Record<PetSpecies, string> = {
  dog: 'Cachorro',
  cat: 'Gato',
  bunny: 'Coelho',
  chick: 'Pintinho',
};

/** Cada espécie tem 3 pelagens (as cores ficam na arte do cliente). */
export const PET_COLOR_COUNT = 3;

export const PET_NAME_MIN = 2;
export const PET_NAME_MAX = 16;

export const petSchema = z
  .object({
    name: z
      .string()
      .transform(normalizeName)
      .pipe(
        z
          .string()
          .min(PET_NAME_MIN, `O nome do pet precisa ter pelo menos ${PET_NAME_MIN} letras.`)
          .max(PET_NAME_MAX, `O nome do pet pode ter no máximo ${PET_NAME_MAX} letras.`)
          .regex(/^[\p{L}\p{N} ._'-]+$/u, 'Use só letras, números e espaço no nome do pet.'),
      ),
    /** Arte própria (`dog`…) ou pet do Habbo (`hh:dog`, Fase 38). */
    species: z.string().refine(isPetSpecies, 'Espécie de pet desconhecida.'),
    /** Pelagem: 0–2 na arte própria; nos do Habbo, a paleta. */
    color: z.number().int().min(0).max(99),
    /** Pets do Habbo: cor que tinge a paleta (hex sem `#`). */
    tint: z
      .string()
      .regex(/^[0-9a-f]{6}$/i)
      .transform((t) => t.toLowerCase())
      .default('ffffff'),
  })
  .refine((p) => p.species.startsWith(HABBO_PET_PREFIX) || p.color < PET_COLOR_COUNT, {
    message: 'Pelagem inválida.',
    path: ['color'],
  });
export type PetInput = z.input<typeof petSchema>;

/** Espécie válida: uma da arte própria ou `hh:` + um tipo do Habbo. */
export function isPetSpecies(s: string): boolean {
  if ((PET_SPECIES as readonly string[]).includes(s)) return true;
  return s.startsWith(HABBO_PET_PREFIX) && s.slice(HABBO_PET_PREFIX.length) in HABBO_PET_NAMES;
}

/** Pet de uma pessoa (`GET /api/pets/me`). */
export interface PetInfo {
  name: string;
  /** `PetSpecies` (arte própria) ou `hh:{tipo}` (pet do Habbo). */
  species: string;
  color: number;
  tint: string;
}

// ---------- Comandos no chat ----------

export type PetCommand = 'sit' | 'lie' | 'come';

/** `/senta`, `/deita`, `/vem` (sem diferenciar maiúsculas e acentos). */
export function parsePetCommand(text: string): PetCommand | null {
  const m = /^\s*\/(\S+)\s*$/.exec(text);
  if (!m) return null;
  const cmd = nameKey(m[1]!);
  if (cmd === 'senta' || cmd === 'sentar') return 'sit';
  if (cmd === 'deita' || cmd === 'deitar') return 'lie';
  if (cmd === 'vem' || cmd === 'aqui') return 'come';
  return null;
}

/** O que o dono "fala" no chat ao dar o comando. */
export function petCommandText(cmd: PetCommand, petName: string): string {
  if (cmd === 'sit') return `${petName}, senta!`;
  if (cmd === 'lie') return `${petName}, deita!`;
  return `${petName}, vem cá!`;
}
