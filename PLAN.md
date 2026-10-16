# PLAN — Escritório virtual isométrico

> Documento vivo. Atualizar sempre que o plano mudar (ver "Como trabalhar" no SPEC.md).
> Status: **aprovado em 16/10/2026** — Fases 1 a 6 aprovadas; Fase 7 concluída (aguardando validação). v1 completa. Decisões registradas na §9.

---

## 1. Decisões de stack

| Área | Escolha | Por quê |
|---|---|---|
| Linguagem / monorepo | TypeScript + **npm workspaces** (`client`, `server`, `shared`) | Zero ferramenta extra (sem Turborepo/pnpm); `shared` é importado como pacote `@office/shared` pelos dois lados. |
| Renderização | **PixiJS v8** (não Phaser 3) | Precisamos só de um renderer 2D rápido com controle total de ordenação de profundidade e texturas; Phaser traria física, cenas e loader que não usaríamos e brigaria com nosso sort isométrico próprio. |
| UI | HTML/CSS puro + TypeScript (sem framework) | Chat, catálogo, editor e lista são poucos painéis; manter DOM simples evita mais uma dependência. Se a UI crescer, reavaliar (Preact). |
| Tempo real | **Colyseus 0.18** (não Socket.IO) | Já entrega exatamente o modelo do SPEC: salas com estado autoritativo, sincronização por diffs binários, `onAuth`, e reconexão (`allowReconnection`) prontos — com Socket.IO teríamos que escrever tudo isso. |
| Persistência | **SQLite via better-sqlite3 + Drizzle ORM** (não Prisma) | better-sqlite3 é síncrono e rápido; Drizzle dá schema/migrations tipados sem o engine binário do Prisma, o que simplifica o Docker e mantém um único processo Node. |
| Validação | **zod** em `shared` | Mesmos schemas validam payloads no servidor e formulários no cliente. |
| Testes | **Vitest** | Nativo com Vite/ESM/TS, roda em `shared`, `server` e `client`. |
| HTTP | Express (dentro do servidor Colyseus) | Serve `client/dist`, endpoints REST (`/api/session`, catálogo) e o proxy/cache de assets no mesmo processo. |
| Node | 24 LTS | Versão atual instalada e alvo do Dockerfile. |

---

## 2. Integração HabboAssets API v2

### 2.1 O que a API oferece (verificado em 16/10/2026 em https://www.habboassets.com/api)

- **Base REST:** `https://www.habboassets.com/api/v2` — `Accept: application/json`, `X-Hotel-ID: 2` (Habbo Brasil; padrão é 1). Limite observado: `x-ratelimit-limit: 240` (por minuto). CORS: `access-control-allow-origin: *`.
- **Endpoints públicos úteis:** `/hotels`, `/gamedata?type=texts|variables`, `/sounds`, `/swfs/libraries?kind=clothing`, `/images?kind=furnicons|catalog`, `/feed`.
- **Furniture (exige token `Authorization: Bearer …`):** `/furniture?search=&category=&type=room`, `/furniture/{classname}` (furnidata: dimensões, nome PT-BR, flags de sentar/andar, revisões), `/furniture/categories`, `/furniture/zip?format=nitro`.
- **Imager (público, sem token, fora de `/api/v2`):**
  - `/imaging/furniture/{classname}.png?direction=0-7&color=&state=&size=64|32&revision=`
  - `/imaging/avatar.png?figure=hd-180-1.ch-210-66...&direction=&head_direction=&size=n|l` — **apenas pose em pé**; `action=wlk/sit` não é suportado (testado).
  - `/imaging/clothing/{library}.png`, `/imaging/clothing/set/{setId}.png`
  - `/imaging/info/furniture/{classname}` (JSON: revisões, direções, cores, estados), `/imaging/info/clothing/{library}`, `/imaging/search?type=furniture&q=`
  - Imagens já renderizadas: cache ilimitado (`Cache-Control: public, max-age=16070400`). Renders novos: **60/min por IP** (429 + `Retry-After`).

### 2.2 Arquitetura

```
 Browser (Pixi)                          Servidor Node                         HabboAssets
 ──────────────                          ────────────                          ───────────
 AssetLoader ── GET /hh/furni/chair_norja/2.png ──▶ AssetProxy ──(miss)──▶ /imaging/furniture/...
     │                                     │  cache em disco (data/asset-cache)    (rate limiter)
     │                                     │
     │  ── GET /api/catalog ─────────────▶ CatalogService ──(token, X-Hotel-ID:2)─▶ /api/v2/furniture/{c}
     │                                     │  catálogo curado em SQLite
     └─ fallback: PlaceholderFactory (Pixi Graphics → RenderTexture) se proxy e imager falharem
```

- **`server/src/assets/HabboAssetsClient.ts`** — único ponto que fala com a API. Injeta `X-Hotel-ID: 2`, `Authorization` (só se `HABBOASSETS_API_KEY` existir, só nos endpoints de furniture), token bucket (alvo ≤ 120 req/min REST e ≤ 30 renders/min no imager, metade dos limites), retry respeitando `Retry-After`, timeout 10 s. **O token nunca vai para o cliente.**
- **`AssetProxy`** (rota Express `/hh/*`) — mapeia URLs estáveis nossas para o imager, grava a PNG em `data/asset-cache/<hash>.png` na primeira vez e serve do disco depois (`Cache-Control: immutable`, URLs incluem a revisão). Assim o cliente é same-origin e só o servidor consome a cota.
- **`npm run assets:sync`** (script do servidor) — lê os manifestos curados e pré-baixa: renders de cada mobi em todas as direções suportadas, ícones, renders das peças de roupa para o editor e o JSON de furnidata. Resultado vai para `data/asset-cache` (e opcionalmente é "assado" para `client/public/assets/cache` no build Docker), deixando o runtime independente da API.
- **Gamedata:** o catálogo de roupas válido (sets e paletas) vem de `/swfs/libraries?kind=clothing` + `/imaging/info/clothing/{library}`; o resultado é congelado num manifesto curado (ver §7) — o servidor valida contra esse manifesto, não contra a API ao vivo.
- **Cliente (`client/src/assets/AssetLoader.ts`)** — resolve uma chave lógica (`furni:chair_norja:dir2`, `avatar:<figure>:dir3`) para uma lista de URLs em ordem: proxy `/hh/...` → imager direto (CORS `*` permite) → placeholder gerado. Usa `Assets.load` do Pixi, mantém `Map<chave, Texture>` e o cache HTTP do navegador cuida da persistência entre sessões.
- **Fase 1 (sem servidor):** o cliente usa só imager direto + placeholders; o proxy entra na Fase 2.
- **Origem registrada em `ASSETS.md`:** cada asset local/CC0/placeholder com fonte e licença; assets Habbo identificados como "HabboAssets imager / Sulake, uso pessoal não comercial".

