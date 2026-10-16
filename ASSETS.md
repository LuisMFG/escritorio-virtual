# Origem dos assets

Registro de onde vem cada recurso visual/sonoro do projeto (exigência do SPEC).

## HabboAssets (imager e API v2)

- **Fonte:** https://www.habboassets.com — arquivo comunitário dos assets do Habbo, "não afiliado nem endossado pela Sulake".
- **Direitos:** os gráficos pertencem à Sulake/Habbo. Uso **pessoal, privado e não comercial** (escritório fechado por código de convite). Não publicar o site de forma aberta/indexada.
- **Hotel:** Habbo Brasil (`X-Hotel-ID: 2`).

Desde a Fase 2 as imagens passam pelo proxy do servidor (`/hh/avatar.png`, `/hh/furniture/…`), que baixa cada uma uma única vez e guarda em `data/asset-cache/`; o imager direto fica como reserva.

| Recurso | Endpoint | Onde é usado |
|---|---|---|
| Avatar (pose em pé, 8 direções) | `/imaging/avatar.png?figure=…&direction=0-7` | `client/src/assets/AvatarTextureCache.ts` |
| Mobis (render por direção, revisão fixada) | `/imaging/furniture/{classname}.png?revision=…&direction=…` | `client/src/entities/FurniView.ts` |

### Mobis usados na Fase 1 (`client/public/assets/furni/manifest.json`)

| Classname | Nome | Revisão |
|---|---|---|
| `chair_norja` | Cadeira Norja | 61856 |
| `couch_norja` | Sofá Norja | 61856 |
| `table_norja_med` | Mesa Norja | 61856 |
| `plant_big_cactus` | Cacto Grande | 48082 |
| `shelves_norja` | Estante Norja | 61856 |
| `carpet_standard` | Tapete | 48082 |

Dimensões (footprint) e âncoras foram medidas a partir dos renders; serão conferidas com a furnidata da API (token) na Fase 6.

## Arte provisória gerada por código

- **Fonte:** este projeto (`client/src/assets/PlaceholderFactory.ts`, `client/src/scene/RoomRenderer.ts`). Licença: a mesma do código.
- **O quê:** piso e paredes (sempre), e substitutos de mobis e avatares quando a HabboAssets falha ou com `?offline=1`.
- As cores do avatar provisório vêm das paletas aproximadas em `client/public/assets/avatar/manifest.json`.

## Pacotes CC0

Nenhum por enquanto. Ao adicionar um, registrar aqui: nome, autor, URL, licença e arquivos usados.
