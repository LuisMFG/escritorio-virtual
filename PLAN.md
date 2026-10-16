# PLAN — Escritório virtual isométrico

> Documento vivo. Atualizar sempre que o plano mudar (ver "Como trabalhar" no SPEC.md).
> Status: **aprovado em 16/10/2026** — Fase 1 concluída (aguardando validação). Decisões registradas na §9.

---

## 1. Decisões de stack

| Área | Escolha | Por quê |
|---|---|---|
| Linguagem / monorepo | TypeScript + **npm workspaces** (`client`, `server`, `shared`) | Zero ferramenta extra (sem Turborepo/pnpm); `shared` é importado como pacote `@office/shared` pelos dois lados. |
| Renderização | **PixiJS v8** (não Phaser 3) | Precisamos só de um renderer 2D rápido com controle total de ordenação de profundidade e texturas; Phaser traria física, cenas e loader que não usaríamos e brigaria com nosso sort isométrico próprio. |
| UI | HTML/CSS puro + TypeScript (sem framework) | Chat, catálogo, editor e lista são poucos painéis; manter DOM simples evita mais uma dependência. Se a UI crescer, reavaliar (Preact). |
| Tempo real | **Colyseus 0.16** (não Socket.IO) | Já entrega exatamente o modelo do SPEC: salas com estado autoritativo, sincronização por diffs binários, `onAuth`, e reconexão (`allowReconnection`) prontos — com Socket.IO teríamos que escrever tudo isso. |
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

furni_catalog  { id: text pk (classname), name: text, category: text,
                 width: int, depth: int, height: real,     // footprint e altura de empilhar
                 canSit: bool, canWalk: bool (tapete), canStack: bool, sitHeight: real,
                 directions: text (json [0,2,4,6]), colors: text (json),
                 offsets: text (json {dir: [ox, oy]}),     // âncora calibrada da PNG
                 source: 'habboassets'|'local', revision: int }

room_furni     { id: text pk, roomId: fk rooms, catalogId: fk furni_catalog,
                 x: int, y: int, z: real, rot: int (0|2|4|6), color: int null,
                 placedBy: fk users null, updatedAt: int }

chat_messages  { id: int pk, roomId: fk rooms, userId: fk users, nameSnapshot: text,
                 text: text, createdAt: int }   // manter últimas 200 por sala
```

A aparência fica no próprio `users.figure` (figure string Habbo, ex. `hd-180-1.ch-210-66.lg-270-82.sh-290-80`). Se mais tarde quisermos histórico de visuais, extrai-se uma tabela `avatars`.

### 4.2 Estado sincronizado em tempo real (Colyseus `@colyseus/schema`)

```ts
class Player extends Schema {
  @type('string') id;          // users.id
  @type('string') name;
  @type('string') figure;
  @type('uint8')  x; @type('uint8') y; @type('float32') z;
  @type('uint8')  dir;          // 0–7 (direções Habbo)
  @type('string') action;       // 'idle' | 'walk' | 'sit'
  @type('uint8')  nextX; @type('uint8') nextY;  // passo em andamento (interpolação)
  @type('uint32') stepStartedAt;
}

class Furni extends Schema {
  @type('string') id; @type('string') catalogId;
  @type('uint8') x; @type('uint8') y; @type('float32') z;
  @type('uint8') rot; @type('uint8') color;
  @type('string') occupiedBy;   // id do player sentado, '' se livre
}