---

## 3. Estrutura de pastas

```
/
├── package.json              # workspaces + scripts raiz (dev, build, test, lint)
├── tsconfig.base.json        # config TS compartilhada (strict, ESM, paths)
├── .env.example              # INVITE_CODE, HABBOASSETS_API_KEY, PORT, DATABASE_PATH
├── Dockerfile                # build multi-stage → um processo Node (Fase 7)
├── README.md / ASSETS.md     # como rodar/deploy / origem e licença dos assets
├── SPEC.md / PLAN.md
│
├── shared/                   # código puro, sem DOM nem Node APIs
│   └── src/
│       ├── iso.ts            # tile ↔ tela, constantes de tile (64×32)
│       ├── pathfinding.ts    # A* (usado no cliente na Fase 1 e no servidor depois)
│       ├── depth.ts          # ordenação de profundidade (caixas de footprint + sort topológico)
│       ├── habboassets.ts    # construtores de URL do imager / constantes da API (hotel 2)
│       ├── grid.ts           # mapa de ocupação/altura da sala a partir de layout + móveis
│       ├── placement.ts      # validação de colocar/mover/girar móvel
│       ├── avatar.ts         # tipos de figure string, parser/serializer, validação
│       ├── protocol.ts       # nomes de mensagens + schemas zod dos payloads
│       ├── rooms.ts          # definições das salas iniciais (heightmap, portas)
│       ├── constants.ts      # limites (rate limit, tamanho de chat, velocidade)
│       └── *.test.ts         # testes unitários de cada módulo acima
│
├── client/
│   ├── index.html
│   ├── vite.config.ts        # proxy /api, /hh e WebSocket → servidor em dev
│   ├── public/assets/
│   │   ├── avatar/manifest.json     # peças, categorias, paletas, URLs do imager (SPEC §6)
│   │   ├── furni/manifest.json      # catálogo curado: classname, footprint, offsets, flags
│   │   └── local/                   # sprites locais/CC0 opcionais
│   └── src/
│       ├── main.ts           # bootstrap: telas, app Pixi, conexão
│       ├── net/              # cliente Colyseus, reconexão, handlers de mensagens
│       ├── scene/            # RoomScene, RoomRenderer (chão/paredes), Camera
│       ├── entities/         # AvatarView (interpolação/animação), FurniView, ChatBubble
│       ├── assets/           # AssetLoader, PlaceholderFactory, AvatarTextureCache
│       ├── ui/               # login, editor de avatar, chat, catálogo, lista de pessoas
│       └── state/            # store local (sala atual, modo editar, preferências/localStorage)
│
└── server/
    ├── drizzle.config.ts
    └── src/
        ├── index.ts          # Express + Colyseus no mesmo http.Server; serve client/dist
        ├── config.ts         # leitura/validação do .env
        ├── http/             # /api/session, /api/catalog, /api/me/avatar
        ├── rooms/            # OfficeRoom (Colyseus), schema de estado, MovementSystem
        ├── assets/           # HabboAssetsClient, AssetProxy, script assets-sync
        ├── db/               # schema Drizzle, migrations, seed das 3 salas e catálogo
        ├── services/         # UserService, RoomLayoutService, ChatService
        └── util/             # rateLimiter, logger
```

---

## 4. Modelo de dados

### 4.1 SQLite (Drizzle)

```ts
users          { id: text pk (nanoid), name: text,   // nome livre; pode repetir (ver §9)
                 sessionTokenHash: text, figure: text, gender: 'M'|'F',
                 createdAt: int, lastSeenAt: int }

rooms          { id: text pk ('reception'|'meeting'|'pantry'), name: text,
                 heightmap: text,        // linhas tipo Habbo: 'x' = sem tile, '0'-'9' = altura
                 wallHeight: int, floorColor: text, wallColor: text,
                 spawnX: int, spawnY: int, spawnDir: int }

room_doors     { id: int pk, roomId: fk rooms, x: int, y: int,
                 targetRoomId: fk rooms, targetX: int, targetY: int, targetDir: int }

rooms          … + furniSeeded: bool   // móveis iniciais já inseridos (não repõe o que foi removido)

room_furni     { id: text pk, roomId: fk rooms, defId: text (classname do catálogo),
                 x: int, y: int, z: real, rot: int (0|2|4|6),
                 placedBy: fk users null, updatedAt: int }

// Catálogo de móveis: não é tabela. Fica em client/public/assets/furni/manifest.json
// (gerado pelo assets:sync, versionado), lido pelo cliente e pelo servidor. Ver Notas da Fase 6.

chat_messages  { id: int pk, roomId: fk rooms, userId: fk users, nameSnapshot: text,
                 text: text, createdAt: int }   // manter últimas 200 por sala
```

A aparência fica no próprio `users.figure` (figure string Habbo, ex. `hd-180-1.ch-210-66.lg-270-82.sh-290-80`). Se mais tarde quisermos histórico de visuais, extrai-se uma tabela `avatars`.

### 4.2 Estado sincronizado em tempo real (Colyseus `@colyseus/schema`)

Definido com `schema()` do `@colyseus/schema` v5 em `shared/src/state.ts` (sem decorators), para o cliente decodificar com tipos.

