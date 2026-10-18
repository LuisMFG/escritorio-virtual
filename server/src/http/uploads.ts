import {
  ErrorCode,
  SEARCH_LIMIT,
  SEARCH_MIN,
  type Attachment,
  type LinkPreview,
  type SearchHit,
} from '@office/shared';
import type { LinkPreviewService } from '../services/LinkPreviewService.js';
import type { SearchService } from '../services/SearchService.js';
import type { UploadService } from '../services/UploadService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface UploadDeps {
  uploads: UploadService;
  linkPreviews: LinkPreviewService;
  search: SearchService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });

/** Envio de um arquivo (corpo cru; nome no cabeçalho `X-File-Name`, codificado). */
export function uploadFile(
  caller: Caller,
  rawName: string | undefined,
  mime: string | undefined,
  data: unknown,
  deps: UploadDeps,
): Result<Attachment> {
  if (!Buffer.isBuffer(data))
    return fail(400, ErrorCode.InvalidPayload, { message: 'Arquivo vazio.' });
  let name = 'arquivo';
  try {
    name = decodeURIComponent(rawName ?? '') || name;
  } catch {
    // nome mal codificado: fica o padrão
  }
  const result = deps.uploads.save(caller.user.id, name, (mime ?? '').split(';')[0]!.trim(), data);
  if (typeof result === 'string') return fail(400, ErrorCode.InvalidPayload, { message: result });
  return ok(result);
}

/** Arquivo para baixar, se a pessoa pode ver. */
export function uploadFor(
  caller: Caller,
  id: string,
  deps: UploadDeps,
): Result<{ path: string; name: string; mime: string; image: boolean }> {
  const row = deps.uploads.find(id);
  if (!row || !deps.uploads.canRead(id, caller.user.id)) return fail(404, ErrorCode.NotFound);
  const a = deps.uploads.attachment(id)!;
  return ok({ path: deps.uploads.pathOf(id), name: a.name, mime: a.mime, image: a.image });
}

export async function linkPreview(
  _caller: Caller,
  query: { url?: unknown },
  deps: UploadDeps,
): Promise<Result<LinkPreview | null>> {
  if (typeof query.url !== 'string' || query.url.length > 2000)
    return fail(400, ErrorCode.InvalidPayload);
  return ok(await deps.linkPreviews.preview(query.url));
}

export function searchChat(
  caller: Caller,
  query: { q?: unknown },
  deps: UploadDeps,
): Result<SearchHit[]> {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q.length < SEARCH_MIN || q.length > 100) {
    return fail(400, ErrorCode.InvalidPayload, {
      message: `Digite pelo menos ${SEARCH_MIN} letras.`,
    });
  }
  return ok(deps.search.search(caller.user.id, q, SEARCH_LIMIT));
}
