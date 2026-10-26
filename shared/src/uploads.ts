/** Anexos no chat e nas DMs, prévia de links e busca (Fase 29). */

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Quanto cada pessoa pode ter guardado em anexos, somando tudo. */
export const UPLOAD_QUOTA_BYTES = 500 * 1024 * 1024;

/** Tipos aceitos: tipo MIME → extensões e se é imagem (mostrada com miniatura). */
export const UPLOAD_TYPES: Record<string, { ext: string[]; image?: boolean }> = {
  'image/png': { ext: ['png'], image: true },
  'image/jpeg': { ext: ['jpg', 'jpeg'], image: true },
  'image/gif': { ext: ['gif'], image: true },
  'image/webp': { ext: ['webp'], image: true },
  'application/pdf': { ext: ['pdf'] },
  'text/plain': { ext: ['txt', 'log', 'md'] },
  'text/csv': { ext: ['csv'] },
  'application/zip': { ext: ['zip'] },
  'application/msword': { ext: ['doc'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'] },
  'application/vnd.ms-excel': { ext: ['xls'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'] },
  'application/vnd.ms-powerpoint': { ext: ['ppt'] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: ['pptx'] },
  'application/vnd.oasis.opendocument.text': { ext: ['odt'] },
  'application/vnd.oasis.opendocument.spreadsheet': { ext: ['ods'] },
};

/** Tipo pelo nome do arquivo (o navegador às vezes manda vazio ou genérico). */
export function mimeFromName(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const [mime, info] of Object.entries(UPLOAD_TYPES)) if (info.ext.includes(ext)) return mime;
  return null;
}

/** Nome seguro para guardar e mostrar (sem caminho, sem caracteres de controle). */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|]/g, '').trim();
  return (clean || 'arquivo').slice(0, 120);
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  image: boolean;
}

/** "230 KB", "1,4 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// ---------- Links ----------

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** URLs (http/https) dentro de um texto, na ordem, sem repetir. */
export function findUrls(text: string): string[] {
  return [...new Set(text.match(URL_RE) ?? [])];
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  site: string;
}

// ---------- Busca ----------

export const SEARCH_MIN = 2;
export const SEARCH_LIMIT = 50;

export interface SearchHit {
  kind: 'room' | 'dm';
  id: number;
  /** Sala (kind `room`) ou a outra pessoa da conversa (kind `dm`). */
  where: string;
  whereName: string;
  name: string;
  text: string;
  ts: number;
}