```ts
const Player = schema({
  userId: t.string(),           // users.id
  name: t.string(),
  figure: t.string(),
  x: t.uint8(), y: t.uint8(), z: t.float32(),   // tile atual
  nextX: t.uint8(), nextY: t.uint8(),            // tile do passo em andamento (= x,y parado)
  dir: t.uint8(),               // 0–7 (direções Habbo)
  action: t.string(),           // 'idle' | 'walk' | 'sit'
  away: t.boolean(),            // caiu e está no prazo de reconexão
}, 'Player');

const OfficeState = schema({
  roomId: t.string(),
  players: t.map(Player),       // chave = sessionId
  // furni: t.map(Furni)        // Fase 6: { id, catalogId, x, y, z, rot, color, occupiedBy }
}, 'OfficeState');
```

Layout estático (heightmap, portas, cores e, até a Fase 6, os móveis) é pedido pelo cliente logo depois de entrar, via `room.request('room.layout')` — uma requisição evita a corrida de uma mensagem enviada no `onJoin` chegar antes de o cliente registrar o handler. Chat **não** fica no estado: é broadcast efêmero + histórico vindo do banco.

---

## 5. Protocolo de rede

### 5.1 HTTP

| Rota | Payload → Resposta |
|---|---|
| `POST /api/session` | `{ name, inviteCode?, figure?, gender?, token? }` → `{ userId, token, name, figure, gender }` (cria ou reaproveita usuário; token salvo no localStorage; erro `NAME_IN_USE` se o nome estiver em uso por alguém online) |
| `GET /api/presence` | (header `Authorization: Bearer token`) → `{ rooms: [{ roomId, name, people: [{ name }] }] }` |
| `GET /hh/*` | proxy/cache de imagens do imager (`avatar.png`, `furniture/{c}.png`, `clothing/set/{id}.png`) |

### 5.2 Colyseus — join

`client.joinOrCreate('office', { officeRoomId: 'reception', token, ticket? })` → `onAuth` valida o token e devolve o usuário; código de convite é checado só no `/api/session`. Cada sala física é uma instância Colyseus `office` com `filterBy(['officeRoomId'])` (a opção não pode se chamar `roomId`, que é o id interno da instância). `ticket` vem de uma porta e define onde nascer.

### 5.3 Mensagens cliente → servidor (todas validadas com zod)

| Tipo | Payload | Regras no servidor |
|---|---|---|
| `room.layout` (requisição) | — | responde com `{ roomId, name, heightmap, spawn, doors[], wallColor, floorColor, furni[] }` |
| `move` | `{ x, y }` | rate limit 5/s; A* no servidor a partir da posição atual; destino bloqueado → tile livre mais próximo; sem caminho → `error INVALID_MOVE` |
| `chat` | `{ text }` | normaliza (remove controle/invisíveis, junta espaços), 1–200 chars, rate limit 3 msgs/5 s; texto puro |
| `chat.history` (requisição) | — | responde com as últimas 50 mensagens da sala |
| `furni.place` | `{ defId, x, y, rot }` | rate limit 10 + 4/s; `canPlace` (shared); persiste em `room_furni` |
| `furni.move` | `{ furniId, x, y, rot }` | mover e/ou girar; idem; recusado se alguém está sentado nele |
| `furni.remove` | `{ furniId }` | idem |
| `interact` | `{ furniId }` | se `canSit`: anda até o assento livre mais perto e senta (`action='sit'`, `z = z do móvel + sitHeight`, dir = rot do móvel) |
| `avatar.update` | `{ figure, gender }` | valida contra manifesto; persiste; atualiza `Player.figure` |
| `typing` | `{ on: boolean }` | opcional, indicador "digitando…" |

### 5.4 Mensagens servidor → cliente

| Tipo | Payload |
|---|---|
| `chat.message` | `{ id, roomId, userId, sessionId, name, text, ts }` (broadcast só na sala) |
| `room.transfer` | `{ targetRoomId, ticket }` — cliente sai e entra na outra sala com o ticket (spawn na porta de destino) |
| `error` | `{ code: 'RATE_LIMIT'|'INVALID_MOVE'|'INVALID_PLACEMENT'|…, message }` |

Movimento: o servidor roda um tick de 50 ms; cada passo dura 500 ms (2 tiles/s, diagonal igual — estilo Habbo). Ao iniciar um passo ele seta `nextX/nextY/dir/action='walk'`; ao terminar, `x/y`. O cliente enfileira cada `next` recebido e interpola em 500 ms (acelera 1,5× se acumular passos por atraso de rede; teleporta se a posição não for vizinha).

Reconexão: queda curta → `onDrop` marca `away` e chama `allowReconnection(client, 30)`; o SDK reconecta sozinho (`onDrop`/`onReconnect` no cliente). Se a sala sumiu (servidor reiniciou), o cliente reentra do zero com o mesmo token, com backoff 1/2/4/8/15 s. Se a mesma pessoa entra de novo (recarregou a página) enquanto há um avatar `away` dela, a reconexão pendente é cancelada na hora; e o cliente faz `leave()` no `pagehide`.

---

## 6. Sistema isométrico

### 6.1 Coordenadas (`shared/iso.ts`)

Tile Habbo: `TILE_W = 64`, `TILE_H = 32`, unidade de altura `Z_UNIT = 32 px`.

```
tileToScreen(x, y, z) = { sx: (x - y) * 32,  sy: (x + y) * 16 - z * 32 }
screenToTile(sx, sy)  = { x: floor((sy/16 + sx/32) / 2), y: floor((sy/16 - sx/32) / 2) }
```

`screenToTile` assume z = 0; para clique em tiles elevados, testa-se de cima para baixo os tiles candidatos com o polígono do losango. A origem da cena é deslocada pela `Camera` (centralizar sala, arrastar com o mouse, zoom inteiro 1×/2× para manter pixel art nítida com `roundPixels` e `scaleMode: 'nearest'`). Testes: ida-e-volta em grade 20×20, cantos de losango, alturas.

### 6.2 Ordenação de profundidade

