# Origem dos assets

Registro de onde vem cada recurso visual/sonoro do projeto (exigência do SPEC).

## HabboAssets (imager e API v2)

- **Fonte:** https://www.habboassets.com — arquivo comunitário dos assets do Habbo, "não afiliado nem endossado pela Sulake".
- **Direitos:** os gráficos pertencem à Sulake/Habbo. Uso **pessoal, privado e não comercial** (escritório fechado por código de convite). Não publicar o site de forma aberta/indexada.
- **Hotel:** Habbo Brasil (`X-Hotel-ID: 2`).

Desde a Fase 2 as imagens passam pelo proxy do servidor (`/hh/avatar.png`, `/hh/furniture/…`), que baixa cada uma uma única vez e guarda em `data/asset-cache/`; o imager direto fica como reserva.

| Recurso | Endpoint | Onde é usado |
|---|---|---|
| Avatar montado no navegador (Fase 31) | SWFs originais das bibliotecas `hh_human_*` na CDN (`cdn.habboassets.com/images.habbo.com/gordon/…`), listados em `/api/v2/swfs/libraries/clothing/{lib}`; o servidor converte cada um em folha de sprites (`/hh/figure/{lib}.png` e `.json`) | `client/src/assets/FigureAvatarRenderer.ts`, `shared/src/figureRender.ts` |
| Dados de montagem (partes de cada roupa, onde estão, paletas) | `/imaging/info/clothing/{lib}` (`figuredata` e `figuremap`) | `server/scripts/figure-sync.ts` → `client/public/assets/figure/figuredata.json` |
| Itens na mão (Fase 34) | SWF `hh_human_item` (mesmo caminho das roupas) | `shared/src/effects.ts` (`HAND_ITEMS`) |
| Efeitos do avatar (Fase 34) | SWFs das bibliotecas de efeito (`/api/v2/swfs/libraries/effect/{nome}`), com a animação no próprio SWF; o servidor converte em `/hh/effect/{nome}.png` e `.json` | `client/src/assets/EffectLibrary.ts`, `client/src/entities/EffectLayer.ts` |
| Avatar pelo imager (reserva, e `?imager=1`) | `/imaging/avatar.png?figure=…&direction=0-7` | `client/src/assets/AvatarTextureCache.ts` |
| Miniaturas de roupa (peça no boneco "fantasma") | `/imaging/clothing/set/{id}.png?direction=2` | `client/src/ui/avatarEditor.ts` |
| Catálogo de roupas e paletas (dados) | lista `/api/v2/swfs/libraries?kind=clothing` + `/imaging/info/clothing/{lib}` de cada biblioteca (todas, menos NFT) | `server/scripts/figure-sync.ts` → `client/public/assets/avatar/manifest.json` |
| Miniaturas das roupas do catálogo completo | prévias estáticas da CDN `derived/clothing/{lib}/{rev}/set_{id}.png` (pelo servidor em `/hh/clothing/preview/…`) | `client/src/ui/avatarEditor.ts` |
| Mobis (render por direção, revisão fixada) | `/imaging/furniture/{classname}.png?revision=…&direction=…` | `client/src/entities/FurniView.ts` |
| Catálogo completo de móveis (Fase 36) | `/api/v2/furniture` (com token; nome em português, categoria, tamanho, lógica, variações de cor) | `server/scripts/furni-sync.ts` → `client/public/assets/furni/catalog.json` |
| Medição de um móvel do catálogo (na primeira vez que alguém usa) | `/imaging/info/furniture/{classname}` + renders de cada direção e estado | `server/src/assets/measureFurni.ts`, `server/src/services/FurniDefService.ts` |
| Móveis por camadas e animados (Fase 37) | SWF original `cdn.habboassets.com/images.habbo.com/dcr/hof_furni/{revisão}/{classname}.swf` (imagens + `_visualization` + `_assets`); o servidor converte em `/hh/furni/{classname}.png` e `.json` | `server/src/assets/furniVisual.ts`, `shared/src/furniVisual.ts`, `client/src/assets/FurniVisualLibrary.ts` |
| Música da jukebox | gerada no navegador (WebAudio), sem arquivos | `client/src/ui/ambient.ts` |
| Miniaturas do Decorar (catálogo completo e cores) | `/imaging/furniture/{classname}.png` (tamanho normal; o `size=32` falha em muitos móveis) | `client/src/ui/decorPanel.ts` |


### Mobis do catálogo (`client/public/assets/furni/manifest.json`)

28 móveis do Habbo Brasil, listados em `server/src/assets/furniCatalog.ts` (classname, nome em português e categoria). Revisões, direções, âncoras e tamanhos medidos são gravados pelo `npm run assets:sync`. Renders: `/imaging/furniture/{classname}.png?revision=…&direction=…`; miniaturas do Decorar: o mesmo render, reduzido.

## Arte provisória gerada por código

- **Fonte:** este projeto (`client/src/assets/PlaceholderFactory.ts`, `client/src/scene/RoomRenderer.ts`). Licença: a mesma do código.
- **O quê:** piso e paredes (sempre), e substitutos de mobis e avatares quando a HabboAssets falha ou com `?offline=1`.
- O avatar provisório (`client/src/assets/LayeredAvatar.ts`) é desenhado em camadas cinza e tingido com as cores reais das paletas do manifesto.

## Outros recursos próprios

- **Ícone do site** (`client/public/favicon.svg`): desenhado para o projeto.
- **Som de mensagem** (`client/src/ui/sound.ts`): sintetizado na hora com Web Audio, sem arquivo de áudio.
- **Pets desenhados** (`client/src/assets/petArt.ts`): pixel art própria (cachorro, gato, coelho e pintinho, 3 pelagens, em pé/andando/sentado/deitado), desenhada por código a partir de grades 16×12 com contorno automático. Continuam como opção e como reserva sem internet.
- **Pets do Habbo** (Fase 38): SWFs das bibliotecas de pet (`/api/v2/swfs/libraries?kind=pet`, CDN `gordon/…/pets/{tipo}.swf`), convertidos pelo servidor em `/hh/pet/{tipo}.png|json` com a paleta aplicada. Catálogo em `client/public/assets/pets/pets.json` (`npm run assets:pets`).
- **Emblemas de conquistas** (`client/src/ui/badges.ts` + CSS): medalhas desenhadas em CSS com emoji. A HabboAssets não tem imagens de emblemas.
- **Som ambiente** (`client/src/ui/ambient.ts`) e **tabuleiro do jogo da velha** (`FurniView.drawGameBoard`): gerados por código.

## Arte local e pacotes CC0

Móveis com `source: 'local'` usam imagens em `client/public/assets/local/furni/{id}_{direção}.png` (ver README). Nenhum por enquanto. Ao adicionar, registre aqui:

| Arquivo(s) | Autor | Licença | URL de origem |
|---|---|---|---|
| — | — | — | — |