class OfficeState extends Schema {
  @type('string') roomId;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Furni })  furni   = new MapSchema<Furni>();
}
```

Layout estático (heightmap, portas, cores) é enviado uma vez no join via mensagem `room.layout` (não muda durante a sessão). Chat **não** fica no estado: é broadcast efêmero + histórico vindo do banco.

---

## 5. Protocolo de rede

### 5.1 HTTP

| Rota | Payload → Resposta |
|---|---|
| `POST /api/session` | `{ name, inviteCode, figure, token? }` → `{ userId, token, name, figure }` (cria ou reaproveita usuário; token salvo no localStorage; erro `NAME_IN_USE` se o nome estiver em uso por alguém online) |
| `PUT /api/me/avatar` | `{ figure, gender }` (header `Authorization: Bearer token`) → `{ figure }` |
| `GET /api/catalog` | → lista do `furni_catalog` com URLs `/hh/...` |
| `GET /hh/*` | proxy/cache de imagens do imager |

### 5.2 Colyseus — join

`client.joinOrCreate('office', { roomId: 'reception', token })` → `onAuth` valida o token e devolve o usuário; código de convite é checado só no `/api/session`. Cada sala física é uma instância Colyseus `office` com `filterBy(['roomId'])`.

### 5.3 Mensagens cliente → servidor (todas validadas com zod)

| Tipo | Payload | Regras no servidor |
|---|---|---|
| `move` | `{ x, y }` | rate limit 5/s; A* no servidor a partir da posição atual; rejeita destino inválido |
| `chat` | `{ text }` | 1–200 chars, trim, rate limit 3 msgs/5 s; texto tratado como texto puro |
| `door.use` | `{ doorId }` | jogador precisa estar no tile da porta (também disparado automaticamente ao pisar) |
| `furni.place` | `{ catalogId, x, y, rot, color? }` | modo editar; `placement.canPlace` |
| `furni.move` | `{ furniId, x, y }` | idem; não pode haver alguém sentado |
| `furni.rotate` | `{ furniId, rot }` | idem, recalcula footprint |
| `furni.remove` | `{ furniId }` | idem |
| `interact` | `{ furniId }` | se `canSit`: caminha até o tile do móvel e senta (dir = rot do móvel) |
| `avatar.update` | `{ figure, gender }` | valida contra manifesto; persiste; atualiza `Player.figure` |
| `typing` | `{ on: boolean }` | opcional, indicador "digitando…" |

### 5.4 Mensagens servidor → cliente

| Tipo | Payload |
|---|---|
| `room.layout` | `{ roomId, name, heightmap, doors[], wallColor, floorColor }` |
| `chat.message` | `{ id, userId, name, text, ts }` |
| `chat.history` | `{ messages: ChatMessage[] }` (últimas 50, no join) |
| `room.transfer` | `{ targetRoomId, ticket }` — cliente sai e entra na outra sala com o ticket (spawn na porta de destino) |
| `room.presence` | derivado do estado (`players`); lista de presentes de todas as salas via `GET /api/presence` (polling 10 s) |
| `error` | `{ code: 'RATE_LIMIT'|'INVALID_MOVE'|'INVALID_PLACEMENT'|…, message }` |

Movimento: o servidor roda um tick de 50 ms; cada passo dura 500 ms (2 tiles/s, diagonal igual — estilo Habbo). Ao iniciar um passo ele seta `nextX/nextY/stepStartedAt/dir/action='walk'`; o cliente interpola de `(x,y)` a `(next)` pelo tempo decorrido. Reconexão: `allowReconnection(client, 30)` no servidor + `client.reconnect(reconnectionToken)` com backoff exponencial no cliente.

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
- **Manifesto `client/public/assets/avatar/manifest.json`** (curado, gerado por `assets:sync` e revisado à mão):
  ```json
  { "version": 1, "hotelId": 2,
    "imager": "https://www.habboassets.com/imaging/avatar.png",
    "palettes": { "skin": [1,2,3,…], "hair": […], "clothes": […] },   // id → hex para os seletores
    "categories": [
      { "type": "hr", "label": "Cabelo", "palette": "hair", "required": false,
        "sets": [{ "id": 115, "gender": "U", "colorable": true, "preview": "/hh/clothing/set/115.png" }] } ],
    "defaults": { "M": "hd-180-1.ch-210-66.lg-270-82.sh-290-80", "F": "…" },
    "local": { "layers": [ … ] }   // sprites locais opcionais (fallback)
  }
  ```
  O servidor importa o mesmo arquivo para validar: cada `set` deve existir na categoria e gênero, cada cor na paleta, categorias obrigatórias (`hd`, `lg`, `ch`) presentes, máx. 1 set por tipo, string ≤ 512 chars.
- **Recoloração:** com o imager, a recoloração é feita pelo próprio Habbo via ids de paleta na figure string (os seletores do editor mostram as cores hex da paleta e gravam o id). No renderer local de fallback, cada peça é uma sprite em tons de cinza tingida com `sprite.tint = hex` (multiply), igual ao método do Habbo.
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

### Fase 2 — Servidor em tempo real, vários usuários, tela de entrada
- Servidor Express + Colyseus no mesmo http server; `config.ts` com `INVITE_CODE`, `PORT`, `DATABASE_PATH`, `HABBOASSETS_API_KEY`.
- Drizzle: schema `users`, `rooms`, migrations, seed da Recepção.
- `POST /api/session` (nome + convite → token; nome pode repetir, só é recusado se alguém **online agora** já usa o mesmo nome — comparação sem maiúsculas/acentos), `onAuth` no Colyseus.
- `OfficeRoom` com `OfficeState`; `MovementSystem` usando o A* compartilhado no servidor; tick 50 ms; rate limit de `move`.
- Cliente: tela de entrada (nome + código, lembra nome/token em localStorage), conexão Colyseus, `AvatarView` para cada `Player` com interpolação, lista de presentes, reconexão automática com backoff e banner "reconectando…".
- `AssetProxy` `/hh/*` + `HabboAssetsClient` com rate limiter e cache em disco; Vite proxy em dev.

**Como testar:** `npm run dev`; abrir duas abas (ou janela anônima), entrar com nomes diferentes e o código do `.env`; andar numa e ver o movimento suave na outra; código errado mostra erro; matar o servidor e subir de novo → as abas reconectam sozinhas; `npm test` cobre validação de payload e movimento autoritativo (servidor recusa destino em parede).

### Fase 3 — Editor de avatar completo + persistência
- `assets:sync` gera o `avatar/manifest.json` (categorias, sets PT-BR curados, paletas) a partir de `/swfs/libraries?kind=clothing` + `/imaging/info/clothing/*`; revisão manual da curadoria.
- `shared/avatar.ts`: parser/serializer de figure string + `validateFigure(figure, manifest)` + testes.
- UI do editor: prévia com rotação, abas, miniaturas, seletores de cor, gênero, botão aleatório; acessível antes de entrar e por um botão no escritório.
- `PUT /api/me/avatar` e mensagem `avatar.update` (atualiza todos na sala ao vivo); localStorage guarda a última figure.
- Renderer local de fallback com camadas tingidas (sprites provisórios gerados por código).

**Como testar:** abrir o editor na entrada, trocar cabelo/roupa/cores e girar a prévia; entrar e ver o avatar; mudar o visual dentro do escritório e ver a outra aba atualizar; recarregar a página e o visual persistir; enviar uma figure adulterada via console (`room.send('avatar.update', {figure:'hr-99999-1'})`) e ver o erro; `npm test` cobre o parser/validador.

### Fase 4 — Chat com balões e histórico
- Tabela `chat_messages` + `ChatService` (insere, poda para 200/sala, busca últimas 50).
- Mensagem `chat` com zod, rate limit, broadcast só na sala; `chat.history` no join.
- UI: campo de mensagem fixo embaixo (Enter envia), painel lateral recolhível com histórico (horário + nome), `textContent` sempre (nunca `innerHTML`).
- `ChatBubble` no Pixi: balão estilo Habbo acima do avatar, empilhamento de balões que sobem, some após ~6 s; texto renderizado com `Text` do Pixi (não interpreta HTML).

**Como testar:** duas abas na mesma sala trocam mensagens e veem balões sobre o avatar certo; histórico aparece ao recarregar; enviar `<img src=x onerror=alert(1)>` aparece como texto literal; mandar 10 mensagens seguidas → aviso de rate limit; `npm test` cobre rate limiter e sanitização/limites.

### Fase 5 — Várias salas e portas
- Seed de Recepção, Sala de reunião e Copa com heightmaps e cores próprias + `room_doors`.
- Instâncias `office` filtradas por `roomId`; pisar na porta → `room.transfer` com ticket de uso único → cliente troca de sala (fade) e nasce na porta de destino.
- Chat e presença isolados por sala; painel "Pessoas" com presentes de todas as salas (`GET /api/presence`) e da sala atual em destaque.
- URL reflete a sala (`#/meeting`) para recarregar no lugar certo.

**Como testar:** andar até a porta da Recepção e chegar na Sala de reunião; outra aba na Recepção deixa de ver você e não recebe seu chat; lista de pessoas mostra quem está onde; recarregar mantém a sala atual.

### Fase 6 — Decoração, catálogo, sentar, persistência das salas
- `HabboAssetsClient` com token: importa furnidata dos itens curados para `furni_catalog`; `assets:sync` baixa renders/ícones; `GET /api/catalog`.
- `shared/placement.ts`: `canPlace(layout, furni[], item, x, y, rot)` (limites, tiles existentes, sobreposição, avatares no caminho, porta livre, tapete empilhável) + testes.
- Modo "editar sala" (botão com estado visível): catálogo por categoria, fantasma verde/vermelho seguindo o mouse, clique para colocar, arrastar para mover, `R` para girar, `Delete` para remover.
- Mensagens `furni.*` com validação no servidor, persistência em `room_furni`, broadcast via estado.
- `interact` → andar até a cadeira/sofá e sentar (`action='sit'`, `z = sitHeight`, direção do móvel); levantar ao andar.
- Ferramenta de calibração de offsets (dev-only) para o manifesto de mobis.

**Como testar:** entrar no modo editar, colocar mesa, cadeiras e tapete; tentar colocar sobre parede/avatar/porta → bloqueado; girar e mover; a outra aba vê tudo em tempo real; reiniciar o servidor e o layout continua; sair do modo editar e clicar numa cadeira → avatar senta; andar sobre o tapete e não atravessar a mesa; `npm test` cobre `placement`.

### Fase 7 — Acabamento, Docker, README, deploy
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
9. **Colyseus 0.16** tem API que muda entre versões; vamos fixar versões exatas no `package.json`.
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