- Camadas fixas: chão/paredes (container próprio, sem sort) → **objetos** (sortableChildren) → balões/nomes (sempre por cima).
- Cada objeto tem uma caixa no grid: `minX..maxX, minY..maxY, z..z+h`. Móvel = footprint girado; avatar parado = seu tile; avatar andando = **união** do tile atual e do próximo (evita "atravessar" a quina de um móvel durante a interpolação).
- Chave de profundidade: `depth = (maxX + maxY) * 1000 + z * 10 + tie` com regra específica para móveis multi-tile: quando dois objetos têm caixas que se sobrepõem na diagonal, compara-se por "A está à frente de B se `A.minX > B.maxX` ou `A.minY > B.maxY`" (sort topológico). Com ≤ ~150 objetos por sala, o sort completo roda só quando algo muda (flag dirty), não a cada frame.
- Tapetes (`canWalk`) recebem `depth` fixo logo acima do chão. Avatar sentado usa `z = sitHeight` do móvel e o tie-breaker o coloca à frente do assento e atrás do encosto (encosto via `state`/camada separada se o render do imager o tiver; senão aceita-se o render único — ver Riscos).
- Lógica pura em `shared/depth.ts`; testes unitários com cenários: avatar atrás/na frente de mesa 2×1, passando ao lado de estante, sentado em sofá.

### 6.3 Pathfinding (`shared/pathfinding.ts`)

- A* em grade com 8 vizinhos, custo 1 ortogonal / 1 diagonal (como o Habbo; chebyshev como heurística), **sem cortar quinas** (diagonal só se os dois ortogonais forem livres).
- Grade de passabilidade vem de `grid.ts`: tile existe no heightmap, sem móvel bloqueante (tapete passa, cadeira só como destino final para sentar), diferença de altura ≤ 1.5, sem outro avatar parado no tile final (passar por outros é permitido, como no Habbo, para evitar engarrafamento).
- Destino inválido → busca o tile livre mais próximo do destino (BFS limitado) para o clique não "morrer".
- Limite de nós expandidos (ex. 4 000) para não travar o servidor; binary heap para a open list.
- Testes: caminho reto, desvio de obstáculo, sem caminho, quinas, destino ocupado, sala com buraco.

---

## 7. Avatar e mobis em camadas / sprites

### 7.1 Avatar

- **Representação:** figure string Habbo (`tipo-set-cor[-cor2]` unidos por `.`). Categorias e ordem de camadas (de trás para frente, direção 2): `hd` (corpo/pele) → `lg` (calça) → `sh` (sapato) → `ch` (blusa) → `wa` (cintura) → `cc` (casaco) → `ca` (acessório de peito) → `hr` (cabelo) → `fa` (rosto) → `ea` (óculos) → `ha` (chapéu). A ordem varia por direção — o render do imager já resolve isso.
- **Manifesto `client/public/assets/avatar/manifest.json`** (gerado por `npm run assets:sync`, versionado no git; curadoria em `server/src/assets/avatarManifest.ts`):
  ```json
  { "version": 1, "hotelId": 2,
    "imager": "https://www.habboassets.com/imaging/avatar.png",
    "defaults": { "M": "hd-180-1.hr-100-61.ch-210-66.lg-270-82.sh-290-80", "F": "hd-600-1.hr-515-33.ch-630-73.lg-695-82.sh-725-64" },
    "palettes": { "1": [{ "id": 14, "hex": "#f5da88" }, …], "2": […], "3": […] },   // ordem = ordem de exibição
    "categories": [
      { "type": "hr", "label": "Cabelo", "palette": "2", "required": false, "layer": 6,
        "sets": [{ "id": 115, "gender": "M", "colors": 1, "defaultColors": [45], "club": 0, "library": "hh_human_hair" }] } ]
  }
  ```
  Fonte dos dados: `/imaging/info/clothing/{biblioteca}` da HabboAssets, que traz sets (tipo, gênero, nº de cores, paleta, cores padrão) e paletas (id, hex, selecionável) — o figuredata do Habbo por biblioteca. Usamos as bibliotecas base `hh_human_*` (270 peças em 9 categorias). O figuredata do habbo.com.br não é usado: o site bloqueia acesso por script.
  O servidor importa o mesmo arquivo para validar (`validateFigure` em `shared/src/avatar.ts`): cada set deve existir na categoria e servir para o gênero, cada cor na paleta da categoria, categorias obrigatórias (`hd`, `ch`, `lg`) presentes, máx. 1 set por tipo, string ≤ 512 chars.
- **Recoloração:** com o imager, a recoloração é feita pelo próprio Habbo via ids de paleta na figure string (os seletores do editor mostram as cores hex da paleta e gravam o id). No renderer local de fallback (`client/src/assets/LayeredAvatar.ts`), cada peça é um desenho em tons de cinza tingido com `tint = hex` (multiply), empilhado pela ordem `layer` do manifesto e assado numa textura por combinação.
- **Renderização e cache (`AvatarTextureCache`):** chave `figure|dir|pose|frame`. Primeira vez: baixa as 8 direções do render (`size=n`, 64×110) pelo proxy, cria `Texture`s e guarda num LRU (máx. ~200 entradas, ≤ 10 usuários × 8 direções sobra muito). Nunca compõe camadas por frame; no renderer local, as camadas são compostas uma vez num `RenderTexture` por combinação.
- **Caminhada:** o imager só tem pose parada. Plano v1 (pendente de aprovação, ver §9): render parado por direção + animação procedural (bob vertical de 2 px em 4 frames, leve deslocamento horizontal alternado e sombra elíptica), mais a pose sentada simulada (render com `z` e recorte inferior). Interface `AvatarRenderer` permite trocar por um renderer real de partes (bibliotecas `.nitro`) no futuro sem tocar no resto.
- **Editor:** prévia grande (`size=l`) com botões de girar (direção 0–7), abas por categoria, grade de miniaturas de sets e paleta de cores; debounce de 300 ms antes de pedir novo render; mostra placeholder enquanto carrega.

### 7.2 Mobis

