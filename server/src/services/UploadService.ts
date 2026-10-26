import {
  UPLOAD_MAX_BYTES,
  UPLOAD_QUOTA_BYTES,
  UPLOAD_TYPES,
  cleanFileName,
  mimeFromName,
  type Attachment,
} from '@office/shared';
import { and, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/client.js';
import { chatMessages, directMessages, uploads } from '../db/schema.js';

type UploadRow = typeof uploads.$inferSelect;

/** Começo do arquivo para cada tipo (evita "foto.png" que na verdade é outra coisa). */
function signatureOk(mime: string, data: Buffer): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  const ascii = (s: string, at = 0) => data.subarray(at, at + s.length).toString('latin1') === s;
  switch (mime) {
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/gif':
      return ascii('GIF8');
    case 'image/webp':
      return ascii('RIFF') && ascii('WEBP', 8);
    case 'application/pdf':
      return ascii('%PDF');
    case 'application/zip':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    case 'application/vnd.oasis.opendocument.text':
    case 'application/vnd.oasis.opendocument.spreadsheet':
      return starts(0x50, 0x4b, 0x03, 0x04);
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
      return starts(0xd0, 0xcf, 0x11, 0xe0);
    case 'text/plain':
    case 'text/csv':
      // Texto de verdade não tem byte zero.
      return !data.subarray(0, 4096).includes(0);
    default:
      return false;
  }
}

/**
 * Anexos: guarda o arquivo em `dir/<id>` (id aleatório) e o registro no banco. Quem pode baixar:
 * anexo do chat de uma sala = qualquer pessoa logada; de uma DM = só as duas pessoas da conversa;
 * ainda não usado = só quem enviou.
 */
export class UploadService {
  constructor(
    private readonly db: Db,
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Guarda o arquivo; devolve o anexo ou o motivo da recusa. */
  save(userId: string, rawName: string, declaredMime: string, data: Buffer): Attachment | string {
    if (data.length === 0) return 'Arquivo vazio.';
    if (data.length > UPLOAD_MAX_BYTES) return 'O arquivo passa de 10 MB.';
    const name = cleanFileName(rawName);
    const byName = mimeFromName(name);
    // O tipo vale pela extensão (o navegador às vezes manda genérico); tem de ser um aceito.
    const mime = byName ?? (UPLOAD_TYPES[declaredMime] ? declaredMime : null);
    if (!mime)
      return 'Esse tipo de arquivo não é aceito (imagens, PDF, documentos, planilhas, texto ou zip).';
    if (!signatureOk(mime, data)) return 'O conteúdo não confere com o tipo do arquivo.';
    if (this.usedBy(userId) + data.length > UPLOAD_QUOTA_BYTES) {
      return 'Você chegou ao limite de 500 MB em anexos.';
    }
    const id = randomBytes(18).toString('base64url');
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, id), data);
    const row = this.db
      .insert(uploads)
      .values({ id, userId, name, mime, size: data.length, createdAt: this.now() })
      .returning()
      .get();
    return toAttachment(row);
  }

  /** Bytes que a pessoa tem guardados em anexos. */
  usedBy(userId: string): number {
    return (
      this.db
        .select({ total: sql<number>`coalesce(sum(${uploads.size}), 0)` })
        .from(uploads)
        .where(eq(uploads.userId, userId))
        .get()?.total ?? 0
    );
  }

  find(id: string): UploadRow | undefined {
    return this.db.select().from(uploads).where(eq(uploads.id, id)).get();
  }

  attachment(id: string | null | undefined): Attachment | null {
    const row = id ? this.find(id) : undefined;
    return row ? toAttachment(row) : null;
  }

  /** O anexo é desta pessoa (só quem enviou pode colocar numa mensagem). */
  owns(id: string, userId: string): boolean {
    return this.find(id)?.userId === userId;
  }

  pathOf(id: string): string {
    return join(this.dir, id);
  }

  canRead(id: string, userId: string): boolean {
    const row = this.find(id);
    if (!row) return false;
    if (row.userId === userId) return true;
    const inRoom = this.db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.attachmentId, id))
      .get();
    if (inRoom) return true;
    return Boolean(
      this.db
        .select({ id: directMessages.id })
        .from(directMessages)
        .where(
          and(
            eq(directMessages.attachmentId, id),
            or(eq(directMessages.fromUserId, userId), eq(directMessages.toUserId, userId)),
          ),
        )
        .get(),
    );
  }

  /** Apaga anexos com mais de um dia que nenhuma mensagem usa (enviados e não mandados, ou de mensagens que saíram do histórico). */
  cleanup(): number {
    const cutoff = new Date(this.now().getTime() - 86_400_000);
    const used = new Set([
      ...this.db
        .select({ id: chatMessages.attachmentId })
        .from(chatMessages)
        .where(isNotNull(chatMessages.attachmentId))
        .all()
        .map((r) => r.id),
      ...this.db
        .select({ id: directMessages.attachmentId })
        .from(directMessages)
        .where(isNotNull(directMessages.attachmentId))
        .all()
        .map((r) => r.id),
    ]);
    const old = this.db.select().from(uploads).where(lt(uploads.createdAt, cutoff)).all();
    let removed = 0;
    for (const row of old) {
      if (used.has(row.id)) continue;
      this.db.delete(uploads).where(eq(uploads.id, row.id)).run();
      rmSync(this.pathOf(row.id), { force: true });
      removed++;
    }
    return removed;
  }
}

/** Anexos de várias mensagens de uma vez (usado pelo chat e pelas DMs). */
export function attachmentsOf(db: Db, ids: (string | null)[]): Map<string, Attachment> {
  const list = ids.filter((x): x is string => Boolean(x));
  if (list.length === 0) return new Map();
  return new Map(
    db
      .select()
      .from(uploads)
      .where(inArray(uploads.id, list))
      .all()
      .map((r) => [r.id, toAttachment(r)]),
  );
}

function toAttachment(r: UploadRow): Attachment {
  return {
    id: r.id,
    name: r.name,
    mime: r.mime,
    size: r.size,
    image: Boolean(UPLOAD_TYPES[r.mime]?.image),
  };
}
