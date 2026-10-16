# Escritório Virtual

Escritório virtual isométrico para amigos e colegas: avatares andando em salas no estilo Habbo, com movimento em tempo real e chat. Veja [SPEC.md](SPEC.md) (requisitos) e [PLAN.md](PLAN.md) (plano e decisões).

> Em construção — **Fase 4** (chat com balões e histórico por sala). O README completo, com deploy, entra na Fase 7.

## Rodar localmente

Requer Node.js 22 ou mais recente (testado com o 24).

```bash
npm install
cp .env.example .env   # opcional: ajuste INVITE_CODE e o token da HabboAssets
npm run dev
```

Isso sobe o servidor (http://localhost:2567) e o cliente (http://localhost:5173). Abra o cliente, digite um nome e o código de convite (`INVITE_CODE` do `.env`; sem `.env`, o código de desenvolvimento é `convite`).

Para testar com várias pessoas:

- abra uma segunda janela **anônima** (cada navegador guarda o seu próprio token), ou
- rode robôs que passeiam e conversam pela sala: `npm run bot` (ou `npm run bot -- Bia 3` para três robôs).

Opções de URL do cliente:

- `?offline=1` — usa só a arte provisória gerada por código (não chama a HabboAssets).
- `?debug=1` — desenha os footprints usados na ordenação de profundidade.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor (tsx watch) + cliente (Vite) juntos |
| `npm run dev:server` / `npm run dev:client` | Só um dos dois |
| `npm run bot` | Robôs de teste andando pela Recepção |
| `npm run assets:sync` | Regera o manifesto do avatar a partir da HabboAssets (`-- --thumbs` também baixa as miniaturas) |
| `npm test` | Testes unitários e de integração (Vitest) |
| `npm run typecheck` | Checagem de tipos de todos os pacotes |
| `npm run lint` | ESLint |
| `npm run build` | Build de produção do cliente |
| `npm run db:generate` | Gera migration SQL após mudar `server/src/db/schema.ts` |

## Estrutura

- `shared/` — código comum: coordenadas isométricas, A*, ordenação de profundidade, protocolo de rede, estado sincronizado.
- `server/` — Express + Colyseus no mesmo processo, SQLite (better-sqlite3 + Drizzle), proxy de assets com cache.
- `client/` — Vite + PixiJS; interface em HTML/CSS.

Os dados locais (banco SQLite e cache de imagens) ficam em `data/`, fora do git.

## Assets

Os gráficos vêm do imager público da [HabboAssets](https://www.habboassets.com/api) (Habbo Brasil), servidos pelo proxy com cache do servidor em `/hh/*`. A origem de cada asset fica em [ASSETS.md](ASSETS.md). Para adicionar um móvel, inclua-o em `client/public/assets/furni/manifest.json`.

O catálogo de roupas do editor (`client/public/assets/avatar/manifest.json`) é gerado por `npm run assets:sync`. Para mudar categorias ou bibliotecas, edite a curadoria em `server/src/assets/avatarManifest.ts` e rode o script de novo. Na primeira vez, rode `npm run assets:sync -- --thumbs` para o editor abrir com as miniaturas já em cache.