- **Manifesto `client/public/assets/furni/manifest.json`** (espelhado em `furni_catalog`): ~20–30 itens curados do Habbo BR (mesas, cadeiras, sofá, planta, estante, quadro branco, máquina de café, tapete), com classname, nome PT-BR (da furnidata, via token), footprint, flags, direções suportadas (de `/imaging/info/furniture`) e **offsets de âncora por direção**.
- Render: uma PNG do imager por direção (`size=64`). Footprint gira trocando largura/profundidade em `rot` 2/6. Âncora: o ponto de tela do tile de origem + `offsets[dir]` calibrado (ferramenta de debug na Fase 6 que desenha o footprint sobre a imagem para ajustar os offsets e salvar no manifesto).
- Ícones do catálogo: `/imaging/furniture/{c}.png?size=32` ou `/images?kind=furnicons`.
- **Placeholders por código (`PlaceholderFactory`):** se o asset falhar ou `OFFLINE_ASSETS=1`, gera com `Pixi.Graphics` → `RenderTexture` (cacheado por chave): caixa isométrica com as dimensões do footprint e cor por categoria (cadeira com encosto, mesa com tampo, tapete achatado, planta como cone verde); avatar como corpo-cápsula com cabeça e cores derivadas da figure string (pele/blusa/calça) — ou seja, recolor funciona mesmo offline. Chão/paredes são sempre gerados por código (losangos com borda, paredes em dois lados com cor configurável), sem depender da API.

---

## 8. Fases detalhadas

### Fase 1 — Sala única, avatar andando (sem rede), base de assets ✅ implementada
- Monorepo: `package.json` com workspaces, `tsconfig.base.json`, ESLint + Prettier, Vitest configurado nos 3 pacotes, `.env.example`.
- `shared/iso.ts`, `shared/grid.ts`, `shared/pathfinding.ts` + testes.
- `shared/rooms.ts` com a Recepção (heightmap ~12×10, porta marcada mas inativa).
- Cliente Vite + Pixi v8: `RoomScene` com chão em losangos e paredes em dois lados gerados por código, `Camera` (centralizar, arrastar, zoom 1×/2×), hover do tile sob o mouse.
- `AssetLoader` + `PlaceholderFactory` + `AvatarTextureCache`; avatar padrão carregado do imager (8 direções), com fallback placeholder.
- Clique no tile → A* local → `AvatarView` anda tile a tile (500 ms/passo), vira para a direção do passo, animação procedural de caminhada.
- 3–4 móveis estáticos de teste (do imager) bloqueando tiles + `DepthSorter` básico.
- Esqueleto dos manifestos `avatar/manifest.json` e `furni/manifest.json` e `ASSETS.md` inicial.

**Como testar:** `npm install && npm run dev` → abrir `http://localhost:5173`; ver a sala, clicar em tiles e o avatar desviar dos móveis; passar atrás/na frente de um móvel e ver a ordem correta; abrir com a rede bloqueada (DevTools → offline após carregar o JS, ou `?offline=1`) e ver placeholders; `npm test` passa (iso, grid, pathfinding).

### Fase 2 — Servidor em tempo real, vários usuários, tela de entrada ✅ implementada
- Servidor Express + Colyseus no mesmo http server; `config.ts` com `INVITE_CODE`, `PORT`, `DATABASE_PATH`, `HABBOASSETS_API_KEY`.
- Drizzle: schema `users`, `rooms`, migrations, seed da Recepção.
- `POST /api/session` (nome + convite → token; nome pode repetir, só é recusado se alguém **online agora** já usa o mesmo nome — comparação sem maiúsculas/acentos), `onAuth` no Colyseus.
- `OfficeRoom` com `OfficeState`; `MovementSystem` usando o A* compartilhado no servidor; tick 50 ms; rate limit de `move`.
- Cliente: tela de entrada (nome + código, lembra nome/token em localStorage), conexão Colyseus, `AvatarView` para cada `Player` com interpolação, lista de presentes, reconexão automática com backoff e banner "reconectando…".
- `AssetProxy` `/hh/*` + `HabboAssetsClient` com rate limiter e cache em disco; Vite proxy em dev.

**Como testar:** `npm run dev`; abrir duas abas (ou janela anônima), entrar com nomes diferentes e o código do `.env`; andar numa e ver o movimento suave na outra; código errado mostra erro; matar o servidor e subir de novo → as abas reconectam sozinhas; `npm test` cobre validação de payload e movimento autoritativo (servidor recusa destino em parede).

### Fase 3 — Editor de avatar completo + persistência ✅ implementada
- `assets:sync` gera o `avatar/manifest.json` (categorias, sets curados, paletas) a partir de `/imaging/info/clothing/*`; `--thumbs` pré-baixa as miniaturas para o cache do servidor.
- `shared/avatar.ts`: parser/serializer de figure string + `validateFigure(figure, manifest)` + testes.
- UI do editor: prévia com rotação, abas, miniaturas, seletores de cor, gênero, botão aleatório; acessível antes de entrar e por um botão no escritório.
- Mensagem `avatar.update` (atualiza todos na sala ao vivo) e visual/gênero no `POST /api/session`; localStorage guarda a última figure. (O `PUT /api/me/avatar` previsto ficou desnecessário: na entrada o visual vai na sessão e dentro do escritório pela sala.)
- Renderer local de fallback com camadas tingidas (sprites provisórios gerados por código).

**Como testar:** abrir o editor na entrada, trocar cabelo/roupa/cores e girar a prévia; entrar e ver o avatar; mudar o visual dentro do escritório e ver a outra aba atualizar; recarregar a página e o visual persistir; enviar uma figure adulterada via console (`room.send('avatar.update', {figure:'hr-99999-1'})`) e ver o erro; `npm test` cobre o parser/validador.

### Fase 4 — Chat com balões e histórico ✅ implementada
- Tabela `chat_messages` + `ChatService` (insere, poda para 200/sala, busca últimas 50).
- Mensagem `chat` com zod, rate limit, broadcast só na sala; `chat.history` no join.
- UI: campo de mensagem fixo embaixo (Enter envia), painel lateral recolhível com histórico (horário + nome), `textContent` sempre (nunca `innerHTML`).
- `ChatBubble` no Pixi: balão estilo Habbo acima do avatar, empilhamento de balões que sobem, some após ~6 s; texto renderizado com `Text` do Pixi (não interpreta HTML).

