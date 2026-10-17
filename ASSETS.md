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
| Miniaturas de roupa (peça no boneco "fantasma") | `/imaging/clothing/set/{id}.png?direction=2` | `client/src/ui/avatarEditor.ts` |
| Catálogo de roupas e paletas (dados) | `/imaging/info/clothing/hh_human_*` | `server/scripts/assets-sync.ts` → `client/public/assets/avatar/manifest.json` |
| Mobis (render por direção, revisão fixada) | `/imaging/furniture/{classname}.png?revision=…&direction=…` | `client/src/entities/FurniView.ts` |

### Mobis do catálogo (`client/public/assets/furni/manifest.json`)

28 móveis do Habbo Brasil, listados em `server/src/assets/furniCatalog.ts` (classname, nome em português e categoria). Revisões, direções, âncoras e tamanhos medidos são gravados pelo `npm run assets:sync`. Renders: `/imaging/furniture/{classname}.png?revision=…&direction=…`; miniaturas do catálogo: o mesmo com `size=32`.

## Arte provisória gerada por código

- **Fonte:** este projeto (`client/src/assets/PlaceholderFactory.ts`, `client/src/scene/RoomRenderer.ts`). Licença: a mesma do código.
- **O quê:** piso e paredes (sempre), e substitutos de mobis e avatares quando a HabboAssets falha ou com `?offline=1`.
- O avatar provisório (`client/src/assets/LayeredAvatar.ts`) é desenhado em camadas cinza e tingido com as cores reais das paletas do manifesto.

## Outros recursos próprios

- **Ícone do site** (`client/public/favicon.svg`): desenhado para o projeto.
- **Som de mensagem** (`client/src/ui/sound.ts`): sintetizado na hora com Web Audio, sem arquivo de áudio.
- **Pets** (`client/src/assets/petArt.ts`): pixel art própria (cachorro, gato, coelho e pintinho, 3 pelagens, em pé/andando/sentado/deitado), desenhada por código a partir de grades 16×12 com contorno automático. O imager da HabboAssets não renderiza pets (só oferece os SWFs), por isso não usamos a arte do Habbo.
- **Emblemas de conquistas** (`client/src/ui/badges.ts` + CSS): medalhas desenhadas em CSS com emoji. A HabboAssets não tem imagens de emblemas.
- **Som ambiente** (`client/src/ui/ambient.ts`) e **tabuleiro do jogo da velha** (`FurniView.drawGameBoard`): gerados por código.

## Arte local e pacotes CC0

Móveis com `source: 'local'` usam imagens em `client/public/assets/local/furni/{id}_{direção}.png` (ver README). Nenhum por enquanto. Ao adicionar, registre aqui:

| Arquivo(s) | Autor | Licença | URL de origem |
|---|---|---|---|
| — | — | — | — |
