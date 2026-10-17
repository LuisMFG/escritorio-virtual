import { z } from 'zod';
import { nameKey, normalizeName } from './protocol.js';

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

export const petSchema = z.object({
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
  species: z.enum(PET_SPECIES),
  color: z
    .number()
    .int()
    .min(0)
    .max(PET_COLOR_COUNT - 1),
});
export type PetInput = z.input<typeof petSchema>;

/** Pet de uma pessoa (`GET /api/pets/me`). */
export interface PetInfo {
  name: string;
  species: PetSpecies;
  color: number;
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