**Como testar:** duas abas na mesma sala trocam mensagens e veem balões sobre o avatar certo; histórico aparece ao recarregar; enviar `<img src=x onerror=alert(1)>` aparece como texto literal; mandar 10 mensagens seguidas → aviso de rate limit; `npm test` cobre rate limiter e sanitização/limites.

### Fase 5 — Várias salas e portas ✅ implementada
- Seed de Recepção, Sala de reunião e Copa com heightmaps e cores próprias + `room_doors`.
- Instâncias `office` filtradas por `officeRoomId`; pisar na porta → `room.transfer` com ticket de uso único → cliente troca de sala (fade) e nasce na porta de destino.
- Chat e presença isolados por sala; painel "Pessoas" com presentes de todas as salas (`GET /api/presence`) e da sala atual em destaque.
- URL reflete a sala (`#/meeting`) para recarregar no lugar certo.

**Como testar:** andar até a porta da Recepção e chegar na Sala de reunião; outra aba na Recepção deixa de ver você e não recebe seu chat; lista de pessoas mostra quem está onde; recarregar mantém a sala atual.

### Fase 6 — Decoração, catálogo, sentar, persistência das salas ✅ implementada
- `HabboAssetsClient` com token: importa furnidata dos itens curados para `furni_catalog`; `assets:sync` baixa renders/ícones; `GET /api/catalog`.
- `shared/placement.ts`: `canPlace(layout, furni[], item, x, y, rot)` (limites, tiles existentes, sobreposição, avatares no caminho, porta livre, tapete empilhável) + testes.
- Modo "editar sala" (botão com estado visível): catálogo por categoria, fantasma verde/vermelho seguindo o mouse, clique para colocar, arrastar para mover, `R` para girar, `Delete` para remover.
- Mensagens `furni.*` com validação no servidor, persistência em `room_furni`, broadcast via estado.
- `interact` → andar até a cadeira/sofá e sentar (`action='sit'`, `z = sitHeight`, direção do móvel); levantar ao andar.
- Ferramenta de calibração de offsets (dev-only) para o manifesto de mobis.

**Como testar:** entrar no modo editar, colocar mesa, cadeiras e tapete; tentar colocar sobre parede/avatar/porta → bloqueado; girar e mover; a outra aba vê tudo em tempo real; reiniciar o servidor e o layout continua; sair do modo editar e clicar numa cadeira → avatar senta; andar sobre o tapete e não atravessar a mesa; `npm test` cobre `placement`.

### Fase 7 — Acabamento, Docker, README, deploy ✅ implementada
- Polimento visual: sombra dos avatares, nomes sobre a cabeça ao passar o mouse, indicador de destino, transição entre salas, sons opcionais (HabboAssets `/sounds` ou CC0, mudo por padrão), layout responsivo (painéis viram gavetas em telas pequenas).
- `Dockerfile` multi-stage (build → runtime Node 24 slim, `data/` como volume), instruções para VPS (Docker + volume, ex. DigitalOcean/Hetzner) e `fly.toml` exemplo com Persistent Volume; healthcheck `GET /healthz`.
- README completo (rodar local, `.env`, token HabboAssets, `assets:sync`, adicionar assets locais, deploy); `ASSETS.md` final.
- Revisão de segurança leve (headers, limites de payload, logs) e testes finais.

**Como testar:** `docker build -t office . && docker run -p 2567:2567 -e INVITE_CODE=... -v $(pwd)/data:/app/data office` → abrir `http://localhost:2567` e repetir o roteiro das fases 2–6; seguir o README do zero numa pasta limpa; deploy de teste no provedor escolhido e acesso de dois dispositivos.

---

## 9. Riscos e dúvidas

### Riscos técnicos
1. **Sem animação de caminhada no imager.** `/imaging/avatar.png` só renderiza a pose em pé (testado: `action=wlk|sit` não funcionam). Mitigação v1: animação procedural sobre o render parado. Alternativa fiel (renderizar partes a partir das bibliotecas `.nitro` de roupas, como o Nitro faz) é um projeto grande por si só.
2. **Âncora/offset das PNGs de mobis.** O imager devolve a imagem recortada, sem ponto de registro; precisamos calibrar offsets por item e direção (catálogo curado pequeno torna isso viável). Mobis com animação/camadas separadas (encosto da cadeira) vêm "achatados" numa PNG — o avatar sentado pode ficar levemente na frente do encosto.
3. **Rate limit.** REST 240/min; renders não cacheados 60/min por IP. Mitigado com proxy + cache em disco + `assets:sync` antecipado; em produção o servidor nunca deveria precisar renderizar algo novo, exceto avatares com figure inédita (≤ 8 renders por troca de visual).
4. **Token de furniture.** Os endpoints de mobis exigem token pessoal da HabboAssets; ele fica só no servidor (`HABBOASSETS_API_KEY`). Sem token, usamos só o imager + dados de footprint escritos à mão no manifesto.
5. **CORS.** Hoje a API e o imager respondem `Access-Control-Allow-Origin: *`, então carregar texturas WebGL direto funciona; se mudar, o proxy same-origin já cobre.
6. **Disponibilidade/terceiros.** A HabboAssets é um arquivo comunitário; se cair ou mudar a API, o cache em disco + placeholders mantêm o app funcionando.
7. **Direitos dos assets.** Os gráficos são da Sulake/Habbo, espelhados pela HabboAssets ("não afiliada"). OK para uso pessoal e privado (atrás de código de convite); não recomendável deixar público/indexado.
8. **Ordenação isométrica com móveis multi-tile** é a fonte clássica de bugs visuais; mitigada com caixas de footprint, sort topológico e testes de cenário.
9. **Colyseus** muda de API entre versões: a 0.18 (atual em out/2026) é a usada, com versões exatas fixadas no `package.json` (`@colyseus/core`, `schema`, `sdk`, `ws-transport`, `testing`).
10. **Cloudflare na HabboAssets** (descoberto na Fase 1): requisições com User-Agent de script (ex. Python) recebem 403; `fetch` do Node 24 passa. O `HabboAssetsClient` vai enviar um User-Agent identificando o projeto.
11. **Redirect 302 sem `revision`** (descoberto na Fase 1): o imager redireciona para a URL com a revisão fixada. Por isso o manifesto de mobis guarda `revision` de cada item.

