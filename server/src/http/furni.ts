import {
  ErrorCode,
  furniCategoriesSchema,
  type FurniConfigResponse,
  type FurniManifestEntry,
} from '@office/shared';
import type { AuditService } from '../services/AuditService.js';
import type { FurniDefService } from '../services/FurniDefService.js';
import type { SettingsService } from '../services/SettingsService.js';
import { fail, type Caller, type Result } from './auth.js';

export interface FurniDeps {
  furniCatalog: FurniDefService;
  settings: SettingsService;
  audit: AuditService;
}

const ok = <T>(body: T) => ({ ok: true as const, status: 200 as const, body });

/** Categorias escondidas (o painel de decorar não mostra; o servidor recusa colocar). */
export function furniConfig(deps: FurniDeps): Result<FurniConfigResponse> {
  return ok({ hiddenCategories: deps.settings.hiddenCategories() });
}

/** Definições já medidas do catálogo completo (somam às do manifesto no cliente). */
export function measuredDefs(deps: FurniDeps): Result<FurniManifestEntry[]> {
  return ok(deps.furniCatalog.measured());
}

/** Definição de um móvel, medindo na primeira vez (pode levar alguns segundos). */
export async function furniDef(id: string, deps: FurniDeps): Promise<Result<FurniManifestEntry>> {
  try {
    const def = await deps.furniCatalog.ensure(id);
    if (def) return ok(def);
    return fail(404, ErrorCode.NotFound, { message: 'Móvel não encontrado no catálogo.' });
  } catch {
    return fail(502, ErrorCode.Unavailable, {
      message: 'Não consegui preparar esse móvel agora. Tente de novo.',
    });
  }
}

/** Admin: categorias escondidas do catálogo de móveis. */
export function setHiddenCategories(
  caller: Caller,
  input: unknown,
  deps: FurniDeps,
): Result<FurniConfigResponse> {
  if (caller.user.role !== 'admin') return fail(403, ErrorCode.Forbidden);
  const p = furniCategoriesSchema.safeParse(input);
  if (!p.success) return fail(400, ErrorCode.InvalidPayload);
  deps.settings.setHiddenCategories(p.data.hidden);
  const hidden = deps.settings.hiddenCategories();
  deps.audit.log(caller.user.id, 'furni.categories', null, hidden.join(', ') || 'nenhuma');
  return ok({ hiddenCategories: hidden });
}
