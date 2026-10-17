import { z } from 'zod';

/**
 * Atividade fora do escritório (VS Code; Spotify na Fase 21), mostrada no cartão do avatar e
 * na lista de pessoas.
 */

/** Sem sinal por este tempo, a atividade some. */
export const ACTIVITY_TTL_MS = 3 * 60_000;

/** O que a pessoa deixa aparecer de quando está programando. */
export const CODE_SHARE = ['hidden', 'coding', 'language', 'project'] as const;
export type CodeShare = (typeof CODE_SHARE)[number];

export const CODE_SHARE_LABELS: Record<CodeShare, string> = {
  hidden: 'Não mostrar',
  coding: 'Só “Codando”',
  language: 'Linguagem',
  project: 'Linguagem e projeto',
};

export const codeShareSchema = z.object({ codeShare: z.enum(CODE_SHARE) });

/** Editores com extensão (VS Code e Visual Studio). */
export const EDITORS = ['vscode', 'visualstudio'] as const;
export type Editor = (typeof EDITORS)[number];
export const EDITOR_NAMES: Record<Editor, string> = {
  vscode: 'VS Code',
  visualstudio: 'Visual Studio',
};

/** Sinal das extensões dos editores. */
export const editorHeartbeatSchema = z.object({
  editor: z.enum(EDITORS).default('vscode'),
  /** `active` = mexendo no código agora; `idle`/`closed` = tira a atividade. */
  state: z.enum(['active', 'idle', 'closed']),
  /** Linguagem: `languageId` do VS Code (ex.: `typescript`) ou do Visual Studio (ex.: `CSharp`). */
  language: z
    .string()
    .max(40)
    .regex(/^[\w.+#/ -]*$/)
    .optional(),
  /** Nome da pasta do projeto aberto. */
  project: z.string().max(60).optional(),
});
export type EditorHeartbeat = z.input<typeof editorHeartbeatSchema>;

const LANGUAGE_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript',
  javascript: 'JavaScript',
  javascriptreact: 'JavaScript',
  python: 'Python',
  java: 'Java',
  csharp: 'C#',
  php: 'PHP',
  sql: 'SQL',
  plsql: 'PL/SQL',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  json: 'JSON',
  jsonc: 'JSON',
  markdown: 'Markdown',
  yaml: 'YAML',
  shellscript: 'Shell',
  powershell: 'PowerShell',
  go: 'Go',
  rust: 'Rust',
  ruby: 'Ruby',
  kotlin: 'Kotlin',
  dart: 'Dart',
  vue: 'Vue',
  svelte: 'Svelte',
  dockerfile: 'Docker',
  xml: 'XML',
  c: 'C',
  cpp: 'C++',
  // Nomes de "content type" do Visual Studio.
  'c/c++': 'C++',
  basic: 'VB.NET',
  fsharp: 'F#',
  razor: 'Razor',
  xaml: 'XAML',
  'typescript-vs': 'TypeScript',
};

/** `typescriptreact` → `TypeScript`; desconhecida vira a própria id. */
export function languageName(id: string | undefined): string {
  if (!id) return '';
  return LANGUAGE_NAMES[id] ?? LANGUAGE_NAMES[id.toLowerCase()] ?? id;
}

export interface CodingActivity {
  editor?: Editor;
  language?: string;
  project?: string;
}

/** Texto do cartão conforme a privacidade escolhida (`''` = nada a mostrar). */
export function codingText(a: CodingActivity, share: CodeShare): string {
  if (share === 'hidden') return '';
  const lang = languageName(a.language);
  if (share === 'coding') return '💻 Codando';
  const where = ` no ${EDITOR_NAMES[a.editor ?? 'vscode']}`;
  const base = lang ? `💻 Codando em ${lang}${where}` : `💻 Codando${where}`;
  return share === 'project' && a.project ? `${base} · ${a.project}` : base;
}

// ---------- Spotify ----------

export interface NowPlaying {
  track: string;
  artists: string;
  /** Link da música no Spotify. */
  url: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "🎵 Música – Artista" (cortado para caber no cartão). */
export function musicText(m: NowPlaying): string {
  return `🎵 ${clip(m.track, 40)} – ${clip(m.artists, 30)}`;
}

export const spotifySettingsSchema = z.object({ hidden: z.boolean() });

/** `GET /api/spotify/status`. */
export interface SpotifyStatus {
  /** O escritório tem um app do Spotify configurado. */
  configured: boolean;
  linked: boolean;
  /** Conectado, mas escondendo a música por enquanto. */
  hidden: boolean;
  displayName: string | null;
}

// ---------- Tokens pessoais ----------

export const API_TOKEN_MAX = 5;

export const apiTokenCreateSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Dê um nome ao token (ex.: “VS Code do trabalho”).').max(40)),
});

export interface ApiTokenInfo {
  id: number;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Resposta da criação: o token aparece só esta vez. */
export interface ApiTokenCreated extends ApiTokenInfo {
  token: string;
}

/** `GET /api/activity/settings`. */
export interface ActivitySettings {
  codeShare: CodeShare;
  tokens: ApiTokenInfo[];
}