### Notas da Fase 1
- Versões instaladas: Pixi 8.22, Vite 8.3, Vitest 5.0, TypeScript 6.0, zod 4.6, ESLint 10.
- Âncoras dos mobis: medidas pelo pixel opaco mais baixo da PNG (cai no vértice de baixo do footprint); conferidas visualmente com `?debug=1`. Convenções confirmadas nos renders: direção do móvel = direção para onde ele "olha" (0 = −y, 2 = +x), e móveis 2×1 se estendem em x na rotação 0.
- Pés do avatar no render 64×110: pixel (32, 104).
- `shared/tsconfig.json` não inclui tipos do Node (código puro); os testes usam `shared/tsconfig.test.json`.
- Fase 1 trata cadeiras como não-destino (`seatsAsGoal: false`) até existir "sentar" (Fase 6).

### Decisões tomadas (aprovadas em 16/10/2026)
1. **Animação de caminhada:** render parado do imager + bob/balanço procedural na v1. Renderer de partes `.nitro` fica fora da v1 (a interface `AvatarRenderer` deixa a porta aberta).
2. **Token HabboAssets:** sim, token gratuito lido de `HABBOASSETS_API_KEY` (só no servidor) para importar furnidata e nomes PT-BR. Sem a variável, o app continua funcionando com imager + manifesto manual.
3. **Quem pode decorar:** qualquer pessoa conectada (entrou com o código de convite) pode usar o modo editar.
4. **Nomes:** livres e podem repetir; só bloqueamos (erro `NAME_IN_USE`, sugerindo um sufixo) quando alguém **online no momento** já usa o mesmo nome. A identidade real é o token do navegador.
5. **Deploy:** VPS simples (DigitalOcean/Hetzner) com Docker, ou Fly.io com Persistent Volume. Local: SQLite em arquivo (`DATABASE_PATH=./data/sqlite.db`).
6. **Idioma:** 100% PT-BR — interface, botões, mensagens de erro, chat e instruções.

### Notas da Fase 2
- **Colyseus 0.18 em vez de 0.16** (mesma biblioteca; só a versão atual). Usamos `@colyseus/core` + `ws-transport` direto, sem o pacote `colyseus` (que puxa Redis, auth e monitor). Mensagens validadas com `validate(zodSchema, handler)`.
- Estado em `shared/src/state.ts`; protocolo (nomes de mensagens, schemas zod, códigos e textos de erro em PT-BR) em `shared/src/protocol.ts`.
- Serviços do servidor (`UserService`, `PresenceRegistry`, `RoomRepository`) ficam num registro do processo (`setServices`), porque as salas são instanciadas pelo Colyseus.
- Token da sessão: 24 bytes aleatórios no navegador; no banco só o SHA-256. Com token válido o convite não é pedido de novo. `POST /api/session` limitado a 10 tentativas/min por IP.
- Proxy `/hh/avatar.png` e `/hh/furniture/{classname}.png` com cache em disco (`data/asset-cache`), deduplicação de downloads simultâneos e `Cache-Control: immutable` para URLs com revisão fixada. O cliente tenta o proxy primeiro e o imager direto como reserva.
- Em dev, `/api` e `/hh` passam pelo proxy do Vite; o WebSocket vai direto para `:2567` (CORS do Colyseus).
- `npm run bot -- Nome N` coloca N robôs andando pela Recepção (útil para testar sozinho).
- Testes de integração com `@colyseus/testing` (servidor real em memória): entrada com/sem token, dois usuários se vendo, movimento autoritativo, saída e "fantasma" de reconexão.
- Nomes aparecem sempre sobre os avatares (antecipado da Fase 7, ajuda a testar com várias pessoas).

