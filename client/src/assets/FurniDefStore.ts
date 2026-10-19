import type { FurniCatalog, FurniManifestEntry } from '@office/shared';
import { furniApi } from '../net/api.js';

/**
 * Definições de móveis no navegador: as do manifesto curado mais as do catálogo completo
 * (Fase 36), que o servidor mede na primeira vez que alguém usa e o cliente busca quando vê.
 */
export class FurniDefStore {
  private readonly pending = new Map<string, Promise<FurniManifestEntry | null>>();
  private catalogPromise: Promise<FurniCatalog> | null = null;

  constructor(
    readonly defs: Map<string, FurniManifestEntry>,
    private readonly token: () => string | undefined,
  ) {}

  /** As já medidas no servidor (ao entrar), para não buscar uma a uma. */
  async loadMeasured(): Promise<void> {
    const token = this.token();
    if (!token) return;
    try {
      for (const d of await furniApi.measured(token))
        if (!this.defs.has(d.id)) this.defs.set(d.id, d);
    } catch {
      // Sem rede: os móveis que faltarem são buscados quando aparecerem.
    }
  }

  /** A definição (pedindo ao servidor, que mede se for a primeira vez). `null` = falhou. */
  ensure(id: string): Promise<FurniManifestEntry | null> {
    const known = this.defs.get(id);
    if (known) return Promise.resolve(known);
    const token = this.token();
    if (!token) return Promise.resolve(null);
    let p = this.pending.get(id);
    if (!p) {
      p = furniApi
        .def(token, id)
        .then((d) => {
          this.defs.set(d.id, d);
          return d;
        })
        .catch(() => null)
        .finally(() => this.pending.delete(id));
      this.pending.set(id, p);
    }
    return p;
  }

  /** O catálogo completo (~1 MB), carregado na primeira vez que o painel de decorar abre. */
  catalog(): Promise<FurniCatalog> {
    this.catalogPromise ??= fetch('/assets/furni/catalog.json').then((r) => {
      if (!r.ok) throw new Error(`catálogo: ${r.status}`);
      return r.json() as Promise<FurniCatalog>;
    });
    this.catalogPromise.catch(() => (this.catalogPromise = null));
    return this.catalogPromise;
  }
}
