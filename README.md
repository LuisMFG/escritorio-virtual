# Escritório Virtual

Escritório virtual isométrico para amigos e colegas: avatares andando em salas no estilo Habbo, com movimento em tempo real e chat. Veja [SPEC.md](SPEC.md) (requisitos) e [PLAN.md](PLAN.md) (plano e decisões).

> Em construção — **Fase 1** (sala única, avatar andando sem rede). O README completo, com deploy, entra na Fase 7.

## Rodar localmente

Requer Node.js 22 ou mais recente (testado com o 24).

```bash
npm install
npm run dev
```

Abra http://localhost:5173.

- `?offline=1` — usa só a arte provisória gerada por código (não chama a HabboAssets).
- `?debug=1` — desenha os footprints usados na ordenação de profundidade.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento do cliente (Vite) |
| `npm test` | Testes unitários (Vitest) |
| `npm run typecheck` | Checagem de tipos de todos os pacotes |
| `npm run lint` | ESLint |
| `npm run build` | Build de produção do cliente |

## Assets

Os gráficos vêm do imager público da [HabboAssets](https://www.habboassets.com/api) (Habbo Brasil). A origem de cada asset fica em [ASSETS.md](ASSETS.md). Para adicionar um móvel, inclua-o em `client/public/assets/furni/manifest.json`.