### Notas da Fase 3
- Editor (`client/src/ui/avatarEditor.ts`): prévia `size=l` com rotação nas 8 direções, gênero, aleatório, 9 abas, grade de miniaturas e cores da paleta (1 ou 2 cores conforme a peça). Prévia com debounce de 250 ms: proxy → imager direto → avatar provisório em camadas.
- Miniaturas: imagem da peça no boneco "fantasma" (`/imaging/clothing/set/{id}.png`), servidas pelo proxy `/hh/clothing/set/…` com cache de 30 dias. A HabboAssets não tem imagens estáticas por set para as bibliotecas base, por isso o `assets:sync --thumbs` (269 de 270 baixadas; a peça de óculos #1404 dá 502 na própria HabboAssets e o editor mostra o número no lugar).
- Visual novo na sala leva alguns segundos para aparecer para todos: são 8 renders novos (um por direção) passando pelo limite de requisições do servidor; depois ficam em cache.
- Peças "Habbo Club" entram normalmente (aqui não há assinatura); só cores marcadas como selecionáveis aparecem.
- Gênero salvo em `users.gender` e validado junto com a figure (peças `U` servem para os dois).

### Notas da Fase 4
- Histórico pedido por requisição (`chat.history`), como o layout, para não perder mensagens enviadas antes de o cliente registrar o handler.
- `chat_messages` com índice `(room_id, id)`; a cada mensagem nova o servidor apaga as que passam de 200 na sala. O nome é gravado na hora (`name_snapshot`).
- Texto normalizado no servidor (`normalizeChatText`): caracteres de controle, de largura zero e de direção (bidi) viram espaço; quebras de linha viram espaço. HTML não é removido: é mostrado literalmente (`textContent` no DOM e `Text` no Pixi).
- Balões (`client/src/entities/ChatBubble.ts`): "Nome: mensagem" com rabicho, quebra em até 220 px, ficam no x de quem falou, sobem quando chega outro e somem em 7 s (máx. 10 na tela). O nome da própria pessoa sai em azul.
- Painel "Conversa" recolhível (aberto por padrão em telas largas), com contador de novas quando fechado. Enter em qualquer lugar foca o campo; Esc sai.
- O robô de teste (`npm run bot`) agora fala frases de vez em quando, para testar os balões sozinho.

### Notas da Fase 5
- **Bug encontrado pelos testes:** com `filterBy(['roomId'])` todo mundo caía na mesma instância, porque `roomId` também é o id interno de cada sala Colyseus. A opção de entrada virou `officeRoomId`.
- Salas e portas continuam definidas em `shared/rooms.ts` (não há editor de salas na v1) e são sincronizadas no banco a cada boot: `rooms` por upsert e `room_doors` recriada. Os móveis passam para o banco na Fase 6.
- A Recepção ganhou uma linha a mais no topo para a porta da Copa; os móveis desceram um tile.
- Portas: tile do heightmap fora da parede, destacado em azul com "→ Destino" ao passar o mouse. Ao terminar um passo numa porta (`MovementSystem.onStepEnd`), o servidor emite um ticket de uso único (30 s) e manda `room.transfer`; o cliente sai com consentimento, escurece a tela e entra na outra sala com o ticket, nascendo do lado de dentro da porta de volta.
- `shared/rooms.test.ts` valida cada sala: móveis dentro e sem sobreposição, portas alcançáveis a partir da entrada, destino livre e porta de volta existente.
- Lista de pessoas: a sala atual ao vivo pelo estado; as outras por `GET /api/presence` a cada 10 s.
- URL reflete a sala (`#/meeting`); recarregar entra direto nela.
- Novo móvel: máquina de café (`sunsetcafe_c20_coffeemachine`), na Copa.

### Notas da Fase 6
- **Desvio do plano (para validar):** o catálogo de móveis ficou no manifesto JSON (`client/public/assets/furni/manifest.json`), sem a tabela `furni_catalog` nem o `GET /api/catalog`. O manifesto já é versionado, servido estático e lido pelo servidor para validar; uma tabela só duplicaria os dados. Se preferir a tabela, dá para migrar depois sem mudar o protocolo.
- Catálogo com 28 móveis em 8 categorias (cadeiras, sofás, mesas, plantas, estantes, escritório, cozinha, tapetes). Curadoria em `server/src/assets/furniCatalog.ts`; o `assets:sync` baixa os renders, mede **âncora** (pixel opaco mais baixo) e **tamanho** (distância da âncora até a borda esquerda em duas direções) e escreve o manifesto. A medição bateu com todos os tamanhos já conhecidos; os sem tamanho na curadoria usam a estimativa (ex.: sofá executivo 3×1, conferido no navegador). Isso substituiu a "ferramenta de calibração" prevista.
- **Sem token da HabboAssets:** `HABBOASSETS_API_KEY` não está configurado, então a leitura da furnidata (`/furniture/{classname}`) está implementada de forma tolerante, mas **não foi verificada** contra a resposta real. Os dados atuais vêm só do imager público + curadoria.
- Regras de colocação em `shared/placement.ts` (as mesmas no cliente, para o fantasma verde/vermelho, e no servidor, que decide): dentro da sala, piso plano, sem cobrir portas/entrada/tile de chegada, sem sobrepor (móvel sólido pode ficar em cima de tapete), sem esmagar avatar e sem bloquear o caminho da entrada até nenhuma porta. Limite de 150 móveis por sala.
- Móveis iniciais de `shared/rooms.ts` são inseridos uma única vez (`rooms.furni_seeded`); depois o layout é das pessoas.
- Sentar: assento só vale como destino para quem clicou nele. A pose sentada é simulada (o imager não tem): corpo na altura do assento, um pouco mais baixo, com as pernas escondidas por máscara. Andar levanta.
- Cliques em móveis usam teste por pixel (alfa da imagem), então clicar no encosto de uma cadeira senta, e clicar no piso ao lado anda.
- Modo decorar: botão "Decorar" (qualquer pessoa na sala). Catálogo com miniaturas, clique para colocar (o item continua escolhido para colocar vários), clique para selecionar, arrastar para mover, R gira, Delete remove, Esc cancela. O chat fica escondido enquanto se decora.
- **Bug corrigido nos testes:** o `MovementSystem` sobrescrevia a ação "sit" com "idle" depois do gancho de fim de passo.

### Notas da Fase 7
- **Produção = um processo:** `node --import tsx server/src/index.ts` serve `client/dist`, a API e o WebSocket. O `tsx` virou dependência de execução (o servidor roda direto do TypeScript; sem etapa de build do servidor).
- **Docker:** build multi-stage em `node:24-bookworm-slim`; `npm ci --ignore-scripts` (o better-sqlite3 13 já traz binários para Linux). O entrypoint ajusta a dona da pasta de dados (volumes chegam como root) e troca para o usuário `node` com `setpriv`. Healthcheck em `/healthz`. `docker-compose.yml` para VPS e `fly.toml` com volume e máquina sempre ligada.
- **Testado de ponta a ponta no container** (OrbStack, arm64): entrada com convite, token antigo recusado, chat, decorar, reinício do container com reconexão automática e móveis persistidos no volume.
- **CSP de produção** sem `unsafe-eval`: o Pixi precisa de `import 'pixi.js/unsafe-eval'` (troca o `eval` dos shaders por código pronto); descoberto pelo teste no container.
- Cabeçalhos: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. `trust proxy` = 1 em produção (IP real atrás de Caddy/Fly para o limite de tentativas de entrada). Mensagens WebSocket limitadas a 4 KB (padrão do transporte). Logs de entrada/saída por sala.
- **Primeira carga mais rápida:** o limite local para o imager subiu para rajada de 20 e 45/min (ainda abaixo dos 60/min públicos) e o proxy responde 503 após 2 s de espera, para o cliente cair logo no imager direto em vez de esperar na fila.
- **Telas pequenas:** controles de câmera numa linha no topo; zoom automático de 0,5× quando a tela é bem mais estreita que a sala (celular); 1× nos demais casos.
- Acabamento: favicon, som de mensagem opcional (desligado por padrão, lembrado no navegador), móveis com arte local (`source: 'local'`), aviso de token expirado na entrada, `?debug=1` expõe o estado também em produção.
- Os nomes ficam sempre visíveis sobre os avatares (decisão da Fase 2), em vez de só ao passar o mouse.
- Não feito por falta de conta/credenciais: deploy real em VPS/Fly e teste com token da HabboAssets.

