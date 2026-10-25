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
users          { id: text pk (uuid), name: text,     // nome exibido; livre (ver §9)
                 username: text unique null,          // login (Fase 9); null = conta antiga
                 passwordHash: text null,             // scrypt$N$r$p$sal$hash
                 role: 'admin'|'member', cargoId: fk cargos null,
                 bio: text, birthday: text null ('MM-DD'),
                 figure: text, gender: 'M'|'F', createdAt: int, lastSeenAt: int }

sessions       { tokenHash: text pk (SHA-256), userId: fk users (cascade),
                 createdAt: int, lastUsedAt: int }    // um por aparelho (Fase 9)

cargos         { id: int pk, name: text unique, color: text ('#rrggbb'), sort: int }

settings       { key: text pk, value: text }      // Fase 10: 'invite_code'
audit_log      { id: int pk, at: int, actorId: fk users, action: text,
                 targetUserId: fk users null, details: text }
users          … + disabled: bool                  // Fase 10
rooms          … + decorLocked: bool               // Fase 10
rooms          … + sort: int                        // Fase 13 (ordem nas listas)
users          … + canEditRooms: bool               // Fase 13

direct_messages { id: int pk, fromUserId: fk users, toUserId: fk users, text: text,
                  createdAt: int, readAt: int null }   // Fase 11; até 1000 por conversa

chat_messages   … + replyToId: fk chat_messages null (on delete set null)    // Fase 12
direct_messages … + replyToId: fk direct_messages null (on delete set null)  // Fase 12
chat_reactions  { messageId: fk chat_messages (cascade), userId, emoji } pk(os três)
room_furni      … + state: int                        // Fase 14
rooms           … + ambient: 'none'|'office'|'cafe'|'rain' // Fase 14
board_notes     { id, furniId: fk room_furni (cascade), userId, text, color, createdAt }
whiteboard_strokes { id, furniId: fk room_furni (cascade), userId, data: json, createdAt } // Fase 15
meetings        { id, title, description, roomId: fk rooms (cascade), startsAt, durationMin, createdBy, createdAt, remindedAt } // Fase 16
meeting_attendees { meetingId: fk meetings (cascade), userId, response: 'pending'|'yes'|'no' } pk(meetingId, userId)
chat_messages   … + kind: 'text'|'dice'|'coin'|'game'   // Fase 17
game_scores     { userId, game ('tictactoe'), wins, losses, draws } pk(userId, game)
pets            { userId pk, name, species: 'dog'|'cat'|'bunny'|'chick', color 0–2, createdAt } // Fase 18
user_achievements { userId, achievementId, unlockedAt } pk(userId, achievementId)   // Fase 19
user_stats      { userId, key, value } pk(userId, key)   // contadores das conquistas
user_visits     { userId, roomId: fk rooms (cascade) } pk(userId, roomId)
users           … + badges: text (até 3 ids exibidos no cartão)
users           … + codeShare: 'hidden'|'coding'|'language'|'project'   // Fase 20
api_tokens      { id, userId, name, tokenHash (sha256, único), createdAt, lastUsedAt }
spotify_links   { userId pk, refreshToken, accessToken, expiresAt, displayName, hidden, createdAt } // Fase 21
dm_reactions    { messageId: fk direct_messages (cascade), userId, emoji } pk(os três)

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
| `POST /api/register` | `{ inviteCode, username, password, name, figure?, gender? }` → `SessionResponse` (erros `INVALID_INVITE`, `USERNAME_TAKEN`, `NAME_IN_USE`, `INVALID_FIGURE`) |
| `POST /api/login` | `{ username, password }` → `SessionResponse` (nova sessão; `INVALID_CREDENTIALS` sem dizer se o usuário existe) |
| `GET /api/me` | (Bearer) → `SessionResponse` — o cliente entra direto com o token salvo |
| `PATCH /api/me` | (Bearer) `{ name?, bio?, birthday? }` → `SessionResponse` |
| `POST /api/me/claim` | (Bearer) `{ username, password }` — conta antiga escolhe login |
| `POST /api/me/password` | (Bearer) `{ current, next }` — derruba as outras sessões |
| `POST /api/logout` | (Bearer) `{ all? }` |
| `GET /api/team` | (Bearer) → `{ members[], cargos[] }` |
| `PUT /api/users/:id/cargo` | (Bearer, admin) `{ cargoId \| null }` |
| `GET /api/admin` | (admin) → `{ inviteCode, rooms[], users[], cargos[] }` |
| `GET /api/admin/audit` | (admin) → últimas 200 ações |
| `PUT /api/admin/invite` | (admin) `{ inviteCode }` |
| `PUT /api/admin/rooms/:id` | (admin) `{ decorLocked }` |
| `PATCH /api/admin/users/:id` | (admin) `{ role?, cargoId?, disabled? }` |
| `POST /api/admin/users/:id/password` | (admin) → `{ password }` (senha temporária, mostrada uma vez) |
| `POST /api/admin/users/:id/kick` | (admin) `{ scope: 'room' \| 'office' }` |
| `POST/PATCH/DELETE /api/admin/cargos[/:id]`, `PUT /api/admin/cargos/order` | (admin) cargos |
| `GET /api/rooms` | (sessão) → `[{ id, name }]` |
| `GET/PUT/DELETE /api/rooms/:id`, `POST /api/rooms` | (admin ou `canEditRooms`) editor de salas |

`SessionResponse = { userId, token, username, name, figure, gender, role, cargo, bio, birthday }`. Entrada, cadastro e troca de senha: 10 tentativas/min por IP.
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
| `chat.delete` | `{ id }` | quem escreveu ou admin; apaga e faz broadcast `chat.deleted` |
| `furni.place` | `{ defId, x, y, rot }` | rate limit 10 + 4/s; `canPlace` (shared); persiste em `room_furni` |
| `furni.move` | `{ furniId, x, y, rot }` | mover e/ou girar; idem; recusado se alguém está sentado nele |
| `furni.remove` | `{ furniId }` | idem |
| `interact` | `{ furniId }` | se `canSit`: anda até o assento livre mais perto e senta (`action='sit'`, `z = z do móvel + sitHeight`, dir = rot do móvel) |
| `avatar.update` | `{ figure, gender }` | valida contra manifesto; persiste; atualiza `Player.figure` |
| `typing` | `{ on: boolean }` | rate limit 6 + 3/s (excesso é ignorado em silêncio); seta `Player.typing`; zera ao enviar chat ou cair |
| `status.set` | `{ status: 'available'\|'busy'\|'away' }` | rate limit 5 + 1/s; seta `Player.status` |
| `emote` | `{ emote: 'wave'\|'laugh'\|'thumbs'\|'heart'\|'coffee'\|'dance' }` | rate limit 3 + 0,5/s; broadcast `emote.played` |

### 5.4 Mensagens servidor → cliente

| Tipo | Payload |
|---|---|
| `chat.message` | `{ id, roomId, userId, sessionId, name, text, ts }` (broadcast só na sala) |
| `emote.played` | `{ sessionId, emote }` — todos na sala tocam a animação |
| `chat.deleted` | `{ id }` — some do histórico |
| `moderation.kicked` | `{ scope, message }` — da sala (vem um `room.transfer` para a Recepção) ou do escritório (a conexão fecha) |
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

### Fase 8 — Melhorias: emotes, status, cartão do avatar, digitando e menções ✅ implementada
Pedida depois de encerrar a v1 (o deploy na Oracle ficou para quando houver a VM).
- **Status:** `Player.status` (`available`/`busy`/`away`) sincronizado; seletor "Seu status" no painel de pessoas (salvo no navegador); bolinha vermelha/amarela na lista e sobre o avatar; vira "Ausente" sozinho após 5 min sem mexer mouse/teclado e volta ao mexer (se o escolhido não era "Ausente"). O antigo `away` continua significando "reconectando".
- **Emotes:** botão 😊 ao lado do chat ou comandos `/acenar`, `/rir`, `/joinha`, `/coracao`, `/cafe`, `/dancar` (sem diferenciar acentos). Animação procedural no corpo (balanço, pulinho, giro na dança) + emoji subindo; andar interrompe a dança. Catálogo em `shared/social.ts`.
- **Cartão do avatar:** nomes aparecem só ao passar o mouse; clicar num avatar abre um cartão (visual, nome, status, sala) com "Ir até" e "Mencionar" — ou "Meu visual" no próprio. Clique por pixel (`assets/hitTest.ts`, compartilhado com os móveis); avatar tem prioridade sobre cadeira e piso.
- **Digitando:** "•••" animado sobre o avatar enquanto a pessoa escreve (some após 4 s sem teclar, ao enviar ou ao sair do campo).
- **Menções:** `@` abre sugestões com quem está na sala (setas/Tab/Enter/clique); nomes com espaço e sem acento funcionam (`findMentions`, nome mais longo vence). Quem é mencionado vê o balão amarelo, a linha destacada no histórico, um aviso, um som próprio (se o som estiver ligado) e `(@n)` no título com a aba escondida.
- Robô de teste agora também faz emotes e menciona quem está na sala.
- Correção de passagem: o histórico do chat aberto não transborda mais a tela (Chrome embrulha o conteúdo do `<details>`).

**Como testar:** duas abas (uma anônima) ou `npm run bot -- Caio`. Passar o mouse num avatar → nome; clicar → cartão; "Mencionar" preenche `@Nome`; digitar `@` → sugestões; mandar a mensagem → a outra aba vê balão amarelo, aviso e linha destacada. Na outra aba aparece "•••" enquanto se digita. Botão 😊 e `/dancar` → animação nas duas abas. Trocar "Seu status" para Ocupado → bolinha vermelha nas duas abas; recarregar → continua Ocupado. Deixar uma aba 5 min parada → "Ausente"; mexer o mouse → volta.

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
4. **Nomes:** livres e podem repetir; só bloqueamos (erro `NAME_IN_USE`, sugerindo um sufixo) quando alguém **online no momento** já usa o mesmo nome. ~~A identidade real é o token do navegador.~~ Desde a Fase 9 a identidade é o **usuário** (login único com senha); o nome exibido continua livre.
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

### Deploy na Oracle Cloud (pós-v1)
- `docker-compose.yml` agora inclui o **Caddy** (HTTPS automático para `DOMAIN`, HTTP/2 e HTTP/3); o app só é exposto na rede interna do compose. Sem domínio próprio, `sslip.io` com o IP.
- `scripts/setup-oracle.sh` (Docker, regras no iptables das imagens Ubuntu da Oracle, swap em VMs de pouca memória) e `scripts/deploy.sh` (rsync + `docker compose up -d --build`, sem enviar `.env`/`data`).
- Guia: `docs/DEPLOY-ORACLE.md`. Testado localmente com `DOMAIN=localhost`: HTTPS, redirecionamento, CSP, API e WebSocket (WSS) pelo Caddy.


---

## 10. Roadmap v2 — escritório completo

Pedido em 17/10/2026, depois da Fase 8: deixar o escritório "muito completo". Mesmo fluxo de sempre: uma fase por vez, cada uma testada e aprovada. A ordem segue as dependências — identidade e papéis vêm primeiro, porque quase tudo depois (DMs, moderação, agenda, conquistas) precisa saber quem é quem e o que cada um pode fazer.

### Fase 9 — Contas com senha, cargos e perfil ✅ implementada
- **Contas:** nome de usuário único (login) + senha (hash `scrypt` do `node:crypto`, sem dependência nova). O código de convite continua sendo pedido só para **criar** a conta. Entrar em vários aparelhos: nova tabela `sessions` (um token por aparelho; "sair de todos os aparelhos" no perfil). Quem já tem conta pelo token do navegador entra normalmente e é convidado a definir usuário e senha.
- **Cargos:** tabela `cargos { id, nome, cor, ordem }`, começando com **Diretor, Coordenador de TI, Coordenador de Transparência Ativa, Coordenador de Transparência Passiva, Desenvolvedor e DBA**. O cargo aparece numa etiqueta colorida embaixo do nome sobre o avatar, no cartão e na lista de pessoas (agrupável por cargo).
- **Perfil:** bio curta (160 caracteres), cargo, aniversário (dia/mês, 🎂 no avatar e aviso para todos no dia) e "visto por último". Nova aba **Equipe** com todas as pessoas, online e offline.
- Modelo: `users` ganha `username` (único), `passwordHash`, `role` ('admin'|'member'), `cargoId`, `bio` e `birthday`; `Player` no estado ganha `cargo` e `role`.

**Como testar:** criar conta com convite, sair e entrar com usuário e senha em outra janela anônima (dois aparelhos); conta antiga define senha; cargo aparece sobre o avatar, no cartão e na lista; aba Equipe mostra quem está offline com "visto há X"; aniversário de hoje mostra 🎂.

**Notas da implementação:**
- Migrations `0004` (tabelas `cargos` e `sessions`, colunas novas em `users`, e cópia de cada token antigo para `sessions`, para ninguém ser deslogado) e `0005` (remove `users.session_token_hash`). Geradas em dois passos para o drizzle-kit não pedir confirmação interativa.
- Senhas com `scrypt` do `node:crypto` (N=16384, r=8, p=1, sal de 16 bytes), comparadas em tempo constante; login com usuário inexistente também roda o scrypt (contra um hash de mentira), para o tempo não revelar quem existe.
- Admin: `ADMIN_USERNAMES` no `.env` (conferido em cada cadastro/login/claim); sem a variável, a primeira conta com usuário vira admin. Na Fase 9 o admin só define cargos (na aba Equipe); o resto vem na Fase 10.
- O cliente entra direto com o token salvo (`GET /api/me`); a tela de entrada só aparece sem token ou depois de **Sair**. Conta antiga cai na tela "Crie seu acesso" (usuário sugerido a partir do nome).
- Estado: `Player` ganhou `cargo`, `cargoColor`, `role` e `birthday` (aniversário hoje, no fuso de Brasília). Mudanças de perfil/cargo emitem `users.events('updated')` e as salas abertas atualizam os avatares na hora.
- Cargo aparece com o nome ao passar o mouse (o nome sobe uma linha), como etiqueta colorida na lista e no cartão. O cartão busca bio, usuário e aniversário na Equipe.
- Botões do canto: **Perfil · Equipe · Decorar** ("Meu visual" foi para dentro do Perfil e do cartão).
- Robô de teste agora usa conta própria (`bot.<nome>`, cria se não existir).

### Fase 10 — Administração e moderação ✅ implementada
- Papel **admin** (o primeiro vem do `.env`, `ADMIN_USERNAMES`; depois um admin promove outros).
- Painel **Admin**: trocar o código de convite (vai para uma tabela `settings`; o `.env` vira só o valor inicial), gerenciar pessoas (cargo, papel, gerar senha temporária, desativar conta), gerenciar a lista de cargos.
- Moderação: expulsar da sala ou do escritório, apagar mensagem do chat, travar a decoração por sala ("todos" ou "só admins").
- Registro de ações (`audit_log`) visível para admins.

**Como testar:** admin troca o convite e o antigo para de funcionar; dá cargo a alguém e todos veem na hora; trava a decoração da Recepção e um membro não consegue decorar; expulsa um robô; apaga uma mensagem e ela some para todos; o registro mostra cada ação.

**Notas da implementação:**
- Migration `0006`: `settings`, `audit_log`, `users.disabled`, `rooms.decor_locked`.
- O código de convite passa a ser lido de `settings` (o `INVITE_CODE` do `.env` vale até um admin trocar pelo painel).
- Barramento `services.moderation` (`kick`, `room`): as rotas HTTP emitem e cada sala aberta aplica (tirar da sala = ticket para a Recepção; tirar do escritório = `client.leave(CONSENTED)`, sem prazo de reconexão, e as sessões da pessoa são apagadas — ela entra de novo com usuário e senha).
- Desativar conta: apaga as sessões, tira do escritório e o login responde `ACCOUNT_DISABLED`. Ninguém desativa a si mesmo; o escritório nunca fica sem admin; quem está no `ADMIN_USERNAMES` não é rebaixado pelo painel.
- Apagar mensagem: além do admin, **quem escreveu também pode** (pequena extensão do plano). Apagar mensagem de outra pessoa entra no registro com um trecho do texto.
- Decoração travada: `OfficeState.decorLocked`; para membros o botão Decorar fica desabilitado e o servidor recusa com `DECOR_LOCKED`.
- Painel **Admin** (botão só para admins) com abas Pessoas, Cargos, Convite e salas, Registro. Confirmações num diálogo do próprio app (`ui/confirm.ts`) em vez do `confirm()` do navegador. O cartão do avatar ganhou "Tirar da sala"/"Tirar do escritório" para admins.
- Se um admin muda o seu papel, o botão Admin aparece/some na hora (pelo `Player.role` no estado).
- Não verificado no navegador: a visão de um **membro** com a decoração travada (coberto pelo teste de integração) e a troca de convite pela tela (coberta pelos testes da rota).

### Fase 11 — Mensagens privadas e notificações do sistema ✅ implementada
- **Canal global:** uma sala Colyseus `lobby` em que todo mundo fica conectado, independente da sala física. Leva DMs, avisos e presença em tempo real (substitui a consulta a cada 10 s do `/api/presence`).
- **DMs:** tabela `direct_messages { id, from, to, texto, criadaEm, lidaEm }`; funciona entre salas e para quem está offline (lê quando voltar). Painel de conversas com contador de não lidas; "Mensagem" no cartão do avatar e na aba Equipe.
- **Notificações do navegador** (botão para ativar, pede permissão uma vez): menção, DM e, depois, lembrete de reunião, quando a aba não está visível.

**Como testar:** mandar DM para alguém em outra sala e para alguém offline; contador de não lidas; com a aba em segundo plano chega a notificação do sistema; a lista de pessoas das outras salas atualiza na hora.

**Notas da implementação:**
- Sala Colyseus `lobby` (`server/src/rooms/LobbyRoom.ts`), uma conexão a mais por pessoa, aberta depois de entrar na primeira sala. Estado `LobbyState.people` (por userId: nome, sala, status) espelha o `PresenceRegistry`, que agora emite `changed` a cada entrada, saída, troca de sala, de nome ou de status. A lista "outras salas" usa isso ao vivo (acabou a consulta a cada 10 s; o `GET /api/presence` continua existindo).
- Mensagens do lobby: `dm.send`, `dm.read`, requisições `dm.conversations` e `dm.history` (50 por página, "carregar anteriores"); o servidor manda `dm.message` para todas as conexões de quem enviou e de quem recebeu, e `dm.readReceipt { readerId, writerId, upToId }` (o "Visto" embaixo da última mensagem minha; outras abas de quem leu zeram o contador).
- Limites: 5 DMs seguidas e depois 1/s; não dá para mandar para si mesmo nem para conta desativada; tirar do escritório fecha também o lobby.
- Painel **Mensagens** (lateral): conversas com não lidas, "Nova conversa" (equipe, online primeiro), conversa com rascunho por pessoa. Botão com contador no canto; "(n)" no título da aba; aviso e som ao receber (se o painel não está naquela conversa). Também "Mensagem" no cartão do avatar e na Equipe.
- **Notificações do navegador** (`ui/notifications.ts`): botão 🔕/🔔 no painel Mensagens; a permissão só é pedida no clique. Notifica DM e menção quando a aba está escondida; clicar abre a conversa.
- Layout: com cinco botões no canto, abaixo de 1500 px de largura o campo do chat sobe para cima deles.
- `@colyseus/testing`: o `boot()` ignora a porta quando recebe um `Server` pronto; o teste do lobby sobe o servidor na 2569 por conta própria (os arquivos de teste rodam em paralelo).
- Robô de teste responde a DMs (e marca como lidas).
- Não verificado no navegador: o pedido de permissão e a notificação do sistema em si (dependem do diálogo nativo do navegador).

### Fase 12 — Reações e respostas ✅ implementada
- Reagir com emoji às mensagens do histórico (sala e DM): `chat_reactions { mensagem, pessoa, emoji }`, contagem ao lado da mensagem, clicar de novo tira.
- Responder citando: `replyToId` nas mensagens; a resposta mostra um trecho da original, e clicar leva até ela. Quem é respondido recebe aviso como numa menção.

**Como testar:** reagir e ver a contagem nas duas abas; tirar a reação; responder uma mensagem e clicar na citação.

**Notas da implementação:**
- Migration `0008`: tabelas `chat_reactions` e `dm_reactions` e coluna `reply_to_id` nas duas tabelas de mensagens. O drizzle-kit não escreve o `ON DELETE SET NULL` em `ALTER TABLE ADD`; foi acrescentado à mão no SQL.
- Reações numa lista fechada (`REACTIONS`: 👍 ❤️ 😂 😮 😢 🎉); o servidor recusa outras. Clicar de novo tira a sua. Limite de 10 seguidas, recarregando 3/s.
- Mensagens (sala e DM) passam a trazer `reactions` (emoji + quem, com nomes) e `replyTo` (id, autor e trecho de até 120 caracteres). Mudanças chegam por `chat.reactions` (sala) e `dm.reactions` (só as duas pessoas).
- Responder: ↩ na mensagem mostra a faixa "Respondendo a…" (Esc ou ✕ cancela); a resposta só vale para mensagem da mesma sala/conversa. Se a original for apagada (moderação ou limite de histórico), a citação some. Clicar na citação rola até a original e pisca.
- Quem é respondido é avisado como numa menção (destaque, aviso "X respondeu você", som e notificação do navegador).
- Ações por mensagem ao passar o mouse: ↩ responder, 😊 reagir, 🗑 apagar (no chat da sala; a lixeira da Fase 10 virou uma dessas ações).

### Fase 13 — Criar e editar salas ✅ implementada
- Salas passam a ter o **banco como fonte da verdade** (`shared/rooms.ts` vira só a semente inicial).
- Editor de sala: nome, tamanho e formato do piso (pintar/apagar tiles numa grade), cores de piso e parede, ponto de entrada e portas (escolher o tile e a sala de destino; a porta de volta é criada junto). Excluir sala vazia.
- Quem pode: admins e quem eles liberarem (decisão abaixo). Limite de ~20 salas.

**Como testar:** criar a sala "Sala do TI" em formato de L, ligar com uma porta à Recepção, entrar por ela e voltar; mudar as cores e todos veem; tentar desenhar uma sala sem caminho até a porta → bloqueado; reiniciar o servidor e tudo continua.

**Notas da implementação:**
- **Banco é a fonte da verdade:** a semente de `shared/rooms.ts` entra uma vez (`settings.rooms_seeded`). Bancos antigos recebem uma última sincronização, e os móveis da Sala de reunião e da Copa descem uma linha junto com a sala.
- **Regra de forma** (`shared/roomEdit.ts`): grade de 4×4 a 24×24; **a linha 0 e a coluna 0 são só para portas** (é onde a parede é desenhada). Por isso a Sala de reunião e a Copa ganharam uma linha vazia em cima. O piso pode ter qualquer formato conectado (L, U…), com pelo menos 6 tiles, entrada no piso e todas as portas alcançáveis. Até 6 portas por sala e 20 salas.
- **Portas guardam só o destino**; o tile de chegada é calculado na hora (`getLayout`): logo dentro da porta de volta, ou a entrada da outra sala se não houver porta de volta. Criar uma porta para outra sala cria a porta de volta lá, no lugar livre mais perto da entrada (`findDoorSpot`); se não houver lugar, a porta é de mão única.
- **Ao salvar**, móveis que não cabem mais saem (o editor avisa quantos), mas se um móvel que fica bloquear o caminho até uma porta a edição é recusada. A instância aberta recarrega (`moderation.layout`), quem ficou fora do piso volta para perto da entrada, e os clientes recebem `room.layoutChanged` e remontam a cena. O lobby mantém a lista de salas ao vivo (`LobbyState.rooms`).
- Excluir sala: não a Recepção, só vazia; leva móveis, conversa e as portas que levavam até ela. URL de sala excluída cai na Recepção.
- Permissão: admins sempre; outras pessoas pela caixa "Edita salas" no painel Admin (`users.can_edit_rooms`, `Player.canEditRooms` ao vivo).
- Editor (`ui/roomEditor.ts`): seletor de sala, "+ Nova sala" (8×6 com porta para a Recepção), nome, cores, tamanho, ferramentas Piso/Apagar/Entrada/Porta (clicar ou arrastar), lista de portas com destino, validação ao vivo, "Ir para a sala" (vai direto, sem porta) e excluir.
- Alturas (degraus) não entram no editor por enquanto: o piso editado é todo na altura 0.

### Fase 14 — Móveis interativos e ambiente ✅ implementada
- Móveis ganham `estado` sincronizado. Interações: abajur/luminária liga e desliga, cafeteira "serve" café (emote ☕), TV liga e desliga, **mural de recados** com post-its de texto que ficam salvos, porta-retrato.
- +20 móveis no catálogo (escritório, TI: servidores/racks, monitores, quadro de avisos).
- **Dia e noite:** a iluminação acompanha o horário de Brasília (manhã, tarde, noite); à noite as luminárias acesas brilham.
- **Som ambiente** opcional por sala (loops livres CC0), com volume local.

**Como testar:** ligar o abajur e a outra aba vê; deixar um recado no mural, recarregar e ele continua; forçar a hora (`?hora=21`) e ver a sala escura com as luzes acesas; ligar e desligar o som ambiente.

**Notas da implementação:**
- **Catálogo:** 53 móveis (25 novos), com categorias novas "TI" e "Luzes". O manifesto ganhou `states` (lidos do `/imaging/info/furniture`), `stateAnchors` (âncora por direção e estado, medida pelo `assets:sync`), `interaction` (`toggle`, `coffee`, `board`) e `light`. Tamanhos estimados conferidos no render; a máquina de bebidas e o mapa-múndi foram corrigidos à mão.
- **Estado no banco** (`room_furni.state`, migration `0010`) e no estado sincronizado (`Furni.state`). Clicar num móvel de usar: o avatar anda até um tile encostado e então usa (alterna o estado, ou serve café = emote ☕ e a máquina "trabalha" 2,5 s). Limite de 6 usos seguidos, 2/s.
- **Luzes:** no Habbo o facho de luz é uma camada somada (ink ADD) que o imager achata num disco escuro; por isso luzes usam sempre o desenho "apagado" e a cena desenha um brilho (elipses concêntricas com blend aditivo), mais forte à noite. TVs, computadores etc. usam o desenho do estado do imager.
- **Dia e noite** pelo horário de Brasília (`dayLight` em `shared/ambience.ts`): dia 8h–17h, entardecer até 19h (tom quente), noite azulada até 5h e amanhecer até 8h, atualizando a cada minuto. Camada de multiplicação sobre a sala (os balões de chat ficam por cima). `?hora=21` força a hora para testar.
- **Mural de recados:** `board_notes` (até 30 por mural, 140 caracteres, 4 cores de papel); mensagens `board.notes`/`board.add`/`board.remove` e aviso `board.changed`. Quem escreveu ou admin tira o recado.
- **Som ambiente** (`rooms.ambient`, escolhido no editor de sala): **gerado com WebAudio** em vez de loops CC0 — sem arquivos para baixar nem licença para registrar. Escritório (zumbido + teclas), cafeteria (burburinho + xícaras) e chuva. Botão 🎵 com ligar e volume, salvo no navegador; desligado por padrão.
- O porta-retrato previsto no plano ficou de fora (não achei um classname com render utilizável).
- Correção no banco de desenvolvimento: a primeira versão da migration `0010` colocou `ambient` na tabela errada e foi refeita; o banco local foi ajustado à mão (bancos novos ou de produção só veem a versão certa).

### Fase 15 — Quadro branco ✅ implementada
- Móvel "quadro branco" (já na Sala de reunião). Clicar abre o quadro em tela cheia: traço livre, cores, espessura, borracha, texto, desfazer e limpar (limpar pede confirmação).
- Traços em tempo real para quem estiver com o quadro aberto; salvo no banco (vários quadros, um por móvel). Miniatura do desenho aparece no próprio móvel na sala.

**Como testar:** duas abas desenhando juntas; recarregar e o desenho continua; limpar; a miniatura na parede atualiza.

**Notas da implementação:**
- Móvel: o `uni_c23_whiteboard` do Habbo (um cavalete 1×1) ganhou `interaction: 'whiteboard'` e a calibração `surface` (três cantos do papel em cada direção, medidos nos pixels claros da PNG). Entrou na semente da Sala de reunião (bancos novos); em bancos existentes, é só colocar pelo Decorar.
- Espaço fixo de 1200×900 (4:3) para o desenho sair igual em qualquer tela. Traços em `whiteboard_strokes` (migration `0011`), um por linha, em JSON: pincel/borracha (lista de pontos, até 400 por traço — o cliente divide traços maiores, para cada mensagem ficar bem abaixo do limite de 4 KB) ou texto (até 80 caracteres). Até 3000 traços por quadro.
- Tempo real: enquanto alguém desenha, o cliente manda `wb.draft` a cada 80 ms com os pontos novos (repassado só aos outros); ao soltar, `wb.stroke` grava e vai para todos, apagando a prévia. `wb.undo` desfaz o **último traço da própria pessoa**; `wb.clear` (com confirmação) limpa para todos.
- Janela em tela cheia com pincel, borracha, texto, 6 cores, 3 espessuras, desfazer (também Ctrl+Z) e limpar. Duas camadas de canvas: traços salvos e "ao vivo" (meu traço e os rascunhos dos outros), para não redesenhar tudo a cada movimento.
- Miniatura: o cliente carrega os traços de cada quadro da sala ao entrar, desenha uma miniatura 240×180 e a encaixa no papel do móvel com uma transformação afim (`FurniView.setSurfaceCanvas`), atualizando a cada traço.
- `@colyseus/core`: `maxMessagesPerSecond` da sala subiu de 30 para 40 por causa dos rascunhos.

### Fase 16 — Agenda de reuniões ✅ implementada
- Marcar reunião: título, sala, data/hora, duração e convidados (`meetings`, `meeting_attendees`). Painel **Agenda** com hoje e os próximos dias; aceitar/recusar.
- Lembrete 5 min antes (aviso, notificação do sistema e DM automática) com o botão "Ir para a sala". Durante a reunião a porta da sala mostra "Em reunião: título".

**Como testar:** marcar uma reunião para daqui a 6 minutos com um convidado; o lembrete chega para os dois; "Ir para a sala" leva até lá; a placa aparece na porta.

**Notas da implementação:**
- Banco: `meetings` e `meeting_attendees` (migration `0012`). Quem marca entra como convidado com resposta "Vou". Até 50 convidados; duração de 15 min a 8 h.
- Rotas: `GET /api/meetings` (padrão: de ontem até 14 dias à frente, no máximo 62 dias), `POST /api/meetings`, `PUT /api/meetings/:id/response` (só convidados) e `DELETE /api/meetings/:id` (quem marcou ou admin). Não deixa duas reuniões na mesma sala no mesmo horário (409 com o nome da que já está lá). Aceita início até 15 min no passado, porque o campo de hora anda de 5 em 5 minutos e "agora" seria recusado.
- Lembretes: um agendador no servidor roda a cada 30 s, pega as reuniões que começam em até 5 min e ainda não foram lembradas, marca `remindedAt` e avisa pelo `lobby` (banner "⏰ … começa às HH:MM" com "Ir para a sala" e notificação do sistema). Também manda uma DM de quem marcou para cada convidado, menos para quem recusou. A DM não tem horário no texto ("começa em até 5 minutos"), porque o servidor e cada pessoa podem estar em fusos diferentes; o banner mostra o horário no fuso do navegador.
- Convite: quem é convidado recebe aviso, som e notificação na hora. Mudanças na agenda (`meetings.changed`) atualizam o painel aberto de todo mundo.
- "Em reunião": a lista de salas do `lobby` ganhou o título da reunião em andamento. A porta mostra "🔴 Em reunião: título" ao passar o mouse, e a lista de pessoas mostra "· 🔴 em reunião" na sala.
- Painel **📅 Agenda**: reuniões por dia (Hoje, Amanhã, dia da semana), filtro "Só as minhas", Vou/Não vou, "Ir para a sala" a partir de 15 min antes e Cancelar (com confirmação). Formulário "Nova reunião" com busca de convidados.
- HUD: os botões de baixo ganharam ícone + nome; abaixo de 700 px de largura fica só o ícone.
- Dia/noite agora segue o fuso do navegador (antes era o de Brasília), para combinar com o relógio de quem está usando.
- Se o servidor reinicia bem na hora em que a página carrega, o cliente tenta de novo (1, 2, 4, 8 e 15 s) em vez de cair na tela de login. O token só é esquecido se o servidor responder 401.

### Fase 17 — Mini-jogos ✅ implementada
- **Jogo da velha** numa mesa de jogo: duas pessoas sentam, cada uma joga na sua vez; o resto da sala assiste. Placar salvo.
- Comandos rápidos no chat: `/dado` (1–6) e `/moeda`, com resultado visível para todos (sorteado no servidor).

**Como testar:** duas abas sentam na mesa e jogam até o fim; uma terceira assiste; `/dado` mostra o mesmo resultado para todos.

**Notas da implementação:**
- `/dado` e `/moeda` (também no menu 😊): o servidor sorteia (`crypto.randomInt`) e grava a mensagem com `kind` próprio (migration `0013`). O chat mostra essas mensagens com destaque amarelo; digitar o mesmo texto à mão continua sendo mensagem comum, então ninguém consegue "forjar" um resultado.
- Mesa de jogos: não achei móvel de jogo da velha no imager da HabboAssets, então a **Mesa de Jogos** é a mesa redonda `table_plasto_round` (1×1) com `interaction: 'tictactoe'`. O tabuleiro é desenhado pela cena em perspectiva isométrica em cima do tampo, com X/O e a linha vencedora, e todos na sala veem ao vivo. Ela entra na semente da Copa com duas cadeiras (bancos novos); em bancos existentes, é só colocar pelo Decorar.
- Partida no estado da sala (`games`, um `TttGame` por mesa): jogadores, tabuleiro, vez, status e vencedor. Regras em `server/src/rooms/ticTacToe.ts`. Clicar na mesa abre um painel flutuante (dá para arrastar pelo título, para não cobrir a mesa): Jogar, as 9 casas, Revanche (quem começa alterna), Sair da mesa e o placar (top 5).
- Ao clicar em Jogar, o avatar senta na cadeira livre encostada na mesa mais perto; sem cadeira, fica em pé ao lado. Com dois jogadores a partida começa; quem não está na mesa só assiste. Uma conta não pega os dois lugares (outra aba).
- Fim de partida: placar em `game_scores` e aviso no chat da sala ("🏆 venceu Beto no jogo da velha", "🤝 empatou com…"). Sair no meio (botão ou saindo da sala) dá a vitória ao outro por desistência. Recarregar a página no meio da partida também conta como saída.
- Testado no navegador contra um script temporário (Davi jogando sozinho). A pessoa que só assiste foi verificada no teste automático da sala (terceiro cliente), porque o navegador de teste só tem uma conta aberta.

### Fase 18 — Pets ✅ implementada
- Cada pessoa pode ter um bichinho (cachorro, gato…) com nome. Ele segue o dono, passeia sozinho quando o dono para e obedece comandos no chat (`/senta`, `/deita`, `/vem`).
- Arte: tentar os pets da HabboAssets; se o imager não tiver render utilizável, arte própria CC0 (decisão na hora, com aviso).

**Como testar:** adotar um pet, andar e ver ele seguir; dar comandos; a outra aba vê o pet.

**Notas da implementação:**
- **Arte (decisão na hora):** o imager da HabboAssets não tem render de pets (só os SWFs, sem PNG), então os pets são **pixel art própria desenhada por código** (`client/src/assets/petArt.ts`): cachorro, gato, coelho e pintinho, 3 pelagens cada, nas poses em pé, andando (2 quadros), sentado e deitado (olhos fechados). Grades 16×12 com contorno gerado, de perfil; a cena espelha para a esquerda. Registrado no `ASSETS.md`.
- Banco: `pets` (um por pessoa, migration `0014`). Rotas `GET/PUT/DELETE /api/pets/me`. No **Perfil (👤)** aparece a seção "🐾 Meu pet": adotar (nome, espécie, pelagem, com prévia), editar e soltar. As salas abertas são avisadas e o pet aparece, muda ou some na hora.
- Estado da sala: `pets` (chave = conta do dono) com posição, direção e ação (`idle`/`walk`/`sit`/`lie`). O movimento é o mesmo dos avatares (A* no servidor, passo a passo). Pets não bloqueiam ninguém, não param em portas, em cima de gente parada ou de outro pet.
- Comportamento (`server/src/rooms/PetKeeper.ts`, pensa a cada 0,5 s): segue o dono quando ele passa de 2 tiles; com o dono parado, dá voltas por perto a cada 4–9 s. Troca de sala junto com o dono e, com duas abas abertas, passa para a outra quando uma fecha.
- Comandos no chat: `/senta`, `/deita` e `/vem` (também `/sentar`, `/deitar`, `/aqui`). Viram a fala "Rex, senta!" no chat da sala. Sentado ou deitado, o pet fica assim por até 30 s ou até o dono se afastar mais de 4 tiles. Sem pet, aparece um aviso.
- Passar o mouse sobre o pet mostra "Nome · pet de Fulano".
- Testado no navegador com Ana (cachorro Bolota) e o robô Davi com um gato (Frajola) adotado pela API: seguir, comandos, nome e troca de sala.

### Fase 19 — Conquistas ✅ implementada
- ~15 conquistas (primeira mensagem, primeiro móvel colocado, visitou todas as salas, 7 dias seguidos, ganhou no jogo da velha, participou de 5 reuniões…), com emblema e aviso ao desbloquear (`achievements`, `user_achievements`).
- Emblemas aparecem no cartão e no perfil; a pessoa escolhe até 3 para exibir.

**Como testar:** fazer as ações e ver os avisos; os emblemas aparecem no cartão para os outros.

**Notas da implementação:**
- **17 conquistas** em `shared/src/achievements.ts`: Primeira palavra, Tagarela (100 mensagens), Correio (1ª DM), Expressivo (10 reações), Decorador, Arquiteto de interiores (25 móveis), Explorador (todas as salas), Assíduo (7 dias seguidos), Cafezinho, Recado dado, Artista (quadro branco), Organizador (1ª reunião marcada), Sempre presente (5 reuniões confirmadas que aconteceram), Primeira vitória, Mestre da velha (5 vitórias), Sorte grande (6 no `/dado`) e Melhor amigo (adotar pet).
- As definições ficam no código compartilhado (não há tabela `achievements`). O banco guarda só o que cada pessoa desbloqueou (`user_achievements`), os contadores (`user_stats`) e as salas visitadas (`user_visits`), na migration `0015`. As de contador desbloqueiam sozinhas ao bater a meta; as outras o servidor dá na hora da ação. Nada é retroativo: a contagem começa nesta fase.
- "Dias seguidos" usam o dia no fuso do escritório (Brasília); voltar no mesmo dia não conta de novo e pular um dia recomeça do 1. "Reuniões" contam quando o lembrete de 5 minutos dispara, para quem respondeu Vou.
- **Emblemas (arte própria):** a HabboAssets não tem imagens de emblemas (só o CDN do próprio Habbo, que não é a fonte combinada), então cada emblema é uma medalha em CSS com o emoji sobre a cor da conquista.
- Aviso: ao desbloquear, o canal global manda `achievement.unlocked` e aparece uma faixa dourada no topo ("Conquista desbloqueada!", com "Ver conquistas"), com som e notificação do sistema. Conquistas ganhas antes do canal global conectar (ex.: o dia seguido na primeira entrada) não mostram a faixa, mas aparecem no perfil.
- **Perfil → 🏅 Conquistas:** grade com todas (as bloqueadas em cinza, com progresso tipo 37/100) e clique para exibir até 3 emblemas no cartão (`PUT /api/achievements/showcase`). Os emblemas vão para o estado da sala (`Player.badges`) e aparecem no cartão do avatar para todo mundo. Com o perfil aberto, a grade se atualiza quando chega uma conquista nova.

### Fora deste roadmap (por enquanto)
Voz/vídeo por proximidade (WebRTC) — fica como possível fase extra no fim, porque é grande e pede servidor TURN para funcionar fora da rede local.

### Decisões para aprovar antes da Fase 9
1. **Contas:** usuário único + senha. Isso troca a decisão 4 da v1 (nomes livres): o **login** passa a ser único; o nome exibido continua livre.
2. **Quem define o cargo:** só admins (ninguém se autodeclara "Diretor"). A pessoa vê o cargo, mas não muda.
3. **Primeiro admin:** pelo `.env` (`ADMIN_USERNAMES=luis`). Sem a variável, a primeira conta criada vira admin.
4. **Quem cria e edita salas:** admins e quem eles liberarem.
5. **Canal global `lobby`** (Fase 11): uma segunda conexão Colyseus por pessoa, para DMs, avisos e presença em tempo real.
6. **Arte de pets e emblemas:** HabboAssets primeiro; sem render utilizável, arte própria CC0 registrada no `ASSETS.md`.

## 11. Roadmap v3 — integrações (status de atividade)

Pedido em 17/10/2026: mostrar no escritório o que cada pessoa está fazendo fora dele, começando por VS Code e Spotify (depois, também o Visual Studio “roxinho” 2026). Os dois alimentam uma linha de **atividade** no cartão do avatar e na lista de pessoas ("💻 Codando em TypeScript · portal", "🎵 Ouvindo: Música – Artista"). Cada pessoa controla o que aparece. Ordem: VS Code primeiro (só depende de nós), Spotify depois (depende de um app no Spotify Developer Dashboard).

### Fase 20 — VS Code e Visual Studio ✅ implementada
- **Token pessoal** criado no Perfil (mostrado uma vez; dá para revogar), guardado só como hash (`api_tokens`). Serve só para mandar atividade, não para entrar no escritório.
- **Extensão do VS Code** (pasta `vscode-extension/`, instalada por `.vsix`, sem publicar no marketplace): comando "Escritório: conectar" pede o endereço do servidor e o token (guardado no SecretStorage do VS Code). Manda um sinal a cada minuto enquanto a pessoa digita ou navega no código (linguagem e nome do projeto). Fica ociosa depois de 5 min parada e avisa ao fechar. Item na barra de status mostra se está conectada.
- **Servidor:** `POST /api/activity/vscode` com o token. A atividade vale por 3 min sem sinal e vai para o estado da sala (`Player.activity`) e para a lista de pessoas.
- **Privacidade no Perfil:** não mostrar, só "Codando", linguagem, ou linguagem e projeto.

**Como testar:** gerar o token no Perfil, conectar a extensão, abrir um arquivo e digitar: o cartão mostra "💻 Codando em …" para os outros; parar 5 min (ou fechar o VS Code) e a linha some; trocar a privacidade e ver o texto mudar; revogar o token e os sinais passam a ser recusados.

**Notas da implementação:**
- **Visual Studio entrou junto** (pedido no meio da fase). O servidor ficou genérico: `POST /api/activity/editor` com `editor: 'vscode' | 'visualstudio'`, e o texto diz o editor: "💻 Codando em C# no Visual Studio · PortalTransparencia".
- **Servidor:** tokens `esc_…` em `api_tokens` (migration `0016`, só o SHA-256, até 5 por pessoa, `lastUsedAt` regravado no máximo a cada 5 min). A atividade fica só em memória (`ActivityService`), vale 3 min sem sinal (varredura a cada 30 s) e vai para `Player.activity` (cartão) e `OnlinePerson.activity` (lista de pessoas, inclusive de outras salas). Limite de 20 sinais por minuto por token. A sessão do navegador não serve como token, e vice-versa.
- **Extensão do VS Code** (`vscode-extension/`, TypeScript + esbuild, `.vsix` de ~5 KB gerado por `npm run vscode:package` em `client/public/downloads/`, versionado e servido pelo escritório para download). Regras de quando mandar sinal em `tracker.ts` (testado). Conta como atividade digitar, trocar de arquivo, mover o cursor e voltar para a janela (só com a janela em foco). Token no SecretStorage. Item na barra de status: conectado / pausado / erro (token revogado pede para conectar de novo).
- **Extensão do Visual Studio** (`visualstudio-extension/`, C#, modelo novo VisualStudio.Extensibility 17.14, roda fora do processo do VS, compatível com o VS 2022 17.14+ e o 2026). Ouve abrir e editar arquivos de código, descobre a linguagem pela extensão do arquivo e o projeto pelo `.sln`/`.slnx`/`.csproj` mais próximo. Mesmas regras de sinal. Comandos no menu Extensões: conectar (pede endereço e token), pausar ou retomar, desconectar. O token fica criptografado com DPAPI.
- **Limite do ambiente:** o `.vsix` do Visual Studio só pode ser gerado no Windows (o empacotador da Microsoft é um `.exe`). Aqui no Mac o projeto **compila sem erros nem avisos** (`dotnet build`), mas a extensão **não foi executada** dentro do Visual Studio. Falta testar no Windows.
- **Perfil → 💻 Editores de código:** link para baixar a extensão do VS Code, escolha do que aparece, lista de tokens (último uso, revogar com confirmação) e criação (o token aparece uma vez, com botão Copiar).
- Testado no navegador: gerar token, sinais no formato das duas extensões (enviados pela página com o token gerado), texto no cartão e na lista, troca de privacidade e revogação (sinal recusado com 401). A extensão do VS Code não foi instalada no seu VS Code; o `.vsix` está pronto para você instalar.
- **Teste real no VS Code** (17/10/2026, depois da aprovação): extensão instalada no VS Code do Luís, conectada pelo item "Escritório" da barra de status, e o cartão mostrou "💻 Codando em Python no VS Code" junto com a música do Spotify ("🎵 BLEACH – BROCKHAMPTON"), uma atividade por linha.
- **Extensão 0.2.0:** botão **Conectar no VS Code** no Perfil (aparece ao gerar o token). Abre um link `vscode://escritorio-virtual.escritorio-virtual-atividade/connect?server=…&token=…` que a extensão recebe (`onUri`) e conecta sozinha, sem copiar e colar. O navegador embutido do app do Claude não abre links para outros programas; no Chrome/Safari abre. O caminho manual pela barra de status continua valendo.

### Fase 21 — Spotify ✅ implementada e testada com o app real
- No Perfil, "Conectar Spotify" (OAuth com PKCE, escopo `user-read-currently-playing`). O servidor guarda o refresh token e consulta a música atual de quem está online a cada ~20–30 s.
- Mostra "🎵 Ouvindo: Música – Artista" (com link para a música) no cartão e na lista de pessoas; esconde quando pausado. Botões para desconectar e para ocultar temporariamente.
- **Pré-requisitos (seus):** criar um app no Spotify Developer Dashboard (Client ID no `.env`), cadastrar o endereço de retorno (https em produção; `http://127.0.0.1:…` em desenvolvimento) e, no modo de desenvolvimento do Spotify, adicionar o e-mail de cada pessoa que vai conectar (limite de ~25).

**Como testar:** conectar a conta, tocar uma música e ver o cartão atualizar para os outros; pausar e a linha some; desconectar.

**Notas da implementação:**
- **OAuth com PKCE feito pelo servidor** (só o Client ID, sem segredo): `POST /api/spotify/connect` devolve o endereço de autorização (state e verifier guardados em memória por 10 min), o Spotify volta em `GET /api/spotify/callback`, o servidor troca o código pelos tokens e manda o navegador de volta para `SPOTIFY_RETURN_URL?spotify=ok|erro|cancelado`, onde aparece um aviso. Tokens em `spotify_links` (migration `0017`); o access token é renovado com o refresh token quando falta menos de 1 min (o Spotify pode girar o refresh token). Se a pessoa tirar a autorização no Spotify (`invalid_grant`), o vínculo é apagado.
- **Consulta** (`SpotifyPoller`, a cada 20 s, uma pessoa por vez): só de quem está online, ligou a conta e não escondeu a música. `GET /me/player/currently-playing`: tocando = "🎵 Música – Artista" (podcast mostra o programa); pausado, nada tocando ou propaganda = some. Respeita o 429 (espera o `Retry-After`).
- **Atividade com várias linhas:** código e música aparecem juntos (uma por linha) no cartão e na lista de pessoas. Na linha 🎵 do cartão, link para a música (`Player.activityUrl`, só links `open.spotify.com`).
- **Perfil → 🎵 Spotify:** sem app configurado, explica o que falta. Com app: "Conectar Spotify", depois "Conectado como …", "Mostrar o que estou ouvindo" (esconder sem desconectar) e "Desconectar".
- **Config:** `SPOTIFY_CLIENT_ID` (sem ele a integração fica desligada), `SPOTIFY_REDIRECT_URI` (padrão `http://127.0.0.1:2567/api/spotify/callback`; o Spotify não aceita `localhost`) e `SPOTIFY_RETURN_URL` (em dev, `http://localhost:5173/`).
- **Testado:** troca de código com PKCE, renovação, pausado, conta desautorizada, consulta só de quem está online, esconder e o redirect de volta, tudo contra um Spotify falso nos testes automáticos. **De ponta a ponta com o app real** (17/10/2026): conectar pelo Perfil (login e autorização no Spotify), a música tocando apareceu na lista de pessoas e no cartão com link para a faixa, esconder/mostrar funcionou na hora e, ao pausar no Spotify, a linha sumiu na consulta seguinte.
- Ao voltar do Spotify, a primeira consulta é imediata; se a música começar depois, ela aparece na consulta seguinte (até 20 s).
- Ajuste no teste: nome do Spotify que já termina em pontuação ("celo.") não ganha ponto dobrado em "Conectado como …".

## 12. Roadmap v4 — equipe, dia a dia e produção

Escolhido em 17/10/2026, depois do roadmap v3. Ordem pensada assim: primeiro proteger os dados e o código (backup e testes de ponta a ponta, que passam a cobrir todas as fases seguintes), depois o que é rápido e muito usado, e por fim o que é maior ou depende de sistemas de fora.

### Fase 22 — Backup automático ✅ implementada
- Cópia diária do SQLite às 3h (API de backup do SQLite, segura com o servidor rodando), em `data/backups/`, guardando as últimas 7. Painel Admin: lista dos backups, "Fazer backup agora" e baixar.
- README: como restaurar (parar, trocar o arquivo, subir) e como levar os backups para fora da VM.

**Como testar:** "Fazer backup agora" cria o arquivo; o oitavo apaga o mais antigo; restaurar um backup numa cópia e o escritório sobe com os dados daquele momento.

**Notas da implementação:**
- `BackupService` usa `db.backup()` do better-sqlite3 (API de backup do SQLite: cópia consistente mesmo com o servidor rodando e o WAL ligado). A conexão SQLite por trás do Drizzle fica registrada ao abrir o banco (`sqliteOf`). Nomes `escritorio-AAAA-MM-DD-HHMM.db` no horário de Brasília (com `-2`, `-3`… no mesmo minuto). Guarda os últimos `BACKUP_KEEP` (7).
- `BackupScheduler` confere a cada 10 min (e ao subir): passou das 3h e não tem backup de hoje → faz. Assim um servidor que estava desligado às 3h faz o backup ao voltar (no teste, o primeiro saiu sozinho ao reiniciar o servidor).
- Rotas só de admin: `GET /api/admin/backups`, `POST /api/admin/backups`, `GET /api/admin/backups/:nome` (download; só nomes no formato de backup que existem na pasta, então `../sqlite.db` dá 404). Criar e baixar entram no Registro.
- **Admin → Backups:** texto explicando o horário e a retenção, "Fazer backup agora" e a lista com data, tamanho e "Baixar".
- Testado: arquivo é um banco válido com os dados, sufixo no mesmo minuto, retenção, regra das 3h no fuso do escritório, permissões e registro (testes automáticos); no navegador, backup automático ao subir, "Fazer backup agora", download (anexo começando com "SQLite format 3") e o Registro. **Restauração de verdade:** um segundo servidor subiu a partir de uma cópia do backup (porta 2599) e respondeu com os dados (8 contas, 4 salas, 42 móveis).

### Fase 23 — Testes de ponta a ponta (Playwright) ✅ implementada
- `npm run e2e` sobe servidor e cliente com um banco temporário e roda no Chromium os fluxos principais: cadastrar/entrar, andar, conversar (duas pessoas), trocar de sala, decorar, agenda, jogo da velha.
- Daqui em diante, cada fase nova ganha o seu teste de ponta a ponta.

**Como testar:** `npm run e2e` passa; quebrar algo de propósito (ex.: o chat) e o teste acusa.

**Notas da implementação:**
- `e2e/playwright.config.ts`: o servidor sobe com `NODE_ENV=production` na porta 2600, servindo o `client/dist` (mesma origem, como no deploy), com banco, backups e cache numa pasta temporária, Spotify desligado e `LOGIN_RATE_LIMIT=1000` (variável nova; o padrão continua 10 por minuto por IP). Um worker só (todos dividem o banco, cada teste cria contas próprias). Trace e screenshot quando falha.
- Arte provisória (`?offline=1`) para não depender da internet, e **gancho de testes** `?e2e=1` (`client/src/e2e.ts`): posição na tela de cada tile e móvel, qual móvel um clique pegaria naquele ponto e o estado da sala (quem está onde, móveis). Os testes clicam com o mouse de verdade nesses pontos, passando pelo mesmo caminho do usuário (Pixi, cena, servidor).
- 5 testes (`e2e/tests/`): **conta** (criar, recarregar sem pedir senha, sair, senha errada, entrar), **sala** (Ana anda e Beto vê, chat chega ao outro, porta para a Copa e a lista de pessoas acompanha), **decorar** (cadeira aparece para o outro), **agenda** (marcar com convidado e o convidado responde "Vou"), **jogo da velha** (dois sentam na mesa da Copa e jogam até a vitória; o aviso aparece no chat). Todos passam em ~1min20.
- Achado no caminho: com a arte provisória, a cadeira na frente da mesa de jogos pega o clique no meio da mesa (correto: ela está por cima). O `clickFurni` dos testes procura um ponto em que o móvel desejado é o de cima.
- **Conferido que acusa erro:** com o envio do chat quebrado de propósito, o teste da sala falhou em "a mensagem chega ao Beto"; depois o código voltou ao normal.

### Fase 24 — Avisos da diretoria ✅ implementada
- Admin publica um comunicado (título, texto, importância normal/urgente). Aparece como faixa para todo o escritório na hora (e para quem entrar depois, até a pessoa marcar "Li"). Histórico de avisos; urgente também vira notificação do sistema.

**Como testar:** publicar um aviso com duas abas abertas; a outra recebe a faixa; "Li" some só para ela; quem entra depois ainda vê.

**Notas da implementação:**
- Banco: `announcements` e `announcement_reads` (migration `0018`). Rotas: `GET /api/announcements` (histórico, 50), `GET /api/announcements/unread`, `POST` (só admin), `PUT /:id/read` e `DELETE /:id` (só admin; publicar e apagar entram no Registro).
- Ao publicar, o canal global manda o aviso para todos os conectados; quem publicou recebe já como lido (sem faixa). Ao entrar, cada pessoa busca os não lidos dos últimos 30 dias, então quem cria a conta depois também vê.
- **Faixa** no topo, um aviso por vez: urgente em vermelho, passa na frente da fila e vira notificação do sistema; os outros tocam o som de menção. "Li" grava e mostra o próximo; "Ver todos (N)" abre o painel.
- **Botão 📢 Avisos** no HUD com o contador de não lidos. Painel com o histórico (novos destacados, "Li" também ali). Para admins: formulário "Publicar aviso" (título, texto, urgente), "lido por N" e "Apagar" (com confirmação).
- **Teste de ponta a ponta** (`e2e/tests/avisos.spec.ts`): a diretora (`admin.e2e`) publica, o Beto online recebe a faixa ao vivo e o contador, "Li" some e não volta ao recarregar, o Caio, que cria a conta depois, vê ao entrar, e o admin vê "lido por 2". O teste pegou um erro na primeira versão: quem publicava também recebia a própria faixa.
- No navegador: publicar um aviso urgente pelo painel (barra vermelha, "lido por 1", sem faixa para a autora). A faixa vista por outra pessoa foi conferida pela foto do teste de ponta a ponta.

### Fase 25 — Enquetes no chat ✅ implementada
- `/enquete Pergunta? | opção 1 | opção 2 …` (até 6 opções) ou botão no chat. Mensagem especial com botões; um voto por pessoa (dá para trocar), resultado ao vivo com barras. Quem criou encerra. Anônima ou com nomes (escolha ao criar).

**Como testar:** criar enquete, votar de duas abas, trocar o voto, encerrar.

**Notas da implementação:**
- Enquete é uma mensagem do chat com `kind: 'poll'`, mais as tabelas `polls` (ligada à mensagem, apagada junto se ela sair do histórico) e `poll_votes` (um voto por pessoa; votar de novo troca), na migration `0019`.
- Criar: `/enquete Pergunta? | a | b …` (o servidor reconhece no chat; vale o limite de 200 caracteres da mensagem) ou 😊 → **📊 Enquete** (formulário com até 6 opções e "Anônima"; mensagem `poll.create`). Votar (`poll.vote`) e encerrar (`poll.close`, só quem criou ou admin). Cada pessoa recebe a enquete com o próprio voto (`myVote`), tanto ao vivo (`poll.updated`) quanto no histórico ao entrar na sala.
- Cartão no chat: opções com barra de porcentagem, "✓" no seu voto, nomes de quem votou ao passar o mouse (se não for anônima), "N voto(s) · com nomes/anônima/encerrada" e "Encerrar".
- Testes: na sala (comando, votar, trocar, nomes, só quem criou encerra, voto depois de encerrar recusado, histórico com o voto, comando mal formado, anônima sem nomes) e de ponta a ponta (`e2e/tests/enquete.spec.ts`: comando, voto e troca vistos pela outra pessoa, nomes no "title", encerrar e botões desligados, anônima pelo menu).
- No navegador: criar pelo menu com 3 opções, votar, recarregar e o voto continua marcado, encerrar. Ajuste visto no teste: no chat estreito o "Encerrar" quebrava em duas linhas; o rodapé ficou mais curto.

### Fase 26 — Elogios (kudos) ✅ implementada
- Botão "Elogiar" no cartão do avatar e na Equipe: escolhe um tipo (🙌 Ajudou muito, 💡 Boa ideia, 🚀 Entregou, 🤝 Parceria) e escreve uma frase. Vai para um mural na Recepção (móvel novo), avisa a pessoa e conta para conquistas novas ("Querido pela equipe", "Reconhece os colegas").

**Como testar:** elogiar alguém; aparece no mural e chega o aviso; as conquistas destravam.

**Notas da implementação:**
- Banco: `kudos` (de, para, tipo, frase), migration `0020`. Rotas: `POST /api/kudos` (não dá para elogiar a si mesmo nem conta desativada; até 10 por pessoa a cada 24 h) e `GET /api/kudos` (mural, 60 mais novos; `?para=` filtra os recebidos por alguém).
- Ao elogiar, o canal global avisa quem recebeu ("🙌 Fulano te elogiou: …", com som e notificação do sistema) e manda todo mundo atualizar o mural aberto.
- **Conquistas novas** (19 no total): "Reconhece os colegas" (elogiou 5 vezes) e "Querido pela equipe" (recebeu 5).
- **Quadro de Elogios:** o cavalete `easel_0` da HabboAssets com `interaction: 'kudos'` (a arte do mural comum já é do Mural de Recados). Entra na semente da Recepção (bancos novos); no banco de desenvolvimento foi colocado pelo Decorar. Clicar abre o mural: cartões coloridos por tipo, abas "Todos" e "Recebidos por mim" e "Elogiar alguém…".
- **Elogiar:** botão "🙌 Elogiar" no cartão do avatar e "🙌" ao lado de "Mensagem" na Equipe. A janela tem os 4 tipos e uma frase de até 200 letras.
- Testes: unitários (sem autoelogio, pessoa inexistente, frase curta, mural, conquistas, limite diário) e de ponta a ponta (`e2e/tests/elogios.spec.ts`: elogiar pela Equipe, aviso para quem recebeu, mural pelo cavalete com "Recebidos por mim").
- **Bug achado pelos testes de ponta a ponta:** na primeira versão, o cavalete da semente ficava em (11,1), na frente da porta do fundo da Recepção. Como é alto, o desenho cobria a porta e o clique para ir à Copa abria o mural. A semente passou para (12,6) e, na cena, **porta agora tem prioridade** sobre móveis desenhados na frente dela (vale também para móveis que as pessoas colocarem).
- No navegador (com o painel do navegador escondido, os cliques de mouse não chegavam, então usei o gancho de testes `?e2e=1`): Quadro colocado na Recepção (depois movido para (12,6), longe da porta), elogio "Parceria" para o Davi pela Equipe, aviso "Elogio enviado", e o mural aberto pelo cavalete mostrando o cartão.

### Fase 27 — Modo foco (Pomodoro) ✅ implementada
- Timer de foco (25/5 por padrão, ajustável) no HUD. Durante o foco: status Ocupado, placa 🍅 com o tempo restante sobre o avatar e no cartão, e menções/DMs ficam sem som e sem notificação (chegam juntas no fim). Fim do ciclo: aviso e pausa.

**Como testar:** iniciar foco; a outra aba vê 🍅; mandar DM durante o foco (sem som); no fim chega o resumo.

**Notas da implementação:**
- **Servidor** (`FocusService`, em memória): foco → pausa → fim por pessoa (não por sala, então acompanha quem troca de sala), conferido a cada 2 s. Mensagens `focus.start { minutes, breakMinutes }` (1–120 e 0–30) e `focus.stop`. O estado vai para `Player.focusUntil/focusKind`, e a própria pessoa recebe `focus.phase` a cada mudança (dizendo se terminou sozinho ou se ela parou).
- **Status:** em vez de trocar o status para "Ocupado" (o que brigaria com o status que a pessoa escolheu e com o ausente automático), o foco aparece como **tag "🍅 foco" / "☕ pausa"** na lista de pessoas, **"🍅 12m"** sobre o avatar e **"🍅 Em foco · faltam N min (melhor não interromper)"** no cartão.
- **Botão 🍅 Foco** no HUD: escolhas prontas (25+5, 50+10, 90+15) ou tempo livre. Durante o foco mostra a contagem (também com a tela estreita, em que os outros botões ficam só com ícone) e o título da aba vira "🍅 24:59 …". Clicar abre "Parar".
- **Avisos segurados:** durante o foco, menções, DMs e elogios não tocam som nem mostram aviso ou notificação (a mensagem entra normalmente no chat/conversas). No fim: "🍅 Foco concluído! Pausa de 5 min ☕. Enquanto isso: 2 menções, 1 mensagem." (com som e notificação do sistema); fim da pausa: "☕ A pausa acabou. Bora mais um ciclo?".
- Testes: `FocusService` (fases, sem pausa, parar), sala (os outros veem, a fase chega à pessoa, entra em outra sala ainda em foco, parar) e ponta a ponta (`e2e/tests/foco.spec.ts`: começar pelo botão, contagem no botão e na aba, tag para o outro, menção segurada, resumo ao parar).
- No navegador: foco de 1 minuto sem pausa terminou sozinho ("🍅 Foco concluído!", botão e título voltaram); foco 25+5 com o 🍅 sobre o avatar e a tag na lista. Ajuste visto no teste: com a janela estreita a contagem sumia do botão; agora fica.

### Fase 28 — Minimapa do escritório ✅ implementada
- Botão "🗺️ Mapa": todas as salas como cartões ligados pelas portas, com quem está em cada uma (e quem está em reunião). Clicar na sala vai até ela; clicar numa pessoa vai até a sala dela e anda até perto.

**Como testar:** abrir o mapa, ver as pessoas por sala ao vivo, ir até alguém de outra sala.

**Notas da implementação:**
- `GET /api/map`: cada sala e para onde vão as portas dela, com o lado (porta na parede esquerda ou no fundo).
- Posição das salas (`layoutMap` em `shared/map.ts`, testado): parte da Recepção e anda pelas portas. Porta na parede esquerda põe a vizinha à esquerda; porta no fundo põe acima. Lugar ocupado vai para o livre mais perto, e salas sem porta ficam numa linha embaixo. As portas viram linhas tracejadas entre os cartões, e o mapa encolhe para caber na janela.
- Cartões ao vivo (com a presença do canal global): nome da sala ("você está aqui" na atual), "🔴 Em reunião: …" e as pessoas com a bolinha de status (passar o mouse mostra a atividade).
- Clicar na sala troca de sala. Clicar numa pessoa: na mesma sala, anda até ela; em outra, troca de sala e, ao chegar, anda até perto (o servidor escolhe o tile livre mais próximo).
- Testes: `layoutMap` (vizinhas à esquerda/acima, sala solta, colisão) e ponta a ponta (`e2e/tests/mapa.spec.ts`: Copa acima da Recepção com o Beto, clicar nele e a Ana termina na Copa do lado dele).
- No navegador: mapa com as 4 salas do banco de desenvolvimento (inclusive a Sala do TI), "você está aqui" e "ir até" outra pessoa na mesma sala. Ajuste visto no teste: com 3 colunas o mapa passava da largura da janela e cortava a Copa; agora encolhe para caber.

### Fase 29 — Anexos e busca no chat ✅ implementada
- Enviar imagens e arquivos no chat da sala e nas DMs (arrastar, colar print ou botão 📎), até 10 MB, guardados em `data/uploads/` e servidos só para quem está logado. Imagens com miniatura e visualização; links com prévia (título do site). Busca no histórico da sala e das conversas.

**Como testar:** colar um print no chat, a outra aba vê a miniatura; mandar um PDF por DM; buscar uma palavra antiga.

**Notas da implementação:**
- `POST /api/uploads` recebe o arquivo cru (nome no cabeçalho `X-File-Name`), confere a sessão antes de ler o corpo e aceita só imagens (PNG, JPG, GIF, WebP), PDF, Word/Excel/PowerPoint (antigos e novos), ODT/ODS, TXT/CSV/MD e ZIP. O tipo vale pela extensão, e o começo do arquivo tem de bater (um `.png` que na verdade é outra coisa é recusado). Arquivo em `data/uploads/<id aleatório>` (`UPLOAD_DIR`), registro na tabela `uploads`. Limite de 10 envios por minuto por pessoa.
- `GET /api/uploads/:id` só com login: anexo de sala qualquer pessoa vê; de DM, só as duas pessoas; ainda não mandado, só quem enviou. Imagens vão `inline`, o resto sempre baixa (`attachment`), com `nosniff` e CSP `sandbox`. O cliente baixa com o token e mostra da memória (`blob:`), então o link do arquivo sozinho não abre nada.
- A mensagem leva `attachmentId` (só de arquivo que a própria pessoa enviou); texto pode ficar vazio quando tem anexo. Histórico, DMs e "responder" mostram "📎 Anexo" quando não há texto, e o balão sobre o avatar mostra "📎 nome-do-arquivo".
- Limpeza a cada hora: anexos com mais de um dia que nenhuma mensagem usa (enviados e não mandados, ou de mensagens que saíram do histórico).
- Prévia de link (`GET /api/link-preview`): o servidor busca a página e lê `og:title`/`<title>`, descrição e nome do site. Proteção para não usar o servidor contra a rede interna: só http/https, sem usuário/senha na URL, todos os IPs do nome têm de ser públicos (bloqueia 127.x, 10.x, 192.168.x, 172.16–31.x, 169.254.x — inclusive o endereço de metadados da nuvem —, IPv6 local etc.), a conexão usa o IP já conferido, no máximo 3 redirecionamentos (cada um conferido de novo), 4 s e 512 KB. Cache de 1 h (falhas, 5 min).
- Busca (`GET /api/search?q=`, mínimo 2 letras): chat de todas as salas (o que qualquer um vê ao entrar) e as DMs da própria pessoa, pelo texto e pelo nome do anexo, as 50 mais novas. `%` e `_` são procurados como texto.
- Cliente: 📎 na barra do chat e no painel de Mensagens, colar imagem no campo, arrastar arquivo; faixa "🖼️ nome · tamanho ✕" antes de mandar. Mensagem com miniatura (clique amplia; Esc fecha) ou cartão do arquivo com ícone e "baixar". Links clicáveis (abrem em outra aba) e cartão de prévia. 🔎 abre a busca: resultado da sala atual pisca no histórico; de outra sala, vai para lá; de DM, abre a conversa e pisca a mensagem (carrega páginas antigas se precisar).
- Testes: anexos (tipos, conteúdo falso, tamanho, nome com caminho, quem pode baixar, limpeza), busca (salas + só as próprias DMs, nome do anexo, curingas), prévia (IPs internos, Open Graph, redirecionamento, cache, esquemas recusados) e ponta a ponta (`e2e/tests/anexos.spec.ts`: imagem na sala vista pelo outro e ampliada, `.exe` recusado, PDF na DM, busca acha as duas e pisca a mensagem).
- No navegador: print anexado com legenda e link, miniatura carregada, prévia do MDN e busca por "sprint". Ajuste visto no teste: a prévia falhava em todos os sites (o Node pede o endereço em formato de lista ao tentar IPv4 e IPv6 juntos); corrigido e testado com MDN e GitHub, e endereços internos continuam recusados.

### Fase 30 — Jira (quadro de demandas) ✅ implementada
- Cada pessoa liga a conta do Jira no Perfil. O cartão mostra "📋 PROJ-123 · título" da demanda em andamento atribuída a ela (privacidade como a do editor). Painel na Sala do TI com as demandas da equipe por status, com link para o Jira.

**Como testar:** mover uma demanda para "Em andamento" no Jira; em até 1 min aparece no cartão; o painel mostra as demandas da equipe.

**Notas da implementação:**
- Endereço: o admin informa em **Admin → Convite e salas → Jira Cloud** (`empresa`, `empresa.atlassian.net` ou a URL inteira viram `https://empresa.atlassian.net`; só endereços `*.atlassian.net`) ou `JIRA_SITE` no `.env` (aí o painel só mostra). Vazio desliga.
- Conectar (Perfil → 📋 Jira): e-mail da conta Atlassian + token de API (link para criar). O servidor confere em `/rest/api/3/myself` antes de guardar; o token fica cifrado (AES-256-GCM) com a chave de `SECRET_KEY` ou de `data/secret.key` (gerada na primeira vez, só o dono lê). Limite de 5 tentativas por minuto.
- A cada minuto (`JiraPoller`), uma pessoa por vez, com o token dela: `assignee = currentUser() AND (statusCategory != Done OR resolved >= -7d)`, até 30 demandas. A primeira "Em andamento" (categoria de status do Jira) vira a linha do cartão, com link para a demanda; privacidade: não mostrar, só o código ou código e título. Token recusado: aviso no Perfil ("Conecte de novo"), some do cartão e do quadro e para de consultar.
- Linhas do cartão com link próprio cada uma (`activityUrl` agora tem um link por linha): 💻 editor, 📋 Jira, 🎵 Spotify.
- Quadro de Demandas: móvel novo (`jira_board`, mesma arte do quadro branco com um mini-kanban desenhado no papel, atualizado a cada minuto), na Sala de reunião das instalações novas e no catálogo do Decorar. No banco de desenvolvimento foi colocado na Sala do TI. Clicar abre as colunas A fazer / Em andamento / Concluídas (7 dias), com quem está com cada demanda, filtro por pessoa e link para o Jira.
- Testes: cofre de segredos, endereço do Jira, conectar (token certo/errado, guardado cifrado), cartão e privacidade, quadro, token revogado, linhas e links alinhados, admin define/desliga; ponta a ponta (`e2e/tests/jira.spec.ts`) com um Jira de mentira local (`e2e/jira-mock.mjs`): conectar pelo Perfil, outra pessoa vê a demanda no cartão, só o código, quadro na Sala de reunião.
- No navegador (com o Jira de mentira ligado só para o teste): conectar no Perfil, mini-kanban no quadro da Sala do TI, quadro com as duas demandas, campo do Admin. Depois disso, a conexão de teste foi apagada e o endereço ficou vazio, esperando o endereço real.
- Falta: testar com o Jira de vocês (o admin informa o endereço e cada pessoa conecta com o próprio token).

### Decisões para aprovar antes da Fase 22
1. **Ordem:** a acima (backup → testes → avisos → enquetes → elogios → foco → mapa → anexos → Jira).
2. **Anexos:** até 10 MB por arquivo; imagens, PDF, documentos do Office, texto e zip; guardados no disco do servidor (entram no backup).
3. **Pomodoro:** 25 min de foco / 5 de pausa por padrão; durante o foco as notificações ficam seguradas e chegam no fim.
4. **Jira:** ✅ **Jira Cloud** (respondido em 17/10/2026). Cada pessoa conecta com o e-mail da Atlassian e um token de API (guardado criptografado no servidor). Falta o endereço (`suaempresa.atlassian.net`), que pode vir antes da Fase 30.

## 13. Roadmap v5 — avatares vivos e todo o acervo do Habbo

Pedido (18/10/2026): prioridade para as **animações dos personagens**, **sentar (e deitar) nos móveis**, **mais roupas**, **mais móveis** e **todo o conteúdo de assets da API**.

### O que o levantamento mostrou
- **O imager da HabboAssets só desenha o avatar em pé.** Pedindo `action=sit`, `wlk`, `lay` ou `wav`, ele responde *"Only the standing pose (action=std) is supported"*, e `gesture` (sorriso, triste…) é ignorado. Por isso hoje a caminhada é um balanço feito por código e a pessoa "sentada" é o boneco em pé abaixado.
- **Os sprites brutos estão na API.** Cada biblioteca de roupa tem um pacote `.nitro` (spritesheet PNG + JSON) com todos os quadros: andar (`wlk`, 4 quadros por direção), sentar (`sit`), deitar (`lay`), acenar (`wav`), falar, piscar, carregar e beber (`crr`/`drk`). Conferido baixando o `hh_human_body`: 236 quadros, com sit/wlk/lay/wav. Com eles dá para **montar o avatar no próprio navegador** (como o cliente do Habbo faz), com todas as poses.
- **Tamanho do acervo × o que usamos hoje:**

| Conteúdo | Na API | Hoje no escritório |
|---|---|---|
| Roupas (bibliotecas) | 3.121 | 9 bibliotecas básicas, 270 peças |
| Móveis | 18.357 | 57 (curados à mão); 8.683 desde a Fase 36 |
| Efeitos (brilho, raio, aura…) | 252 | nenhum |
| Pets do Habbo | 37 tipos | 4, em pixel art própria |
| Emblemas | 12.397 | medalhas em CSS |
| Itens de mão (café, bebidas…) | `hh_human_item` | só o emote ☕ |

- A lista completa de móveis (`/api/v2/furniture`) precisa de um **token gratuito** da HabboAssets (criado na conta do site). O resto (imager, pacotes `.nitro` de roupas, efeitos e pets, emblemas) é público.

### Fases (ordem pela prioridade pedida)

#### Fase 31 — Avatar montado no navegador (base de tudo) ✅ implementada
- O `assets:sync` baixa, das bibliotecas usadas, os `.nitro` e os dados de montagem do Habbo (quais partes cada peça tem, ordem de desenho por direção, posições e paletas de cor). O servidor guarda em cache como hoje.
- Novo renderizador no cliente: junta as partes (corpo, cabeça, rosto, cabelo, roupas, acessórios) por direção e pose, pintando cada parte com a cor escolhida. Feito do zero, sem copiar código de terceiros.
- Primeiro só a pose **em pé**, conferida pixel a pixel contra o imager (tem de ficar igual). Se algo falhar, cai para o imager como hoje.
- **Como testar:** os avatares aparecem iguais aos de hoje, nas 8 direções, com todas as roupas do editor.
- ⚠️ É a fase mais arriscada. Começa com uma prova rápida (um boneco andando); mostro antes de seguir.

**Notas da implementação:**
- **Prova primeiro:** um boneco montado a partir dos pacotes `.nitro` já saiu quase igual ao imager, com andar, sentar e acenar (aprovada em 18/10/2026).
- **SWF em vez de `.nitro`:** conferindo várias figuras, os cabelos saíam fora do lugar (a franja de um cabelo feminino 5 px para o lado). O motivo: o `.nitro` derivado corta as bordas transparentes das imagens sem corrigir os deslocamentos. O servidor passou a usar o **SWF original** de cada biblioteca: lê as imagens, os nomes e o manifesto, corta as bordas corrigindo o deslocamento junto e gera uma folha de sprites + JSON (`/hh/figure/{lib}.png` e `.json`, com cache em disco e imutáveis). Assim não ficou nenhum ajuste "mágico".
- **Dados de montagem** (`npm run assets:figure` → `client/public/assets/figure/figuredata.json`, 49 KB): de cada biblioteca, as partes de cada roupa (com cor e camadas que esconde, como o chapéu esconder o cabelo grande), em que biblioteca está cada parte (o mapa do Habbo às vezes omite uma; ela fica com as irmãs do conjunto), as paletas e o SWF da revisão. O servidor só converte bibliotecas que estão nesses dados, na revisão deles.
- **Montagem** (`shared/src/figureRender.ts`, sem DOM): para cada parte, a imagem da pose/direção/quadro (sem ela, a pose em pé), pintada multiplicando pela cor e empilhada na ordem do Habbo por direção (de frente, de lado com os dois braços por cima e de costas com o braço direito atrás); direções 4–6 são o espelho de 2–0. Cabeça fica em pé enquanto o corpo anda ou senta. Cabelo: a parte grande (`hrb`); com chapéu, a curta (`hr`).
- **Reserva:** roupa que os dados não conhecem, ou parte sem desenho nas bibliotecas carregadas (ex.: bochecha corada que mora em outra biblioteca), usa o imager como antes. `?imager=1` força o imager para comparar; `?offline=1` continua com a arte provisória.
- **Conferência** (`npm run assets:figure-check`): monta figuras conhecidas e aleatórias do editor nas 8 direções e compara com o imager. Resultado: média de **44 pixels diferentes de 7.040** em 34 figuras; o que sobra são sombras de lentes de óculos e fios de cabelo sob alguns chapéus.
- O editor de visual, a Equipe e os cartões continuam usando o imager para os rostinhos (na pose em pé fica igual).
- Testes: montagem (cores, ordem, espelho, pose que falta, cabeça em pé, chapéu e cabelo, parte sem desenho), conversão do SWF (corte com deslocamento, transparência, apelidos), dados de montagem e o proxy (converte uma vez, recusa biblioteca/revisão desconhecida). Os de ponta a ponta usam a arte provisória e continuam passando; agora cada teste fecha os navegadores que abriu (antes as contas se acumulavam na Recepção).
- No navegador: os avatares da sala vêm das folhas montadas (nenhum pedido ao imager de avatar), iguais aos de antes.

#### Fase 32 — Animações dos personagens ✅ implementada
- **Andar** com os 4 quadros reais do Habbo (pernas e braços), no lugar do balanço.
- **Sentar** com a pose real (pernas dobradas) e **deitar**.
- **Falar:** a boca mexe enquanto o balão aparece. **Piscar** sozinho de vez em quando.
- **Expressões e gestos:** emotes viram animação de verdade: acenar (`wav`), mandar beijo, rir, levantar a mão, e rostos de feliz, triste, bravo e surpreso (`/sorrir`, `/triste`, `/bravo`, `/surpreso`).
- **Ausente:** depois de um tempo parado, olhos fechados e um "zZ".
- **Como testar:** andar pela sala, sentar, acenar e falar, e ver as animações nas outras abas.

**Notas da implementação:**
- **O que as bibliotecas têm** (levantado nos SWFs): andar (`wlk`, 4 quadros), sentar (`sit`, direções 0 e 2), deitar (`lay`, só a direção 2), falar (`spk`: cabeça e boca, 2 quadros), olhos fechados (`eyb`), sorrir/triste/bravo/surpreso (`sml`/`sad`/`agr`/`srp`, nos olhos e na boca), acenar (`wav`, braço esquerdo, 2 quadros), beijo (`blw`), mão levantada (`respect`), beber (`drk`) e carregar (`crr`). Deitado, o rosto tem versões próprias (`lsm`, `lsa`, `lsp`…).
- **Pose** (`FigurePose` em `shared/src/figureRender.ts`): postura (em pé, andando, sentado, deitado), gesto, fala e expressão. Cada parte escolhe a imagem certa: braço esquerdo para acenar e levantar a mão, braço direito para beijo e beber, cabeça e boca para falar, olhos para expressões; sem imagem, cai para a postura e depois para em pé. Gestos com desenho próprio nas direções 4–6 usam esse desenho em vez do espelho. Deitado usa um quadro mais largo (128×120) com os pés no mesmo ponto.
- **Na cena** (`AvatarView`): o renderizador entrega um "posador" que monta cada pose uma vez e guarda a textura (até 400 por avatar); a cada quadro a cena calcula a pose e só troca a textura quando muda. Andar troca 4 quadros por passo; sentado usa a pose real (sai a máscara que escondia as pernas); falar mexe a boca por um tempo proporcional à mensagem (0,8–4 s); pisca a cada 2,5–6 s; **Ausente** fecha os olhos e mostra "z Z Z" subindo. Pelo imager (ou `?offline=1`) continua a animação simulada de antes.
- **Emotes:** acenar = aceno real; joinha = mão levantada; coração = beijo com sorriso; café = bebendo; rir = sorriso falando; dançar = gira o corpo dando passos no lugar. Novos: `/mao` (levantar a mão), `/sorrir`, `/triste`, `/bravo`, `/surpreso` (também no menu 😊).
- **Sentado na frente do encosto:** quem senta passa a ficar na frente do móvel no desenho (antes o encosto do sofá aparecia por cima, disfarçado pela pose falsa).
- **Deitar** já é desenhado (postura `lay`), mas ninguém deita ainda: camas e `/deitar` vêm na Fase 33.
- Testes: poses (gesto no braço certo, fala vence o sorriso na boca, olhos fechados, beijo, direção 4 com desenho próprio, deitado e espelho, chave de cache), animações (quadros do andar, tempo de fala, piscar, emote → pose, comandos novos). Testes de ponta a ponta mais estáveis: cada teste faz as pessoas saírem das salas antes de fechar (antes ficavam 30 s esperando reconexão), e o ajudante de porta espera ninguém estar em cima dela (um avatar passando pegava o clique).
- No navegador: sentar no sofá (pernas dobradas, na frente do encosto), andar, `/acenar`, `/mao`, falar e Ausente com olhos fechados e "zZ".

#### Fase 33 — Sentar e deitar em tudo ✅ implementada
- Altura e direção de assento certas por móvel (dados do próprio Habbo). Sofás com vários lugares (cada pessoa num lugar), bancos, banquetas e poltronas.
- **Deitar** em camas, espreguiçadeiras e pufes. Cama de casal com dois lugares.
- `/sentar` senta no chão onde estiver, `/levantar` levanta. Clicar no piso levanta e anda.
- Virar sentado (setas ou clique ao lado) sem levantar.
- **Como testar:** sentar em cada tipo de assento, deitar numa cama, sentar no chão.

**Notas da implementação:**
- **Lugares:** cada tile de cadeira e sofá é um lugar; na cama, só a fileira da cabeceira (cama de casal = dois lugares). Clicar senta/deita no **lugar livre mais perto** (antes escolhia o tile mais perto mesmo ocupado e recusava, com o outro lugar livre). Cheio: "Esse lugar está ocupado." / "A cama está ocupada.".
- **Deitar** (`canLay` no catálogo): deita no comprimento, com a cabeça na cabeceira (cama no eixo y → direção 4; no eixo x → 2, as únicas que o Habbo desenha). Altura da cama pela `sitHeight`. O desenho do Habbo deitado fica todo para trás do ponto dos pés: o avatar inteiro (corpo, nome, selo) é empurrado ao longo da cama, ajuste medido no navegador nas duas direções.
- **No chão:** `/sentar`, `/deitar` e `/levantar` (e no menu 😊). Sentado arredonda para a direção par anterior (só existem 0/2/4/6); deitado vira para a direita ou a esquerda. Em cima de um assento, vale o assento. Andando, o comando espera parar.
- **Virar:** setas ← → (fora de campos de texto) mandam `turn`: parado gira de 1 em 1 direção; sentado no chão, de 2 em 2; deitado ou numa cadeira, não vira. Sentado no chão, clicar num tile vizinho só vira para lá (como no Habbo); clicar mais longe levanta e anda.
- **Catálogo novo:** Banqueta de Bar, Pufe e Almofada (sentar, alturas diferentes) e a categoria **Camas**: Cama de Casal (2×3), Cama de Solteiro (1×3) e Saco de Dormir (1×3).
- Testes: comandos, direções de cada pose, lugares (sofá, cama nos dois eixos), lugar livre mais perto; na sala, dois no mesmo sofá e o terceiro recusado, deitar na cama (cabeceira e direção), sentar/deitar no chão, virar sentado, clique ao lado só vira, deitado não vira, andar levanta; de ponta a ponta (`e2e/tests/sentar.spec.ts`): dois no sofá, `/levantar`, `/sentar` e `/deitar` vistos pelo outro. Um teste da sala que estourava 5 s com todos os arquivos rodando juntos ganhou 15 s.
- No navegador: cama de casal e de solteiro (girada) colocadas pelo Decorar na Recepção do banco de desenvolvimento (ficaram lá para testar), deitar nas duas, `/levantar`, `/sentar` no chão e virar com a seta.

#### Fase 34 — Itens na mão e efeitos ✅ implementada
- A máquina de café entrega **um copo na mão** (o avatar segura e bebe de vez em quando), e a geladeira entrega uma bebida. Some depois de alguns minutos ou ao clicar em "largar".
- **Efeitos** sobre o avatar (brilho, aura, raio…) para comemorar conquistas, aniversário, elogio recebido e fim de Pomodoro. No Perfil, cada pessoa escolhe um efeito desbloqueado para usar.
- **Como testar:** pegar café e ver o copo; ganhar uma conquista e ver o efeito.

**Notas da implementação:**
- **Itens na mão** (biblioteca `hh_human_item`, ~200 itens): a máquina de café entrega uma xícara (item 6) e a geladeira (interação nova `fridge`, que abre a porta) sorteia água com gás, refrigerante, limonada ou suco. O item fica 5 minutos (vale entre salas) ou até `/largar` / menu 😊. O avatar segura (`crr`) e dá um gole (`drk`) a cada 12 s; o emote ☕ também mostra a xícara. A biblioteca de itens só é baixada quando alguém pega um.
- **Conversor corrigido:** alguns SWFs (o de itens, por exemplo) escrevem o manifesto com aspas duplas, e o leitor só aceitava simples: a maioria dos itens sumia. Agora aceita as duas; o formato das folhas ganhou versão na URL (`v=2`) para o navegador e o cache do servidor não usarem as antigas.
- **Efeitos** (bibliotecas de efeito do Habbo): o servidor converte o SWF em folha + **animação** (lida do XML do próprio SWF: camadas, brilho aditivo, frente/atrás do corpo por direção e a sequência de quadros com deslocamentos) em `/hh/effect/{nome}`. No cliente, cada efeito toca a 12 quadros/s sobre o avatar, com o mesmo registro das partes (espelho nas direções 4–6 quando não há desenho próprio).
- **Escolher no Perfil (✨ Efeitos):** Brilho (todos), Joinha girando (1 elogio recebido), Brilho azul (3 conquistas), Corações (3 elogios), Vaga-lumes (5), Borboletas (8), Auréola (11), Holofote (14) e Raio (17 conquistas). Clicar usa, de novo tira; bloqueados mostram como liberar. Guardado no usuário (`users.effect`) e no estado da sala, então todos veem e as salas atualizam na hora.
- **Comemorações** (efeito por alguns segundos, para a sala toda): conquista → holofote; elogio recebido → joinha girando; fim de um ciclo de foco → medalha; aniversário → corações na primeira entrada do dia.
- Testes: animação dos efeitos (camadas, direções, quadros com deslocamento, camada sem fechar a tag), manifesto com aspas duplas, desbloqueio e dicas, `/largar`, API de efeitos (só liberados, avisa as salas, elogios liberam corações), sala (café e geladeira dão item, largar, conquista dispara o holofote) e ponta a ponta (`e2e/tests/efeitos.spec.ts`: Brilho no Perfil visto pelo outro, café na Copa e `/largar`).
- No navegador: xícara de café na mão na Copa (continua depois de recarregar), Brilho escolhido no Perfil e Corações flutuando em volta do avatar (este colocado pelo banco só para conferir e depois retirado).

#### Fase 35 — Muito mais roupas ✅ implementada
- Catálogo do editor com **todas as roupas usáveis** do Habbo Brasil (milhares, contra 270 hoje): busca por nome, filtros por categoria e gênero, paginação e miniaturas carregadas aos poucos.
- Roupas **animadas** (as que mexem no Habbo) animando de verdade.
- **Looks salvos:** até 5 visuais para trocar com um clique.
- As peças são baixadas só quando alguém usa (cache no servidor), para não pesar.
- **Como testar:** buscar "terno" e "chapéu", vestir, salvar dois looks e alternar.

**Notas da implementação:**
- **Catálogo:** `npm run assets:figure` lê a lista de bibliotecas de roupa da HabboAssets e o `/imaging/info/clothing/{lib}` de cada uma (2.279 bibliotecas sem NFT, com cache em disco por revisão; a primeira vez levou uns 10 minutos, depois segundos). Resultado: **2.416 peças** no editor (antes 270) em 12 categorias: pele, cabelo (294), chapéu (440), **acessório de cabeça** (199, novo), óculos, **máscara** (97, nova), blusa (534), casaco, acessório, **cinto** (50, novo), calça e sapatos. `figuredata.json` com 2.607 conjuntos (0,9 MB) e o manifesto do editor (0,45 MB). Só entram peças que dá para montar.
- **Paleta por peça:** no catálogo inteiro algumas peças usam outra paleta que a da categoria; elas guardam a sua, e a validação, o editor e a montagem usam a da peça.
- **Bibliotecas de cada parte:** se a biblioteca da própria peça declara a parte, vale a dela (a básica às vezes lista partes que o SWF dela não tem). Mangas declaradas sem desenho (comuns no Habbo) são ignoradas; parte de rosto ou de corpo sem desenho continua usando o imager.
- **Editor:** busca em português (dicionário das palavras dos nomes das bibliotecas, com palavras compostas: "swimsuit" é maiô, não terno), filtro Todas / Grátis / Do clube (HC), 60 peças por vez com "Mostrar mais", selo HC e ✨ nas animadas. Miniaturas: peças do catálogo completo pela prévia estática da CDN (`/hh/clothing/preview/…`, sem a cota de renders do imager); básicas, pelo imager. Carregam 3 de cada vez, para não segurar as outras chamadas da página (o navegador abre só 6 conexões por servidor).
- **Roupas animadas:** a pose em pé dessas peças tem vários quadros (ex.: 8 na ovelhinha que pula sobre a cabeça); o avatar alterna a 8 quadros por segundo.
- **Looks salvos:** até 5 por pessoa (tabela `user_looks`), no editor: 💾 guarda o visual atual no slot, clicar usa, × apaga. Visual validado como no editor.
- O `assets:sync` passou a cuidar só dos móveis (antes regeraria o catálogo de roupas só com as 9 bibliotecas básicas).
- **Conferência** (`assets:figure-check` com peças aleatórias do catálogo novo): média de 115–160 px diferentes de 7.040, contando um caso raro de acessório com brilho (o halo sai escuro) e diferenças de ordem em algumas máscaras.
- Testes: busca (tradução, palavras compostas), roupa animada (quadros pelo total da peça), catálogo completo (todas as bibliotecas, paleta própria, revisão, animação), prévia da CDN (só biblioteca e revisão conhecidas), looks (5 slots, troca, validação, apagar) e ponta a ponta (`e2e/tests/roupas.spec.ts`: buscar "terno", vestir, guardar no look 1 e o outro vê a peça nova). Achado no teste: a lista de looks que chegava depois apagava o look recém-guardado da tela; corrigido.
- No navegador: editor com as 12 abas, "terno" achando só o terno risca de giz, acessório animado vestido e look guardado (desfeitos depois, na sua conta).

#### Fase 36 — Catálogo completo de móveis ✅ implementada
- Com o token gratuito, o servidor lê a lista dos 18 mil móveis com categorias e nomes em português. O catálogo do Decorar ganha busca e as categorias do Habbo, com o tamanho de cada móvel medido sozinho na primeira vez que alguém o usa (sem curadoria à mão).
- **Móveis de parede:** quadros, janelas, prateleiras, cartazes e relógios presos na parede.
- Móveis com **cores** (as variações do Habbo) e todos os **estados** (ligar/desligar genérico).
- Admin pode esconder categorias que não combinam com escritório.
- **Como testar:** buscar "geladeira", "quadro" e "janela", colocar um na parede e trocar a cor de um sofá.

**Notas da implementação:**
- **Catálogo:** `npm run assets:furni` lê a lista da API v2 (com o token, ~18 mil móveis, cache de um dia) e grava `client/public/assets/furni/catalog.json` (1 MB, versionado): **8.683 móveis** (12.067 contando as cores) com nome em português, categoria, tamanho, se senta/deita/anda por cima e se liga/desliga. Ficam de fora os que não são móveis de verdade (créditos, wired, presentes, roupas, anúncios, testes) e as cópias NFT. As variações de cor (`classname*N`) viram um item com as cores.
- **Sob demanda:** o catálogo só tem os dados básicos. Na primeira vez que alguém escolhe um móvel, o servidor mede no imager (direções, âncora de cada direção, estados que o imager desenha) e guarda a definição no banco (tabela `furni_defs`, migration `0025_moveis`); as próximas vezes são imediatas. Leva 1–3 s (até ~10 s nos que têm muitos estados). Os navegadores buscam a definição quando veem um móvel novo (`GET /api/furni/defs/:id`, 20 móveis novos por minuto por pessoa).
- **Painel do Decorar:** busca em português (nome ou classname, sem acento) em tudo, categorias do Habbo com a contagem (Escritório = os 62 curados de sempre; **Parede** = os 582 itens de parede), 60 por vez com "Mostrar mais", miniaturas 3 de cada vez (a mesma fila do editor de roupas, agora em `client/src/ui/thumbQueue.ts`).
- **Parede:** item de parede fica num tile com parede atrás (lado 2 = parede do fundo-direita, 4 = esquerda; a abertura das portas não conta), com a altura escolhida pelo mouse (de 4 em 4 px, até o topo da parede). O centro da imagem vai no ponto da parede; não ocupa o piso nem atrapalha o caminho. Arrastar move pela parede (inclusive para a outra parede).
- **Cores:** escolhendo ou selecionando um móvel com cores aparecem as miniaturas de cada cor; clicar troca no lugar (mensagem `furni.color`, só entre cores do mesmo móvel e do mesmo tamanho).
- **Estados:** os que ligam/desligam no Habbo usam o toggle genérico (clique fora do Decorar anda até o móvel e passa para o próximo estado), inclusive na parede (persiana da janela abre e fecha).
- **Categorias escondidas:** Admin → Convite e salas → Catálogo de móveis. Jogos, música, pets, sons e extras começam escondidos; o servidor recusa colocar de categoria escondida (os curados sempre valem; os já colocados ficam).
- Testes: regras de parede (onde tem parede, porta, altura, não ocupa o piso), busca e categorias, serviço de definições (mede uma vez só mesmo com pedidos simultâneos, falha vira 502 e tenta de novo), categorias escondidas (só admin muda), sala (quadro na parede, troca de cor só do mesmo móvel, categoria escondida) e ponta a ponta (`e2e/tests/catalogo.spec.ts`: jogo escondido não aparece na busca, quadro na parede visto pelo outro, que busca a definição, e troca de cor). O servidor dos testes de ponta a ponta mede sem o imager (`FURNI_MEASURE=offline`). Achado no teste: com dezenas de miniaturas carregando, o pedido da cor nova ficava esperando conexão; agora entram 3 por vez.
- No navegador: quadro grande na parede do fundo, janela que abre/fecha a persiana, poltrona trocada para rosa e a categoria Jogos liberada e escondida de novo (deixei o quadro, a janela e a poltrona na Recepção para você ver).

#### Fase 37 — Móveis animados e interativos ✅ implementada
- Com os `.nitro` dos móveis: **animações** (ventilador girando, lareira, TV, aquário, luzes piscando).
- Assentos e camas reconhecidos pelos dados do Habbo (qualquer cadeira nova já senta).
- **Teleportes** do Habbo ligando duas salas (entra num, sai no outro), dado do Habbo que rola de verdade, jukebox.
- **Como testar:** ligar o ventilador e ver girando; usar um par de teleportes entre a Copa e a Sala do TI.

**Notas da implementação:**
- **Móveis por camadas:** em vez do `.nitro`, o servidor usa o SWF original de cada móvel (`dcr/hof_furni/{revisão}/{classname}.swf`, o mesmo caminho das roupas e efeitos): imagens de 64 px numa folha, mais as camadas, ajustes por direção, animações por estado e cores das variações (`/hh/furni/{classname}.png|json`, cache em disco; só móveis conhecidos). O navegador monta o desenho a cada quadro (24 por segundo, como o Habbo) com a origem no vértice de cima do tile do móvel; ink ADD vira brilho somado, alpha e cores pintam as camadas. Conferido contra o imager em 4 direções (inclusive as espelhadas).
- **Quais:** os que o Habbo anima (`furniture_animated`, ~5.300 do catálogo e 21 dos curados: lareira, TVs, luminárias, computadores, geladeira, cafeteira…). Os outros, os de parede e os que desenham por cima (quadro branco, mesa de jogos, murais) continuam com a imagem do imager. Sem internet (`?offline=1`) também.
- **Luzes:** a luminária acesa agora soma o brilho do próprio Habbo (antes o imager achatava num disco escuro e ela ficava sempre "apagada" no desenho); o brilho da noite continua.
- **Dado** (categoria Dados, 5 modelos): clicar anda até ele, rola (animação do Habbo) e para no número sorteado pelo servidor, com "🎲 tirou N no dado" no chat da sala.
- **Teleportes** (categoria Teleportes, 47 modelos): no Decorar, selecione um e escolha o outro na lista (de qualquer sala) → **Ligar** / **Desligar**. Clicar anda até ele, a porta abre e a pessoa aparece do lado do outro (na outra sala, como passar por uma porta). Tabela `teleport_links` (migration `0026_teleportes`); remover um teleporte desfaz a ligação. São sólidos (no Habbo "dá para pisar").
- **Jukebox** (categoria Música, que começa escondida — o admin libera): clicar liga/desliga; ligada, toca para todos na sala uma música gerada no navegador (acordes, baixo e batida), para quem está com o 🎵 ligado.
- **Assentos e camas** já vinham dos dados do Habbo desde a Fase 36.
- **Clique por pixel** passou a funcionar com as imagens carregadas como ImageBitmap (antes valia a caixa inteira da imagem, e um móvel grande podia "roubar" o clique do vizinho).
- Testes: quadros das animações (repetição, voltas, sorteio), montagem dos sprites (sombra, deslocamento, espelhado, ink, alpha, cor, quadro que falta), leitura da visualização e dos assets do SWF, teleportes (lista, ligar dos dois lados, religar, sala travada, remover desfaz), sala (dado rola e para; teleporte solto avisa, na mesma sala e para outra sala) e ponta a ponta (`e2e/tests/interativos.spec.ts`: dado visto no chat do outro, ligar dois teleportes pelo painel e atravessar).
- No navegador: lareira acesa crepitando, Holo-Dado rolando e parando no 1, par de Portas Teleporte ligado pelo painel e atravessado, Rádio HC ligado (com Música liberada só para o teste e escondida de novo). Deixei a lareira, o dado, os teleportes e o rádio na Recepção.

#### Fase 38 — Pets do Habbo de verdade ✅ implementada
- Troca a pixel art pelos **pets do Habbo** (cachorro, gato, coelho, urso, dragão…, 37 tipos) com as animações deles: andar, sentar, deitar, dormir, comer, pular.
- Os comandos (`/senta`, `/deita`, `/vem`) continuam; quem já tem pet escolhe a versão nova.
- **Como testar:** adotar um pet do Habbo, ver andando atrás de você e obedecendo.

**Notas da implementação:**
- **Catálogo:** `npm run assets:pets` lê as 37 bibliotecas de pet da HabboAssets e grava `client/public/assets/pets/pets.json` com **33 tipos** (nome em português, revisão, paletas e posturas). Ficam de fora a pedra de 1º de abril, o monstro-caixa, a planta que não anda e o cavalo (pinta corpo e crina com paletas separadas).
- **Desenho:** o mesmo sistema de camadas dos móveis animados (Fase 37), agora com deslocamento por direção em cada quadro, 8 direções, posturas (`std`, `mv`, `sit`, `lay`…) e gestos. O servidor converte o SWF do pet já com a paleta escolhida (`/hh/pet/{tipo}.png|json?revision&palette`); a paleta troca cada pixel pela cor do índice no canal verde, como o `paletteMap` do Habbo (as paletas têm 768 ou 772 bytes). A cor escolhida multiplica as partes pintáveis.
- **Na sala:** andando usa `mv` (os dragões voam!), sentado `sit`, deitado `lay` (ou o que o tipo tiver), e ao obedecer faz uma carinha feliz (gesto `sml`) por alguns segundos. Sem internet, cai na arte própria mais parecida.
- **Perfil → Meu pet:** espécie numa lista com "Pets do Habbo" e "Desenhados" (os 4 de antes continuam), padrão da pelagem (até 35) e 12 cores, com prévia ao vivo. Quem tem um pet desenhado vê o aviso da novidade e troca em Editar. Banco: coluna `pets.tint` (migration `0027_pets_habbo`); a espécie do Habbo fica como `hh:{tipo}` e a paleta em `color`.
- Testes: espécie e cor (tipo conhecido, cor padrão, pelagem antiga limitada), postura de cada ação com o que o tipo tiver, API de pets com pet do Habbo, leitura de deslocamento por quadro/posturas/gestos/paleta e ponta a ponta (`e2e/tests/pets.spec.ts`: adotar no Perfil com padrão e cor, o outro vê e ele senta). Achado no teste: o pet criado na sala vinha sem a cor; corrigido.
- No navegador: a Bolota (gata desenhada da Ana) virou o Gato do Habbo, padrão 3, cor caramelo; anda atrás da Ana e senta com `/senta`. Para voltar à desenhada: Perfil → Meu pet → Editar → Desenhados → Gato.

#### Fase 39 — Emblemas do Habbo e acabamento ✅ implementada
- Conquistas com **emblemas reais do Habbo** (no lugar das medalhas em CSS), escolhidos um para cada conquista.
- **Desempenho:** juntar sprites em atlas, pré-carregar a sala, limitar memória com muitas pessoas, e conferir celulares.
- **Como testar:** abrir o Perfil e ver os emblemas; sala com 15 pessoas andando sem travar.

**Notas da implementação:**
- **Emblemas:** cada uma das 19 conquistas ganhou um emblema de conquista do Habbo (`ACH_…`, conferidos um a um na CDN): balões de chat para conversar, envelope para a primeira mensagem privada, chave para explorar as salas, árvore para entrar 7 dias seguidos, cachorrinho para adotar um pet, joinha para elogios, dados para a sorte… O servidor serve só esses códigos, com cache (`/hh/badge/{código}.gif`). Aparecem no Perfil, no cartão do avatar e no aviso de conquista; bloqueados ficam apagados. Sem internet (ou se a imagem falhar), volta a medalha antiga com emoji.
- **Desempenho medido** com 15 robôs andando e falando na Recepção (16 pessoas): atualizar e desenhar um quadro custa ~0,3 ms (p95 2–3 ms), longe dos 16 ms de um quadro a 60 fps. Por isso o atlas de sprites e o pré-carregamento de sala ficaram de fora: não havia gargalo para resolver. No celular (375×812) a sala com as 16 pessoas abre e anima normalmente.
- **Memória:** o cache de poses de cada avatar descartava poses sem liberar a textura da GPU (passou de 800 texturas em poucos minutos). Agora é LRU, com no máximo 160 poses por figura, e as descartadas (e as das figuras que saem do cache) são liberadas da GPU.
- **Achados na carga:** a limpeza do histórico do chat falhava quando a mensagem apagada tinha uma resposta mais nova (no banco de desenvolvimento a coluna `reply_to_id` perdeu o `ON DELETE SET NULL` numa migração antiga) e a mensagem nova não era gravada; agora a citação é desfeita antes. O robô de teste (`npm run bot`) espera quando bate no limite de entradas por minuto e aceita até 20 robôs.
- Testes: emblemas únicos com código do Habbo, rota dos emblemas (só os conhecidos, baixados uma vez), móvel/pet desconhecido não baixa nada e limpeza do histórico com resposta a mensagem antiga.

### Decisões para aprovar antes da Fase 31
1. **Ordem:** a acima (avatar montado → animações → sentar/deitar → itens/efeitos → roupas → móveis → móveis animados → pets → emblemas).
2. **Token da HabboAssets:** criar uma conta gratuita em habboassets.com e gerar um token de API (só é preciso a partir da Fase 36). Vai no `.env` como `HABBOASSETS_API_KEY`, só no servidor.
3. **Roupas:** todas as usáveis, **inclusive** as de clube (HC) e raras? (Sugestão: todas, menos as marcadas como NFT.)
4. **Móveis:** catálogo inteiro com busca, e o admin esconde categorias? Ou uma seleção de escritório? (Sugestão: inteiro, com categorias de festa/jogos escondidas por padrão.)
5. **Uso dos gráficos:** continua o mesmo: uso pessoal e privado, escritório fechado por convite, gráficos da Sulake via HabboAssets.
6. **Fora deste roadmap:** deploy na Oracle e WebRTC continuam adiados.

---

## 14. Roadmap v6 — experiência do usuário (UI/UX) (proposta)

Pedido em 20/10/2026, com o escritório já em uso pelo pessoal do trabalho (servidor no PC Windows): **melhorar a experiência de uso** — deixar tudo mais claro, mais rápido de achar e mais agradável, no computador e no celular. Mesmo fluxo de sempre: uma fase por vez, testada pelo mouse, com testes, commit e atualização do servidor (`git pull`, `docker compose up -d --build`, túnel).

### O que a auditoria mostrou (20/10/2026)
- **Tela cheia de coisa por cima da sala:** cartão "Clique no piso para andar…" sempre aberto, histórico da conversa cobrindo um terço da sala, selo técnico "Assets: HabboAssets (Habbo BR)", barra de 9 botões embaixo e uma coluna de 5 ícones à direita.
- **Sala pequena demais:** com a Recepção nova (23×20), a câmera abre em 0,5× em telas comuns e os avatares ficam minúsculos; no celular a sala aparece cortada.
- **Celular:** a barra de botões passa da largura da tela (os últimos somem), os botões viram só emoji, o painel de pessoas ocupa o rodapé.
- **Painéis sem padrão:** cada painel com seu jeito (Perfil numa rolagem enorme com conquistas, pet, efeitos e integrações; Decorar com a grade espremida quando o rodapé cresce; Admin com abas); botões, espaçamentos e ícones misturados (emoji + texto).
- **Pouco retorno:** "Preparando móvel…" pode levar 10 s sem progresso; erros aparecem e somem; não há "desfazer"; não fica claro quando a conexão caiu.
- **Primeiro acesso:** depois de criar a conta a pessoa cai na sala sem saber que dá para sentar, decorar, usar `/dado` etc.
- **Acessibilidade:** algumas listas de escolha anunciam o item escolhido em vez do nome do campo; vários botões só têm emoji.

### Fases (ordem sugerida)

#### Fase 40 — Base visual (design system) ✅ implementada
- Cores, espaçamentos, tipografia e raios num só lugar; **componentes únicos** (botão, painel, modal, abas, lista, campo, toast) usados por todas as telas.
- **Ícones** desenhados e consistentes no lugar dos emojis soltos, sempre com nome (dica ao passar o mouse e para leitores de tela).
- Tema escuro refinado e **tema claro** opcional; foco, hover e transições suaves iguais em tudo.
- **Como testar:** abrir Perfil, Equipe, Admin e Decorar e ver o mesmo visual, botões e ícones.
- **Feito:** tokens no topo do `client/src/style.css` (superfícies, bordas, texto, realce, ok/aviso/perigo, sombras, raios, espaços, fontes, transição) e as cores fixas do CSS trocadas por eles; **tema claro** com os mesmos nomes em `:root[data-theme='light']`, escolhido pelo botão sol/lua na coluna da direita (provisório até as configurações da Fase 43), salvo no navegador e aplicado antes de pintar a página; o fundo da cena acompanha. **Ícones SVG** de traço (desenhos do Lucide, ISC) em `client/src/ui/icons.ts` nos botões do canto, de câmera/som, do modo foco, do "Editar sala" e nos X de fechar, todos com nome para leitor de tela. Botões com a mesma transição, anel de foco e "apertar"; `prefers-reduced-motion` desliga as transições. Teste `e2e/tests/tema.spec.ts`.

#### Fase 41 — Tela principal limpa ✅ implementada
- **HUD reorganizado:** barra inferior em grupos (Eu · Pessoas · Conversas · Escritório) com "mais" para o resto; a coluna da direita vira um controle compacto de câmera e som.
- **Conversa que não cobre a sala:** painel lateral recolhível com contador de não lidas e as últimas falas em balões; o cartão de dicas e o selo de assets saem (o selo só para admin, nas configurações).
- **Câmera que enquadra:** a sala abre no zoom que cabe na tela (com níveis intermediários, não só 0,5× e 1×), roda do mouse e pinça para zoom, e "centralizar em mim".
- **Como testar:** entrar na Recepção numa tela de notebook e ver a sala inteira, com os avatares legíveis e nada cobrindo o meio.
- **Feito:** barra de baixo em grupos (Eu: Perfil e Foco · Pessoas: Equipe e Mapa · Conversas: Mensagens e Avisos · Escritório: Agenda e Decorar) com **Mais** (Editar sala e Admin, só para quem pode), rótulos só em telas largas; coluna da direita virou uma barrinha (som ambiente, tema, som de mensagem | aproximar, afastar, **enquadrar a sala**, **centralizar em mim**). A **conversa** é um painel à esquerda, com as falas em balões (as suas à direita), recolhível num botão com contador de novas e lembrado no navegador; o campo de mensagem fica embaixo dele, com ícones. O cartão de dicas saiu (vira a ajuda da Fase 44) e o selo de assets só aparece para admins. **Câmera:** enquadra só o piso e as paredes na área livre (sem a conversa, a barra de baixo e a coluna da direita), com zoom contínuo abaixo de 1× e níveis 1×, 1,5×, 2× e 3× acima; reenquadra ao recolher a conversa e ao redimensionar; roda do mouse e **pinça** no celular. Testes `Camera.test.ts` e `e2e/tests/tela.spec.ts`.


#### Fase 42 — Minha mesa e presença ✅ implementada
- **Minha mesa:** cada pessoa escolhe a sua estação na Recepção (com o nome numa plaquinha na mesa); ao entrar, um botão "Ir para minha mesa" leva e senta.
- **Status sobre o avatar** mais legível (ocupado, ausente, em reunião, foco) e **nomes que não se sobrepõem** com muita gente.
- **Achar alguém:** clicar numa pessoa na lista leva a câmera até ela e a destaca por um instante.
- **Como testar:** escolher a mesa, sair e entrar de novo e ir direto para ela; clicar no nome de um colega e a câmera ir até ele.
- **Feito:** sentado numa estação da Recepção (cadeira `…-cadeira` com a mesa `…-mesa`), uma faixa acima da barra diz se ela está livre (**Ficar com esta mesa** / **Mudar minha mesa para cá**), se é sua (**Deixar mesa**) ou de quem é. A escolha fica na conta (`users.desk`, única; migration `0028_minha_mesa`), vira uma **plaquinha** com o nome na frente da mesa para todos (`desks` no estado da sala) e o botão **Minha mesa** no grupo "Eu": de qualquer sala, volta para a Recepção, anda até a estação e senta. Ao entrar, a faixa convida "Sua mesa está esperando" por 15 s. **Selo sobre a cabeça** maior e desenhado: ocupado (vermelho com traço), ausente (âmbar com relógio) e **em reunião** (roxo, quando a sala tem reunião agora). **Alt** segurado mostra o nome de todos, afastados para não encavalar. Clicar numa pessoa da lista leva a câmera até ela com um círculo pulsando; quem está em outra sala leva até a sala dela. Testes `shared/src/desks.test.ts`, `OfficeRoom.test.ts` (minha mesa) e `e2e/tests/mesa.spec.ts`.


#### Fase 43 — Perfil e configurações ✅ implementada
- **Perfil em abas** (Visual · Pet · Conquistas · Efeitos · Integrações) no lugar da rolagem gigante; editor de visual com prévia maior e animada.
- **Configurações num só lugar:** som, notificações, ambiente, tema, tamanho da letra e "reduzir movimento".
- **Como testar:** trocar de aba no Perfil sem rolar; mudar tema e som em Configurações.
- **Feito:** Perfil em **abas** (Perfil · Pet · Conquistas · Efeitos · Integrações · Conta; setas trocam de aba e a última usada volta aberta), com o cabeçalho do visual em cima; janela mais larga. **Configurações** pela engrenagem da coluna da direita: tema (escuro, claro ou do sistema), **tamanho do texto** (Normal, Grande, Maior: todo `font-size` do CSS multiplica por `--font-scale`), **movimento** (do sistema, reduzir ou normal: desliga transições e animações), som de mensagem, som ambiente com volume, notificações do navegador e, para admins, o diagnóstico da arte (o selo saiu da tela). Tudo salvo no navegador e aplicado antes de pintar a página. O botão de tema e o de som ambiente saíram da coluna (o sino ficou, para silenciar rápido). Editor de visual com prévia maior que **gira sozinha** (pausa ao girar à mão ou com "reduzir movimento"). Teste `e2e/tests/tema.spec.ts` (configurações e abas).


#### Fase 44 — Primeira experiência e ajuda ✅ implementada
- **Tela de entrada** repaginada (avatar animado, explicação curta do escritório, erros claros nos campos).
- **Tour guiado** no primeiro acesso: andar, sentar na sua mesa, falar, emotes, Decorar (pula quando quiser, refaz pela ajuda).
- **Central de ajuda** (tecla `?`): comandos do chat, atalhos e o que cada botão faz; dicas no momento certo (ex.: a primeira vez que alguém abre o Decorar).
- **Como testar:** criar uma conta nova e seguir o tour até sentar na mesa; abrir a ajuda com `?`.
- **Feito:** tela de entrada com uma frase sobre o escritório, avatar girando (também no Entrar, se o navegador lembra de quem é) e **erros embaixo de cada campo** (`aria-invalid`), inclusive os do servidor: convite errado, usuário em uso, nome em uso (com sugestão), senha incorreta e dados inválidos (o servidor agora diz o `field`). **Tour guiado** só para conta nova (marcado ao criar a conta): boas-vindas, andar, escolher a mesa, conversar, emotes, Decorar e a ajuda; cada etapa com ação conclui sozinha quando a pessoa faz, com "Pular etapa" e "Pular tour"; contorno no botão de que fala e cartão perto dele. **Ajuda** com `?` ou em Mais → Ajuda (agora para todos): comandos do chat, emotes, atalhos e o que cada botão faz, e "Refazer o tour guiado". **Dica no momento certo** na primeira vez que alguém abre o Decorar. Testes `e2e/tests/tour.spec.ts`, `conta.spec.ts` (erro no campo) e `auth.test.ts` (campo do erro); nos testes e2e o tour só aparece com `&tour=1`.


#### Fase 45 — Retorno, carregamento e erros ✅ implementada
- **Carregamento** com barra de progresso na entrada e esqueletos nos painéis; "Preparando móvel" com progresso.
- **Avisos** empilhados e coerentes (sucesso, erro, info), erros com o que fazer e **desfazer** para remover móvel, apagar mensagem e soltar pet.
- **Conexão:** faixa "Reconectando…" visível e volta automática sem perder o lugar.
- **Como testar:** remover um móvel e desfazer; derrubar a internet por alguns segundos e ver a faixa e a volta.
- **Feito:** **tela de carregamento** com barra (preparando → conectando → entrando na sala → arte da sala, que acompanha os downloads de texturas e camadas de móveis pelo contador `assets/progress.ts`; sai com 90% ou em 8 s); **esqueletos** cintilando no lugar de "Carregando…" em Equipe, Agenda, Mapa, Mensagens, Admin, Perfil e editor de salas; "Preparando móvel" do catálogo com girador. **Avisos empilhados** (até 4, com ícone de sucesso/erro, fechar e ação), erros do servidor como aviso de erro. **Desfazer** em remover móvel (volta no mesmo lugar), apagar mensagem e soltar pet (os dois últimos só vão ao servidor quando o aviso some). **Faixa de conexão** no alto com girador enquanto reconecta e aviso "Conectado de novo" ao voltar (a queda curta continua voltando no mesmo lugar; reinício do servidor volta para a entrada da sala). Testes `decorar.spec.ts` (remover e desfazer) e `retorno.spec.ts` (apagar mensagem com desfazer).


#### Fase 46 — Celular de verdade ✅ implementada
- Barra inferior com 5 ícones + "mais", **painéis como gaveta de baixo** (bottom sheet), sala enquadrada na tela.
- **Toque:** tocar para andar, pinça para zoom, segurar sobre alguém para abrir o cartão; teclado que não cobre o campo do chat.
- **Como testar:** num celular, andar, sentar, conversar e abrir o Perfil sem nada cortado.
- **Feito:** até 700px de largura a barra de baixo vira uma faixa só com **5 botões** (Perfil, Foco, Equipe, Mapa, Mensagens) e **Mais** (Minha mesa, Avisos com contador, Agenda, Decorar, Ajuda e os de admin), alvos de 44px e respeitando a área segura do aparelho. Toda janela vira **gaveta de baixo** (largura da tela, puxador, sobe animada; arrastar o cabeçalho para baixo fecha). **Teclado:** `interactive-widget=resizes-content` e, no iOS, `visualViewport` sobe o campo do chat e esconde a barra enquanto o teclado está aberto; campos com 16px para o iOS não dar zoom. **Segurar sobre alguém** abre o cartão (sem andar); pinça já funcionava. Zoom mínimo 0,4× para a sala caber melhor no celular. Deitado (pouca altura): lista de pessoas começa recolhida e as gavetas usam a altura toda. Teste `e2e/tests/celular.spec.ts`.


#### Fase 47 — Decorar sem esforço ✅ implementada
- Painel redesenhado: grade que não espreme, filtros como chips, **favoritos e recentes**, prévia maior do móvel e das cores.
- Ferramentas grandes para girar, mover e remover, **desfazer/refazer**, grade de tiles visível ao arrastar e atalhos sempre à vista.
- **Como testar:** montar um canto da sala usando recentes, girar, desfazer e refazer.
- **Feito:** painel mais largo com categorias em **chips** (rolam de lado), grade de cartões que não espreme, **Recentes** (os 16 últimos colocados) e **Favoritos** (estrela em cada cartão), guardados no navegador; **prévia grande** do móvel escolhido/selecionado e cores maiores. **Ferramentas grandes** sempre à vista: Girar, Remover, **Desfazer** e **Refazer** (também Ctrl+Z e Ctrl+Shift+Z/Ctrl+Y), com histórico de colocar, mover/girar, remover e trocar cor (`scene/DecorHistory.ts`, que segue o id novo de um móvel tirado e posto de volta); o "Desfazer" do aviso de remoção usa o mesmo histórico. **Grade de tiles** aparece enquanto coloca ou arrasta; atalhos em `kbd` no rodapé. No celular o painel é uma gaveta de baixo. Testes `DecorHistory.test.ts` e `e2e/tests/decorar2.spec.ts`.


#### Fase 48 — Acessibilidade e polimento final ✅ implementada
- Navegação completa por teclado nos painéis, nomes certos para leitores de tela, contraste adequado, foco visível.
- Teste automático de acessibilidade (axe) nos testes de ponta a ponta e revisão final de textos e tamanhos.
- **Como testar:** usar Perfil, Equipe e Mensagens só com o teclado; ver o relatório de acessibilidade sem erros graves.
- **Feito:** teste automático com **axe** (`@axe-core/playwright`, só nos testes) em `e2e/tests/acessibilidade.spec.ts`: entrada, sala, Perfil (todas as abas), Equipe, Mensagens, Configurações, Agenda, Mapa, Decorar, Ajuda e o tema claro, sem nenhum problema grave ou crítico. Corrigido o que ele achou: **contraste** do botão azul com texto branco (o azul forte do tema escuro ficou mais escuro, ≥ 4,5:1) e a **lista de pessoas** (o item volta a ser item de lista, com um botão por cima para achar a pessoa). **Teclado:** toda janela recebe o foco ao abrir, Tab/Shift+Tab ficam presos nela e, ao fechar, o foco volta ao botão que a abriu (`ui/a11y.ts`); o painel de Mensagens também leva o foco para dentro e Esc fecha. Achado no caminho: a CSP do servidor bloqueava o script que aplica tema e tamanho do texto antes de pintar; virou o arquivo `public/boot-prefs.js`.

**Roadmap v6 de UI/UX concluído (Fases 40–48).**

- **Móveis e sentar (20/10):** (1) o desenho por camadas do SWF usava o vértice de cima do tile como origem, mas a do Habbo é o **centro** do tile (a base das imagens termina meio tile abaixo dela): tudo que era desenhado por camadas ficava 16 px alto (PC "flutuando" sobre a mesa, arquivo e impressora fora do chão). (2) Agora **todos** os móveis do Habbo usam as camadas (antes só os animados; ficam na imagem pronta os de parede, o quadro branco e a mesa de jogo), com as posições do próprio Habbo. (3) Assentos: as camadas com `z` positivo viram **fatias** ordenadas contra quem senta (profundidade = tile de origem + `z`/1000, como no Habbo): o encosto da cadeira fica na frente das costas de quem senta de costas e as almofadas/braços do sofá na frente de cada lugar. (4) Quem senta num móvel desce meio tile para assentar de verdade (no chão, não). (5) **Girar** só pelas direções que o móvel tem (`nextRotation`): arquivos e impressoras alternam entre as duas, em vez de "não girar" em metade dos cliques.
- **Meu visual (20/10):** catálogo **completo** de roupas: 3.296 peças em 15 categorias (antes 2.416 em 12), com as NFT, peles e rostos unissex e três categorias novas: **Estampa** (`cp`), **Diversos** (`mc`, itens na mão) e **Pet de ombro** (`pt`); o montador da sala ganhou a ordem de desenho desses tipos e um quadro largo para o pet/item não sair cortado. Editor: miniaturas na proporção original (antes eram forçadas a 34×84 e esticavam), com reserva "vestido em você" quando a prévia da CDN não existe; **provador** (passar o mouse mostra a peça na prévia grande); **Desfazer** (botão e Ctrl+Z); looks redesenhados (espaço vazio com "Guardar" em vez do disquete escondido, trocar/apagar ao passar o mouse, mensagem de confirmação); abrir "Meu visual" de novo não empilha outro editor.
- **Ajuste (20/10):** a luz do dia e noite amarelava a sala no fim da tarde. Agora os tons de entardecer e noite são bem leves e o efeito fica **desligado por padrão**, com interruptor em Configurações (salvo por pessoa; `?hora=` continua forçando para testar).


### Decisões para aprovar antes da Fase 40
1. **Ordem:** a acima (base visual → tela principal → minha mesa → perfil/configurações → primeira experiência → retorno → celular → decorar → acessibilidade)? Alternativa: trazer o celular (46) para logo depois da tela principal, se muita gente for usar pelo celular.
2. **Estilo dos ícones:** traço simples e moderno (estilo Lucide) ou pixel art no clima do Habbo?
3. **Tema claro:** fazer junto na Fase 40 ou ficar só com o escuro por enquanto?
4. **Minha mesa:** cada pessoa escolhe livremente uma mesa livre, ou o admin distribui as mesas?
5. **Tour:** aparece só para contas novas ou também uma vez para quem já usa?

## 15. Chamadas de áudio e vídeo (aprovado em 20/10/2026)

Pedido: chamar uma pessoa específica pelo cartão dela, com o motivo, e ela aceita ou recusa;
aceitando, abre um canal de áudio só para as duas (e dá para chamar mais gente para o mesmo
canal). Vídeo e compartilhar tela ficam para a fase seguinte, com a estrutura já preparada.

### Fase 49 — Chamadas de áudio por convite ✅ implementada
- **Convidar:** "Chamar para conversa" no cartão da pessoa, com o motivo (sugestões rápidas). Quem está numa chamada vê "Adicionar à chamada".
- **Receber:** convite com quem chama, o motivo e quem já está na conversa, com **Aceitar** e **Recusar**; som e notificação do navegador (sem som em Foco/Ocupado); expira em 45 s e quem chamou fica sabendo (recusou, não respondeu, está em outra chamada, saiu).
- **Chamada:** canal de áudio entre os participantes, em qualquer sala; painel flutuante com quem está, tempo, **mudo** e **sair**; anel de "falando" no avatar e na lista. Até 6 pessoas (cada um conectado com cada um, WebRTC). Com uma pessoa só, a chamada acaba.
- **Rede:** sinalização pelo canal global (lobby); STUN da Cloudflare sempre; **TURN da Cloudflare** quando houver `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` no `.env` (credenciais temporárias geradas pelo servidor). Guia em `docs/TURN-CLOUDFLARE.md`.
- **Estrutura pronta para a Fase 50:** cada participante já anuncia `mic`/`cam`/`screen` e a conexão já tem transceptores de vídeo prontos para receber trilhas.
- **Como testar:** chamar alguém, a pessoa aceitar e conversar; chamar uma terceira; recusar; deixar expirar.

- **Feito:** `shared/src/calls.ts` (protocolo), `server/src/services/CallService.ts` (convites, chamadas, limite de 6, expirar, sair), `TurnService.ts` (credenciais temporárias da Cloudflare, 12 h, renovadas a cada 6 h; sem chave, só STUN), canal global repassando convites, estado e sinalização (só entre participantes e só para a aba que fala), `client/src/net/CallManager.ts` (malha WebRTC; quem tem o id menor oferece; transceptor de vídeo já reservado; quem está falando pelo volume) e `client/src/ui/calls.ts` (caixa de convite com motivo e sugestões, cartão "está chamando você" com tempo e Aceitar/Recusar, painel com tempo, participantes, mudo e sair). Toque de chamada (mesmo com o som de mensagem desligado; sem som em Foco/Ocupado) e notificação do navegador; anel verde nos pés de quem fala. Dois ajustes no servidor que bloqueavam: o cabeçalho `Permissions-Policy` proibia o microfone (agora microfone, câmera e tela só para o próprio site) e o limite de mensagem do WebSocket (4 KB) era menor que a oferta WebRTC (agora 32 KB). Testes: `CallService.test.ts`, `TurnService.test.ts`, `LobbyRoom.test.ts` (chamadas) e `e2e/tests/chamada.spec.ts` (3 navegadores com microfone falso, áudio conectado de verdade).

### Fase 50 — Vídeo e compartilhar tela ✅ implementada
- Câmera e tela na mesma chamada (troca de trilha sem renegociar tudo), grade de vídeo no painel, tela compartilhada em destaque, escolha de microfone e câmera.
- **Feito:** o transceptor de vídeo de cada conexão já nasce enviando e recebendo, sem trilha; **Câmera** (640×360, até 30 qps) e **Tela** só trocam a trilha (`replaceTrack`), sem renegociar; a tela tem prioridade sobre a câmera e parar pelo botão do navegador também desliga. Cada um anuncia `cam`/`screen` e o painel mostra a **grade de vídeo** (a sua câmera como espelho, a tela compartilhada em destaque na linha toda), ícones de câmera/tela/mudo por pessoa, **Ampliar** (painel grande no meio da tela; duplo clique num vídeo também) e **Dispositivos** (escolher microfone e câmera, trocados na hora e lembrados no navegador). Teste `e2e/tests/video.spec.ts` (câmera falsa chegando para o outro, tela compartilhada em destaque, ampliar, desligar).
- **Correções de 20/10 (testando com o túnel):** (1) quem demorava a liberar o microfone respondia à oferta sem áudio e sem TURN: a sinalização agora espera o microfone e os servidores ICE; (2) com TURN o navegador acha dezenas de candidatos ICE de uma vez, e um por mensagem passava do limite de 20 mensagens/s do canal global, que derrubava a conexão; ela voltava como "outra aba" e o áudio parava ("O áudio está em outra aba"). Agora os candidatos vão em lotes (a cada 100 ms), o limite subiu para 60/s e cada aba tem uma identidade fixa (`tab` ao entrar no canal): se a conexão cair e voltar, a chamada continua nela. Testes: `e2e/tests/chamada-microfone.spec.ts` (microfone demorando a abrir; conexão do canal derrubada no meio da chamada) e `LobbyRoom.test.ts`.

## 16. Fantasias no Meu visual (20/10/2026)

- Aba **Fantasias** no fim das categorias: conjuntos prontos montados com peças do catálogo, cada versão mostrada vestida no próprio avatar (provador ao passar o mouse). Escolher troca só a roupa e os acessórios (blusa, estampa, casaco, acessório, cinto, calça, sapatos, chapéu e acessório de cabeça) e mantém pele, rosto, cabelo, óculos, máscara e pet de ombro.
- Primeira fantasia, **Seiya de Pégaso** (pedido de um colega): tiara alada (`he-4022`), peitoral de herói (`cc-3609`), pernas e botas de armadura (`lg-3607`, `sh-3611`) e camiseta vermelha por baixo (`ch-3030` no masculino, `ch-3351` no feminino), em três versões: **clássica** (branca e vermelha), **com asas** (`ca-5026`) e **azul**.
- **Mais fantasias (20/10, pedido do mesmo colega):** 25 no total, agrupadas por franquia: Cavaleiros do Zodíaco (Seiya ×3), Dragon Ball (Goku, Vegeta), Naruto, One Piece (Luffy), Bleach (Ichigo e Ichigo com a máscara Hollow), Jujutsu Kaisen (Sukuna, Gojo com venda e com óculos), Vocaloid (Hatsune Miku), Pokémon (Ash com um "Pikachu" no ombro, Pikachu, Snorlax, Gengar), Star Wars (Darth Vader, Stormtrooper, Jedi), Harry Potter, Nintendo (Mario, Luigi, Link) e DC (Batman). Tudo com peças do catálogo (quimonos e faixas, a espada grande, macacões com capuz, olhos de laser, sabre de luz, venda…), com versão masculina e feminina. A busca do editor filtra as fantasias pelo nome ou pela franquia. Algumas trazem óculos, máscara, item na mão ou pet de ombro: entram no lugar dos da pessoa e saem ao trocar de fantasia (os óculos da própria pessoa ficam). O cabelo nunca muda (Goku e Miku ficam com o cabelo de quem veste).
- Para criar outra: acrescentar em `shared/src/costumes.ts` (o teste confere que toda fantasia monta um visual válido nos dois gêneros).
- De quebra: a fila de miniaturas do editor travava ao trocar de aba depressa (imagens `loading=lazy` fora da tela nunca terminam); trocar de lista agora libera a fila.

## 17. TV com YouTube (aprovado em 21/10/2026)

Pedido: uma TV onde todo mundo que interage assiste vídeos do YouTube juntos, com fila e votação para pular, no estilo do Watch2Gether. Decisões: qualquer um que assiste controla (pausar, arrastar a barra); entra por link colado (sem chave de API); clicar na TV abre o player numa janela e a tela do móvel mostra a capa; pular com a maioria de quem assiste (quem adicionou pula na hora).

### Fase 51 — TV com YouTube ✅ implementada
- **Assistir junto:** clicar numa **TV Club** ou **TV Clássica** abre a janela da TV (só quem abre ouve). O vídeo toca no mesmo ponto para todos: o servidor guarda a hora em que o vídeo começou e cada player confere a cada segundo, pulando para o ponto certo se passar de 2 s de diferença.
- **Fila:** colar um link do YouTube (watch, youtu.be, shorts, embed, live, music; com ou sem `https://`) ou uma **playlist** (até 25 vídeos, lida por um player escondido). Título e canal pelo oEmbed do YouTube (vídeo que não pode ser incorporado ou privado não entra, com o aviso). Até 50 na fila e 15 por pessoa. Cada um tira os seus da fila (admin tira qualquer um).
- **Controles para todos:** tocar/pausar (botão ou clique no vídeo), barra para ir a um ponto; volume, mudo, ampliar e tela cheia são de cada um. Quando o vídeo acaba passa sozinho para o próximo (a duração vem do primeiro player que carregar).
- **Pular:** quem adicionou o vídeo (ou um admin) pula na hora; os outros votam e pula com a maioria de quem está com a TV aberta (duas abas contam uma vez; quem sai deixa de votar).
- **Na sala:** a TV liga (estado aceso) e a tela mostra a capa do vídeo, encaixada na perspectiva da tela de cada modelo (cantos medidos nas PNGs).
- **Feito:** `shared/src/tv.ts` (protocolo, leitura de links, posição pelo relógio do servidor, votos), `server/src/services/TvService.ts` (fila, vídeo atual, quem assiste, votos, fim do vídeo por timer; oEmbed com cache), mensagens na `OfficeRoom` (só quem está com a TV aberta controla e vota; TV apagada no Decorar desliga a fila), `server/src/http/tvThumbs.ts` (capa pela própria origem, guardada em disco), CSP liberando o player do YouTube (`script-src` e `frame-src` do youtube/youtube-nocookie), `client/src/tv/player.ts` (API do iframe sem os controles do YouTube; player de mentira nos testes), `client/src/ui/tv.ts` (janela) e `client/src/tv/cover.ts` (capa na tela). Testes: `tv.test.ts`, `TvService.test.ts`, `tvThumbs.test.ts`, `OfficeRoom.test.ts` (TV) e `e2e/tests/tv.spec.ts` (dois navegadores: fila, pausar para os dois, votar e pular, fechar).
- **Como testar:** Decorar → buscar "TV" → colocar a TV Club → clicar nela → colar um link do YouTube; outra pessoa abre a mesma TV e assiste junto.

## 18. Ajustes de 21/10/2026

- **Janelas arrastáveis:** a janela da chamada e a da TV arrastam pela barra de cima (ícone de alça), para qualquer lugar da tela, pequenas ou ampliadas; cada modo lembra a sua posição no navegador e duplo clique na barra volta ao lugar de sempre. A barra nunca sai da tela (nem ao mudar o tamanho da janela). `client/src/ui/draggable.ts`; testes em `video.spec.ts` e `tv.spec.ts`.
- **Meu visual com rolagem:** o corpo do editor cortava o que não cabia (sem rolagem) e a lista de peças tinha altura fixa. Agora a coluna da prévia (com os looks, 3 por linha) rola sozinha; à direita, as categorias ficam em cima, as peças ocupam o espaço que sobra com rolagem própria e as cores ficam numa faixa embaixo, também com rolagem. Em tela baixa (≤ 650 px) as categorias viram uma linha que rola de lado e a prévia encolhe; no celular é uma coluna só, com uma rolagem. Conferido em 1920×1080, 1366×768, 1280×600 e 390×844; teste em `roupas.spec.ts`.
- **Empilhar móveis:** antes nenhum móvel sólido ia em cima de outro. Agora objetos vão em cima dos móveis com **tampo** (`hasTop`: mesas, escrivaninhas, balcões, armários, estantes, divisórias), na altura do tampo (altura de empilhar do Habbo, `stackHeight` onde a curadoria era aproximada: mesa Norja 0,8, Silo 0,7…). Precisa de apoio plano (metade na mesa e metade no chão não dá), assentos e camas só no chão, pilha até 6 de altura, e uma base com coisas em cima não move nem sai ("Tire o que está em cima primeiro"). No catálogo completo, o tampo vem da categoria do Habbo (mesa, estante, divisória) ou do nome (balcão, armário, cômoda, escrivaninha…). No Decorar, apontar para o tampo coloca em cima daquele móvel (o tile é calculado na altura do tampo). Testes em `placement.test.ts`, `FurniDefService.test.ts` e `e2e/tests/empilhar.spec.ts`.
- **Fantasias lentas e "salvar não funciona" (21/10):** a causa era a cota de renders do imager no servidor (45 por minuto, para respeitar o limite público de 60/IP da HabboAssets). A aba Fantasias pedia 25 renders de uma vez (cada miniatura era você vestindo a fantasia), mais um por fantasia sob o mouse e até 8 por visual com a prévia girando; a cota acabava, a prévia ficava em branco e — o pior — o download das roupas (SWF) usava a mesma cota, então o avatar novo não montava na sala depois de salvar. Correções: o SWF agora usa a cota da CDN; as miniaturas das fantasias são imagens prontas (`npm run assets:costumes`, 50 PNG); passar o mouse numa fantasia não pede render; a prévia grande é montada no navegador como na sala (o imager vira reserva) e a imagem antiga fica até a nova estar pronta; e um avatar que não montou é tentado de novo (4 s, 15 s, 45 s) em vez de ficar na reserva para sempre.
- **Miniaturas do Meu visual sempre aparecem:** só entram na fila as que estão à vista (antes as de fora da tela seguravam a vez); servidor lento libera a vez em 10 s; se a imagem da peça falhar (cota do imager), a miniatura é você vestindo a peça montado no navegador; e, se nada der certo, tenta de novo em 8 s em vez de ficar só o número. Conferido simulando o imager fora do ar: todas as miniaturas visíveis apareceram.


## 19. Animações perfeitas, danças, emotes, empilhamento e Salão de Jogos (proposto em 21/10/2026)

Pedido: revisar animações, interação com objetos e empilhamento. Encontrar e documentar os bugs, depois implementar:
1. as correções;
2. danças sincronizadas;
3. emotes novos com "toca aqui";
4. empilhamento melhor;
5. um Salão de Jogos com sinuca (estilo 8 Ball Pool) e ping-pong em tempo real.

O levantamento completo dos bugs está em [`docs/BUGS-ANIMACOES.md`](docs/BUGS-ANIMACOES.md): 20 de animação (AN), 15 de interação (IN) e 20 de Decorar/empilhar (DE), cada um com como reproduzir, causa provável e gravidade.

**Decisões (21/10):**

| Assunto | Decisão |
|---|---|
| Sinuca e ping-pong | Jogados num **painel na tela, com vista de cima**. O avatar fica ao lado da mesa e quem assiste abre o mesmo painel. |
| Danças | **Sem som**, porque as músicas têm direitos autorais. |
| Raquete do ping-pong | Pelo **mouse ou toque**. |
| Sinuca | **30 s por tacada**. Se o tempo acabar é falta, com bola na mão para o adversário. |
| Danças "perto" | Até 5 tiles. |
| Toca aqui | Valida sozinho se a outra pessoa está perto, sem pedir confirmação. |

**Ordem por impacto e esforço** (esforço relativo):

| Fase | O quê | Impacto | Esforço |
|---|---|---|---|
| 52 | Animação e interação sem bugs | alto | médio |
| 53 | Decorar sem frustração | alto | médio |
| 54 | Emotes novos e "toca aqui" | médio-alto | médio |
| 55 | Danças sincronizadas | médio | médio-alto |
| 56 | Empilhamento avançado | médio | médio-alto |
| 57 | Salão de Jogos: sala, mesas, assistir e placar | alto | médio |
| 58 | Ping-pong em tempo real | alto | alto |
| 59 | Sinuca 8 Ball | alto | muito alto |

As fases 52 e 53 vêm primeiro porque corrigem o que já existe e é usado todo dia. A base de poses por parte do corpo da Fase 54 é usada pelas danças (55). O Salão (57) prepara as mesas e os espectadores para os dois jogos (58 e 59).

### Fase 52 — Animação e interação sem bugs ✅ implementada
- **Corrige:**
  - animação: AN1–AN8, AN10, AN11, AN13 e AN14;
  - interação: IN1–IN11, IN13 e IN15.
- **Critérios de aceite:**
  1. Nas 8 direções, segurar e beber mostram os dois braços e o copo. Acenar, joinha e placa usam um braço de cada lado. Teste da montagem por direção e grade de poses conferida.
  2. Clicar em qualquer cama, do escritório ou do catálogo e com ou sem estados, faz o avatar ir até ela e deitar por qualquer tile livre. Também funciona encostada na parede, com cabeça e corpo à vista.
  3. Chegando no assento por qualquer lado (inclusive na diagonal) e com atraso de rede, o avatar termina sentado e virado como o assento. Nunca fica em pé, de lado ou de costas.
  4. Sentado ou deitado:
     - clicar num tile que não dá para alcançar não tira a pessoa do lugar;
     - `/levantar` sai para um tile livre ao lado;
     - usar um móvel não gira o corpo.
  5. Criar, editar ou excluir sala não levanta ninguém. Quem estava num móvel apagado levanta no chão.
  6. Uma recusa ao ir sentar ou usar não trava os comandos, e vale sempre a última intenção.
  7. Um computador em cima de uma mesa é usável de qualquer lado da mesa, inclusive por quem está sentado em frente.
  8. Duplo clique usa o móvel uma vez só, e o teleporte não dispara duas vezes.
  9. Avatar nunca some nem trava a cena por textura liberada em uso. Teste do cache com textura na tela.
  10. Deitado, gestos só mudam o rosto. Dança sentado ou deitado é recusada com aviso.
  11. O copo aparece já no primeiro uso, e o item não some durante o aceno.
- **Testes:**
  - unidade: montagem por direção, posturas, caminho, movimento;
  - sala: deitar, sentar, levantar, editar sala, usar em cima da mesa;
  - ponta a ponta: deitar, sentar chegando de lado, bebida.
- **Feito:**
  - **Montagem do avatar** (`shared/src/figureRender.ts`): nas direções espelhadas (4–6) as partes de um lado trocam de papel, como no Habbo, e os dois braços aparecem com copo, aceno, joinha e placa. Segurar com o outro braço ocupado usa o desenho de carregar (`handGesture`). Mangas seguem o gesto. Deitado não há gesto. Sentado numa diagonal usa a direção par anterior (`sitFacing`), e deitado só tem as direções 2 e 4 (`layFacing`), a mesma regra no servidor e no cliente. A fala não faz o cabelo pular, e roupa animada só recria a textura quando o quadro muda.
  - **Cena** (`client/src/entities/AvatarView.ts`, `client/src/assets/textureHold.ts`): a textura na tela é "segurada" e o cache só destrói as que ninguém mostra (o avatar não some mais nem trava a cena). A direção do servidor vale ao terminar o último passo, e uma folga de 160 ms evita o "engasgo" entre passos. O copo aparece no primeiro uso, porque a pose é pedida de novo quando a biblioteca de itens chega. A cama não é mais fatiada, então o avatar deitado aparece inteiro. Sem o avatar montado, deitar inclina o boneco ao longo da cama.
  - **Servidor** (`OfficeRoom`, `MovementSystem`, `HeldItems`): vale sempre a última intenção (sentar ou usar). O caminho é planejado antes de andar (`plan` e `go`), então uma recusa não deixa passo pendurado. Na cama, entra por qualquer tile livre e escorrega até o travesseiro. Ao chegar, confere se o assento continua lá. `/levantar` sai para um tile livre ao lado. Editar a sala não tira ninguém do lugar. Móvel em cima de mesa se usa de qualquer lado. O duplo clique e o teleporte disparam uma vez só. O item na mão é da pessoa (some em todas as abas), e o registro apaga os vencidos.
  - **Cama cercada (IN16, achado na conferência):** quem está numa cama ou sofá atravessa esse móvel para sair (`passable` na grade), sem parar em cima dele.
  - **Camas do catálogo:** deitam e não ligam/desligam. A altura de deitar segue a da Cama de Casal (`layHeight`), em vez de metade do "h" do Habbo, que inclui a cabeceira e deixava o avatar flutuando. Vale também para as camas já gravadas.
  - **Testes:** `figureRender.test.ts` (braços, gestos, itens e posturas por direção), `pathfinding.test.ts`, `grid.test.ts`, `MovementSystem.test.ts` (`plan`, `go`, `stop`), `textureHold.test.ts`, `HeldItems.test.ts`, `FurniDefService.test.ts` (altura de deitar) e 11 testes de sala em `OfficeRoom.test.ts`, que falham no código antigo. Ponta a ponta: `cama.spec.ts` (deitar no travesseiro, levantar para o café, tirar a cama) e `sentar.spec.ts` (sentar chegando de lado, virado como a cadeira na tela e no servidor).
- **Como testar:**
  1. Decorar → coloque uma Cama de Casal encostada em outros móveis → Concluir → clique na cama e depois no chão.
  2. Pegue um café e gire o avatar.
  3. Acene com o copo na mão.
  4. Sente chegando pelo lado de uma cadeira.

### Fase 53 — Decorar sem frustração ✅ implementada
- **Corrige:** DE1–DE10, DE13–DE17 e DE20.
- **Critérios de aceite:**
  1. Ao pegar um objeto por qualquer ponto do desenho e arrastar, ele acompanha o ponteiro sem pular para trás. Vale também para a parte de cima, para móveis altos no fundo e para coisas em cima de mesas.
  2. Só empilha quando o ponteiro está sobre o tampo. Encostar ao lado de uma mesa não sobe nela.
  3. O fantasma verde ou vermelho fica visível na altura do alvo, por cima dos móveis, e a seleção também aparece.
  4. Teclas e soltar:
     - soltar não pisca de volta para o lugar antigo;
     - R R gira 180°;
     - R durante o arrasto gira o fantasma;
     - Esc cancela.
  5. Desfazer e refazer:
     - só mudam depois da confirmação do servidor;
     - nunca duplicam;
     - o Desfazer do aviso desfaz aquela ação.
  6. Duplo clique não cria cópias empilhadas.
  7. Trocar a cor de uma base com coisas em cima é recusado se a cor nova não tiver o mesmo tampo.
  8. No celular, tocar posiciona o fantasma e um botão confirma. Dois dedos não bagunçam.
- **Testes:**
  - ponta a ponta de arrasto com mouse: pela parte de cima, por cima de mesa, móvel alto, R no arrasto, desfazer depois de uma recusa;
  - unidade: escolha do tile com altura, histórico com falha.
- **Feito:**
  - **Arrastar por qualquer ponto** (`DecorMode`, `surfaceTileAt` em `shared/src/placement.ts`):
    - o objeto guarda onde foi pego (o tile mais perto do ponteiro e a distância até ele) e segue o ponteiro por esse ponto;
    - o tile de destino considera a altura dos tampos: apontar para o tampo escolhe a mesa, e não o piso atrás dela;
    - a frente ou a lateral de um móvel com tampo esconde o piso de trás. Ali, no arrasto, o fantasma fica onde estava; colocando, ele vai para o tampo daquele móvel. Achado na conferência: com a mesa da Recepção (tampo a 1,1), o computador pulava para trás numa faixa de 3 px, e o arquivo do fundo subia no vizinho;
    - o arrasto começa no lugar atual do móvel.
  - **Fantasma visível:** contorno verde/vermelho e seleção azul numa camada por cima dos móveis, na altura do apoio. O fantasma inválido fica na altura do alvo, avermelhado.
  - **Resposta do servidor** (`FurniResult`): colocar, mover, girar, trocar a cor e remover viraram pedidos com resposta.
    - A tela mostra o resultado na hora e volta atrás se o servidor recusar (`FurniPending`): soltar não pisca, R R gira 180°, e remover some na hora e volta se for recusado.
    - O desfazer grava só o que foi aceito, e desfazer/refazer só mudam de pilha com a confirmação.
    - O aviso "removido" só aparece depois da confirmação, e o "Desfazer" dele desfaz aquela remoção.
  - **Teclado e ponteiro:**
    - R no arrasto gira o fantasma e Esc cancela;
    - segurar R, Delete ou Ctrl+Z vale um toque;
    - botão direito/do meio não arrasta nem move a câmera, e um "soltar" perdido (menu de contexto, janela trocada) cancela o arrasto;
    - tapete só arrasta selecionado (senão move a câmera);
    - clique com folga de 3 px para objetos pequenos em cima de uma mesa;
    - sem pixel do desenho, o clique usa o tile do móvel na altura dele.
  - **Colocar:** duplo clique (ou clique enquanto o servidor responde) põe uma cópia só. No celular, tocar posiciona o fantasma e **Colocar aqui** confirma; um segundo dedo cancela o arrasto. O fantasma não segue o mouse por cima do painel.
  - **Regras:**
    - uma base com coisas em cima gira no lugar quando os tiles não mudam (base quadrada ou meia-volta);
    - não move nem gira um assento com alguém sentado (antes o fantasma ficava verde);
    - trocar a cor de uma base com coisas em cima exige o mesmo tampo;
    - as cores de um móvel curado herdam dele o tampo, a altura e o assento (o cofre);
    - móvel de uma direção só avisa ao girar;
    - o verde/vermelho se atualiza quando alguém entra, anda ou sai;
    - braços e encosto do sofá ficam transparentes junto no arrasto;
    - um "Preparando…" antigo do catálogo não troca uma escolha mais nova.
  - **Testes:** `placement.test.ts` (tile com altura, frente da mesa, giro de base com coisas em cima, assento com gente), `DecorHistory.test.ts` (recusa fica no histórico, refazer não duplica, "Desfazer" do aviso), `FurniPending.test.ts`, `FurniDefService.test.ts` (cores do curado), três testes de sala em `OfficeRoom.test.ts` (respostas, troca de cor, giro no lugar) e `e2e/tests/arrastar.spec.ts` (mouse pela parte de cima, na mesa, R, Esc, desfazer depois da recusa, móvel alto do fundo, botão direito, uma direção só, duplo clique, toque no celular e fantasma que fica vermelho quando alguém entra).
- **Como testar:**
  1. No Decorar, arraste o computador de uma mesa pela tela dele.
  2. Arraste um arquivo do fundo pela parte de cima.
  3. Aperte R no meio de um arrasto, e Esc em outro.
  4. Tente tirar uma mesa com coisas em cima e depois aperte Ctrl+Z.
  5. No celular, toque no piso com um móvel escolhido.

### Fase 54 — Emotes novos e "toca aqui" ✅ implementada
- **Base:**
  - poses por parte do corpo (ação, quadro, deslocamento e direção por grupo: cabeça, tronco, braço esquerdo, braço direito, pernas);
  - animações descritas como dados (quadros e tempo).
  - A arte do Habbo não tem esses movimentos prontos: eles são montados com os desenhos que existem, como nas danças do próprio Habbo.
- **Emotes, cada um com comando e no menu:**

  | Emote | Comando |
  |---|---|
  | palmas | `/palmas` |
  | facepalm | `/facepalm` |
  | apontar | `/apontar` |
  | reverência | `/reverencia` |
  | pular | `/pular` |
  | chorar | `/chorar` |
  | dormir | `/dormir` |
  | pensar | `/pensar` |
  | comemorar | `/comemorar` |
  | toca aqui, entre dois avatares | `/tocaaqui nome` ou o botão "Toca aqui" no cartão da pessoa |

- **Critérios de aceite:**
  1. Cada emote está no menu e tem comando. A animação é reconhecível nas 8 direções, sem braços trocados (grade de poses conferida).
  2. Sentado, só tocam os que fazem sentido. Deitado, só os de rosto, como dormir e chorar.
  3. Toca aqui:
     - com a outra pessoa a até 1 tile (ou andando até ela), os dois se viram e batem as mãos ao mesmo tempo, com um efeito, e todos na sala veem;
     - se ela estiver longe ou ocupada, aparece um aviso.
- **Testes:**
  - unidade: pose e duração de cada emote, comandos;
  - sala: toca aqui valida a distância e vira os dois;
  - ponta a ponta: menu, comando e toca aqui em dois navegadores.
- **Feito:**
  - **Pose por parte do corpo** (`shared/src/figureRender.ts`): `FigurePose.parts` dá a cada grupo (cabeça, tronco, braço esquerdo, braço direito, pernas) a sua ação, quadro, deslocamento e giro. No espelho, o deslocamento inverte junto; com giro, a parte usa a direção e o espelho dela. Deitado, a pose por grupo não vale (só o rosto muda).
  - **Animações como dados** (`EMOTE_ANIMS` em `shared/src/avatarAnim.ts`): quadros com o tempo de cada um, a pose dos grupos, o rosto, a fala e o corpo subindo (pulos). Repetem ou param no último quadro. Sentado, tronco e pernas ficam de fora.
  - **Emotes** (desenhos conferidos numa grade de poses nas 8 direções, sem braço trocado):
    - palmas: antebraços para a frente, as mãos se juntando;
    - facepalm: a mão no rosto, cabeça baixa e olhos fechados;
    - apontar: antebraço erguido para a frente;
    - reverência: cabeça e tronco descem e vão para a frente;
    - pular: agacha, sobe com um braço para cima e cai;
    - chorar: rosto triste, soluçando e secando os olhos;
    - dormir: olhos fechados e cabeça caindo;
    - pensar: mão no queixo e cabeça virada;
    - comemorar: soco no ar, pulinhos e sorriso.
  - **Posturas** (`emoteRefusal`): servidor e cliente usam a mesma regra. Sentado valem os de braço e de rosto; deitado, só os de rosto. O menu apaga os que não valem.
  - **Toca aqui:**
    - `/tocaaqui nome` acha a pessoa pelo nome inteiro ou pelo começo; também pelo botão no cartão, ou pelo menu (com quem estiver mais perto);
    - a até 1 tile, os dois se viram e batem as mãos (mão espalmada e a batida), com brilho, e todos na sala veem;
    - até 6 tiles, anda até o lado da pessoa e bate ao chegar;
    - longe, ocupada (status Ocupado, modo foco, sentada, deitada ou andando) ou você mesmo: avisa.
  - **Testes:** `figureRender.test.ts` (ação, deslocamento, giro, deitado e chave de cache por grupo), `avatarAnim.test.ts` (pose e duração de cada emote, posturas, comandos, nome), cinco testes de sala em `OfficeRoom.test.ts` (lado a lado, andando até a pessoa, longe/ocupada/sentado, posturas) e `e2e/tests/emotes.spec.ts` (menu, comando, toca aqui pelo cartão e pelo nome, menu apagado sentado).
- **Como testar:**
  1. No botão 😊, escolha Palmas, Pular, Comemorar…
  2. Sente no chão e veja o menu.
  3. Fique ao lado de alguém e clique no avatar dela, em "Toca aqui", ou escreva `/tocaaqui nome`.

### Fase 55 — Danças sincronizadas ✅ implementada
- **Danças:** Macarena, Thriller, Gangnam Style, YMCA, Floss, Robô e Moonwalk. São inspiradas nas músicas e montadas quadro a quadro com a arte do Habbo (base da Fase 54).
- **Funcionamento:**
  - Começa com `/dancar nome` (ou `/macarena`…) ou pelo menu de danças.
  - Fica em loop até andar, sentar, deitar, trocar de sala ou usar `/parar`.
  - A dança é estado no servidor (qual dança e quando começou), não um emote passageiro.
  - O relógio do servidor dá o compasso. Quem começa a mesma dança perto de alguém que já dança (até 5 tiles) entra no mesmo tempo.
- **Critérios de aceite:**
  1. Cada dança roda em loop e para ao andar ou com `/parar`.
  2. Em dois navegadores, duas pessoas dançando a mesma dança perto ficam no mesmo quadro (diferença de no máximo 1). Quem entra depois na sala vê a dança no tempo certo.
  3. Não dá para dançar sentado ou deitado (com aviso). O antigo `/dancar` vira a escolha de dança.
- **Testes:**
  - unidade: quadro a partir do relógio, regra de "perto";
  - sala: começa e para;
  - ponta a ponta: dois navegadores no mesmo tempo.
- **Feito:**
  - **Coreografias como dados** (`shared/src/dances.ts`): cada dança é uma lista de quadros em batidas, no andamento da música, montada com a pose por parte do corpo da Fase 54. Os quadros novos movem o corpo inteiro: giro (`bodyDd`) e deslize (`bodyDx`).
    - Macarena (103 bpm): braço por braço, mãos no ombro, na cabeça e no quadril, rebolado e pulo. Vira um quarto a cada volta.
    - Thriller (118): braços de zumbi, cabeça tombando, passos de lado, garra e ombros.
    - Gangnam Style (132): rédeas e galope, depois o laço no alto.
    - YMCA (127): as quatro letras e o balanço.
    - Floss (120): braços de um lado para o outro, quadril ao contrário.
    - Robô (100): poses duras, virando aos trancos.
    - Moonwalk (117): desliza para trás andando, gira, ponta dos pés e volta.
    - Todas conferidas quadro a quadro numa tira de filme no navegador.
  - **Estado no servidor:** `Player.dance` e `Player.danceStart`. Quem começa a mesma dança a até 5 tiles de alguém que já dança entra no compasso dele, pelo mais perto (`danceStartFor`, encadeia). A dança para quando a pessoa anda, senta ou deita, por qualquer caminho (conferido a cada tique). Andando, o pedido começa ao parar. Sentado ou deitado: "Levante para dançar."
  - **Relógio:** o cliente pergunta a hora ao servidor (`ClientMessage.Time`) ao entrar e a cada minuto, como o NTP. Fica com a resposta mais rápida, e o quadro sai de `hora do servidor − começo`.
  - **Cliente:** a dança roda em loop na cena, com uma nota 🎵 sobre quem dança; um emote passa na frente e a dança continua depois. O antigo `/dancar` (e o 💃 do menu) abre a escolha das danças, apagada quando a pessoa está sentada. Há também `/macarena`… e `/parar`.
  - **Testes:** `dances.test.ts` (quadro pelo relógio, volta, regra de perto, comandos), quatro testes de sala em `OfficeRoom.test.ts` (começa e para, perto/longe/outra dança, sentado e andando, hora) e `e2e/tests/dancas.spec.ts` (dois navegadores no mesmo quadro, quem entra depois no tempo, `/dancar` abre a escolha, andar e `/parar` param).
- **Como testar:**
  1. Duas pessoas perto: as duas escolhem a mesma dança pelo `/dancar`, em momentos diferentes.
  2. Uma terceira entra na sala depois e vê as duas no mesmo passo.
  3. Ande, ou use `/parar`.

### Fase 56 — Empilhamento avançado ✅ implementada
- **Qualquer móvel empilhável sobre outro.**
  - A regra de tampo nova vale para todo móvel sólido com altura, menos assentos, camas e uma lista de exceções.
  - Blocos e plataformas servem de base.
  - Corrige DE19 e IN14.
- **Altura e profundidade corretas.**
  - Os móveis do escritório passam a usar o tampo do catálogo.
  - A profundidade considera a faixa de altura, para itens acima da cabeça de quem passa.
- **Ajuste fino de altura, como a ferramenta do Habbo.**
  - Com o móvel selecionado: Shift + roda do mouse ou botões ▲▼ no painel, em passos de 0,1, até 6.
  - Fica salvo e visível para todos.
- **Mover a base leva junto o que está em cima**, inclusive ao girar. O desfazer devolve tudo.
- **Sentar em móveis empilhados** (cadeira em cima de plataforma ou bloco): o avatar fica na altura do assento e levanta para o lado.
- **Critérios de aceite:** os cinco itens acima funcionando e testados. Um item empilhado nunca é desenhado atrás da base em nenhuma das 4 rotações, nem atrás de quem passa por trás.
- **Testes:**
  - unidade: regras de tampo, ajuste, grupo;
  - sala: mover em grupo, sentar empilhado;
  - ponta a ponta: empilhar, ajustar a altura, mover em grupo.
- **Feito:**
  - **Regra de tampo** (`shared/src/placement.ts`, `acceptsOnTop`): todo móvel sólido com altura (a partir de 0,3) serve de base, como no Habbo, inclusive os blocos e plataformas de pisar (IN14). Ficam de fora:
    - assentos, camas, tapetes e itens de parede;
    - luzes, plantas, quadros, tabuleiros, TVs e teleportes;
    - o que a curadoria marca com `hasTop: false`.
  - **Catálogo** (`FurniDefService`, `catalogTop`, DE19): as exceções vêm pelo nome e pela categoria (luminárias, abajures, velas, cortinas, plantas, flores, vasos…). A lista antiga de "tem tampo" (só mesas, estantes e alguns nomes) acabou. Os móveis já gravados seguem a regra nova ao carregar.
  - **Altura:** os móveis do escritório usam a altura de empilhar do Habbo, conferida por um teste com o catálogo. O Computador Antigo passou a não ter tampo (altura 0 no Habbo).
  - **Profundidade:** cada móvel ocupa uma faixa de altura (`top` no `DepthBox`). O que está acima da faixa do outro, mesmo erguido, é desenhado na frente dele. Testado nas 4 rotações, com um item normal e um a 3,5, e com alguém passando atrás e na frente.
  - **Mover em grupo:** mover ou girar a base leva junto a pilha inteira (`stackGroup`, `groupMoves`). Cada coisa mantém o lugar em cima da base e gira junto, se tiver a direção.
    - Recusa se alguém estiver em cima ou se algo comprido não couber girado.
    - O servidor responde com tudo o que mudou (`moved`).
    - O cliente mostra a pilha na hora: no arrasto, fantasmas que acompanham; ao soltar ou girar, a prévia. Depois acerta pela resposta.
  - **Ajuste fino de altura:** com o móvel selecionado, ▲▼ no painel ou Shift + roda do mouse, em passos de 0,1 (`ClientMessage.FurniHeight`, `canSetHeight`).
    - Leva junto o que está em cima. Vai do apoio (não afunda no móvel de baixo) até 6 acima do piso, contando a pilha.
    - Os pedidos saem um por vez, no ritmo que o servidor aceita (um a cada 250 ms), sempre com o último alvo: girar a roda rápido não dá "Calma!".
    - Fica salvo e todos veem. Mover recoloca a base no apoio do lugar novo.
  - **Desfazer:** passos seguidos de altura no mesmo móvel viram uma ação só. Desfazer o mover da base devolve a pilha e, se a base estava erguida, a altura dela.
  - **Sentar empilhado:** cadeira em cima de bloco ou plataforma. O avatar senta na altura do assento e `/levantar` sai para um tile livre ao lado, em cima da plataforma ou no chão. Ninguém mexe na base com alguém em cima.
  - **Testes:**
    - unidade: `placement.test.ts` (exceções, blocos, pilha que vai junto com giro e volta, comprida que não gira, ajuste de altura e limites, tampo do catálogo), `depth.test.ts` (4 rotações), `FurniDefService.test.ts` (regra do catálogo e gravados antigos) e `DecorHistory.test.ts` (altura e base erguida);
    - sala: três testes em `OfficeRoom.test.ts` (mover e girar em grupo e voltar, ajuste de altura com limites, sentar numa cadeira em cima de plataforma);
    - ponta a ponta: `empilhar.spec.ts` (arrastar a mesa leva o computador, ▲ e Shift + roda, desfazer).
- **Como testar:**
  1. Decorar → coloque uma Mesa Norja e um computador em cima → arraste a mesa: o computador vai junto.
  2. Com a mesa selecionada, use ▲▼ no painel ou Shift + roda do mouse: a mesa sobe com o computador. Ctrl+Z volta.
  3. Coloque blocos (ex.: "Bloco de Mármore") e empilhe um em cima do outro.
  4. Ponha uma cadeira em cima de um bloco → Concluir → sente nela e use `/levantar`.

### Fase 57 — Salão de Jogos: sala, mesas, assistir e placar ✅ implementada
- **Sala nova "Salão de Jogos"** com porta na Recepção (e de volta). Ela aparece sozinha nos servidores já instalados ao atualizar, como foi feito com a Recepção.
- **Mesas:**
  - sinuca: a mesa "Snooker" do catálogo do Habbo;
  - ping-pong: arte própria em pixel art, porque o Habbo não tem;
  - mais lugares para a torcida.
- **Base comum das mesas de jogo:**
  - entrar como jogador nas vagas (1×1 ou 2×2), começar e desistir;
  - qualquer pessoa da sala abre a mesa e assiste;
  - placar flutuando sobre a mesa na sala;
  - quem sai da sala ou fecha a aba perde a vaga, com W.O. depois de alguns segundos.
- **Critérios de aceite:**
  1. A porta existe nas duas instalações (nova e atualizada).
  2. Clicar na mesa abre o painel com as vagas. Quem não joga assiste com placar ao vivo, e o placar também aparece sobre a mesa na sala.
  3. Sair libera a vaga.
- **Testes:** sala (vagas, assistir, W.O.) e ponta a ponta (porta, abrir a mesa, assistir).
- **Feito:**
  - **Sala** (`shared/src/rooms.ts`, `GAMES`): duas mesas de sinuca e duas de ping-pong, sofás e cadeiras para a torcida, café e geladeira. A porta fica na parede da esquerda; a de volta, na parede do fundo da Recepção, perto do café, em (15,0).
    - Instalação nova: a sala vem na semente.
    - Instalação atualizada: no boot, `RoomRepository.ensureGamesRoom` cria a sala uma vez só e abre a porta na Recepção. Se o lugar pensado estiver ocupado, a porta vai para o lugar livre mais perto da entrada (`findDoorSpot` com lugar preferido). Se o admin excluir a sala depois, ela não volta.
  - **Mesas:**
    - sinuca: a "Snooker" do Habbo (`bling15_pooltable`), medida com `npm run assets:sync -- --only …` (opção nova, que mede só os móveis pedidos);
    - ping-pong: arte própria em pixel art isométrica, no mesmo tamanho (2×1), com tampo azul, linhas, rede e pés. É gerada por `server/scripts/pingpong-art.ts` e está registrada no ASSETS.md.
    - Nenhuma das duas aceita coisas em cima.
  - **Base das mesas** (`shared/src/arcade.ts`, `server/src/rooms/arcade.ts`): a partida fica no estado da sala (`arcade`), com as vagas, o modo, o placar e o resultado.
    - Vagas 1×1 ou 2×2. Quem entra anda até a ponta da mesa do seu lado e vira para ela.
    - Começar (com as vagas cheias), desistir (o outro lado vence) e sair da vaga (no meio da partida, é desistir). Uma mesa por vez, contando o jogo da velha.
    - Quem sai da sala, fecha a aba ou cai antes da partida perde a vaga na hora. No meio dela, tem 15 s para voltar (por reconexão, recarregando ou pela porta); depois, W.O. para o outro lado.
    - O resultado vai para o placar de vitórias e derrotas de cada um e é avisado no chat ("🏆 venceu … no ping-pong (W.O.)").
  - **Painel** (`client/src/ui/arcade.ts`): abre ao clicar na mesa, para qualquer pessoa da sala. Mostra o placar, a vista de cima da mesa em arte própria (com os nomes nas pontas), o modo, as vagas dos dois lados (com a contagem do W.O.) e os botões de quem joga.
    - Quem não joga vê "Você está assistindo" e o placar ao vivo.
    - Enquanto o jogo de cada mesa não chega (Fases 58 e 59), a partida fica "em andamento" até alguém desistir ou sair. O painel avisa isso.
  - **Placar sobre a mesa:** uma placa flutua sobre a mesa na sala para todos. Mostra quem joga e o placar; quem saiu, com os segundos até o W.O.; e o vencedor no fim.
  - **Testes:**
    - unidade: `arcade.test.ts` (compartilhado: vagas, posições, placar sobre a mesa; servidor: entrar, trocar, modo, começar, desistir, sair, prazo, W.O., voltar a tempo, recarregar), `RoomRepository.test.ts` (o Salão nos bancos de antes, porta preferida ou livre, não volta se excluído) e `roomEdit.test.ts` (lugar preferido);
    - sala: cinco testes em `OfficeRoom.test.ts` (vagas, andar até a ponta e assistir; 2×2 escolhido na mesa vazia; desistir com placar e chat; sair antes e W.O. no meio; voltar a tempo);
    - ponta a ponta: `salao.spec.ts` (porta da Recepção, painel, três navegadores com quem assiste vendo o placar, desistir, mesa livre de novo).
- **Como testar:**
  1. Na Recepção, entre pela porta nova da parede do fundo, perto do café.
  2. Clique numa mesa de ping-pong ou de sinuca e entre numa vaga. Outra pessoa entra no outro lado e alguém clica em Começar.
  3. Uma terceira pessoa abre a mesa e vê o placar no painel e sobre a mesa.
  4. Teste o Desistir, ou feche a aba de um jogador no meio da partida e espere 15 s.

### Fase 58 — Ping-pong em tempo real ✅ implementada
- **Jogo:** painel com vista de cima e arte própria.
  - raquete pelo mouse ou toque;
  - bola com altura, que quica na mesa;
  - física no servidor a 60 Hz, com a raquete local respondendo na hora e a bola suavizada no cliente.
- **Regras:**
  - saque alternado a cada 2 pontos (a cada ponto no 10–10);
  - set de 11 com 2 de vantagem;
  - melhor de 3.
- **Critérios de aceite:**
  1. Uma partida completa em dois navegadores, com placar, sets, saque e deuce certos.
  2. Com 150 ms de atraso simulado continua jogável.
  3. Espectadores veem a bola e o placar em tempo real.
- **Testes:**
  - unidade: pontuação, saque, sets, física da rebatida e do quique;
  - sala: partida simulada;
  - ponta a ponta: dois navegadores marcando pontos.
- **Feito:**
  - **Física e regras compartilhadas** (`shared/src/pong.ts`): a bola anda em trechos de parábola entre eventos (saque, rebatida, quique, rede, chão). Cada trecho começa num instante da hora do servidor, então servidor e navegadores calculam a mesma bola sem mandar a posição a cada quadro.
    - O trecho só muda no saque e na rebatida; os quiques todo mundo calcula igual.
    - Gravidade mais fraca que a real, para dar tempo de jogar, e a bola acelera ao longo do ponto.
    - Rebater mais forte (raquete indo para a frente) manda mais fundo e mais rápido. Pegar com a beirada ou mexendo para o lado manda na diagonal, e diagonal demais sai da mesa.
    - Ponto: dois quiques do mesmo lado, bola que quicou e saiu sem rebatida, rede, quique no próprio lado ou bola fora.
    - Placar: saque trocando a cada 2 pontos (a cada ponto no 10 × 10), set de 11 com 2 de vantagem, melhor de 3. No set seguinte, saca primeiro quem recebeu primeiro. No 2×2, os parceiros se revezam no saque e qualquer um do lado rebate.
    - Simplificação: o saque vai direto para o outro lado, sem quicar antes do próprio lado.
  - **Servidor** (`server/src/rooms/pong.ts`): a partida roda num laço de 60 Hz, só enquanto há partida.
    - A rebatida vem do navegador de quem jogou, com o instante do toque. O servidor volta no tempo até 350 ms e confere se a bola estava ao alcance naquele instante.
    - O ponto só fecha 300 ms depois do lance que o decidiu, para uma rebatida atrasada ainda valer. É isso que deixa jogar com ping alto.
    - Se alguém cai no meio do ponto, o ponto vale de novo e o saque espera a volta (ou o W.O. da Fase 57).
    - Fim da partida: placar de vitórias e aviso no chat com os sets.
  - **Navegador** (`client/src/ui/pong.ts`): o painel da mesa cresce e vira a mesa ao vivo, vista de cima e em arte própria.
    - A minha raquete segue o mouse ou o dedo na hora; as dos outros vêm do estado, suavizadas.
    - O saque e a rebatida aparecem na hora (previstos com as mesmas contas) e o servidor confirma; se recusar, a bola volta ao caminho dela.
    - A bola tem sombra e cresce quanto mais alta vai.
    - Clique (ou toque) para sacar. O painel abre sozinho para quem joga quando a partida começa.
    - Quem assiste vê a bola, as raquetes e o placar ao vivo, também na placa sobre a mesa (com os sets).
    - `?atraso=150` simula ping (ida e volta) no ping-pong, para testar.
  - **Testes:**
    - unidade: `pong.test.ts` (compartilhado: placar, deuce, sets, saque no 1×1 e no 2×2, saque, quique, rebatida, força, diagonal e fora, rede, dois quiques, alcance, zona da raquete, mesmo cálculo em passos; servidor: começo, folga antes do ponto, rebatida conferida no instante do toque, ponto anulado e saque esperando quem saiu);
    - sala: três testes em `OfficeRoom.test.ts` (saque, ponto sem rebatida e saque trocando; rebatida 150 ms atrasada aceita e atrasada demais recusada; fechando os sets, a partida acaba com placar gravado e chat);
    - ponta a ponta: `pingpong.spec.ts` (dois navegadores com 150 ms de atraso simulado, dois pontos, saque trocando, uma devolução de verdade e uma terceira pessoa vendo a bola e o placar).
- **Como testar:**
  1. No Salão de Jogos, duas pessoas entram numa mesa de ping-pong e uma clica em Começar.
  2. Quem saca clica na mesa. Mexa o mouse (ou o dedo) para levar a raquete até a bola depois que ela quicar do seu lado. Indo para a frente na hora do toque, a bola vai mais forte.
  3. Uma terceira pessoa abre a mesa e assiste.
  4. Para testar com ping alto, abra com `?atraso=150` no endereço.

### Fase 59 — Sinuca 8 Ball ✅ implementada
- **Física no servidor.**
  - Bolas com atrito, tabelas e caçapas, e efeito na branca (alto, baixo e de lado).
  - É determinística e compartilhada, para o cliente animar igual. O servidor manda as posições finais.
- **Controles no estilo do 8 Ball Pool:**
  - mira arrastando, com linha-guia (bola-fantasma e direção da bola acertada);
  - força puxando o taco;
  - efeito na branca;
  - bola na mão depois de falta (arrastar a branca);
  - cantar a caçapa da 8;
  - tempo por tacada.
- **Regras:**
  - abertura;
  - mesa aberta até a primeira bola encaçapada definir lisas ou listradas;
  - faltas: branca na caçapa, não acertar nenhuma, acertar primeiro a bola errada, nenhuma bola na tabela depois do contato;
  - bola na mão;
  - vitória e derrota com a 8: cedo, na caçapa errada ou com falta;
  - 1×1 ou 2×2, com as duplas alternando tacadas.
- **Visual próprio:** mesa, bolas numeradas e taco, sem copiar a arte do jogo original. Espectadores veem o placar e as bolas restantes.
- **Critérios de aceite:**
  1. Partida completa 1×1 e 2×2 com todas as regras, inclusive cantar a 8 e bola na mão.
  2. A linha-guia mostra a bola-fantasma e o caminho da bola acertada. Força e efeito mudam a tacada de forma perceptível; com efeito para trás, a branca volta.
  3. Jogadores e espectadores veem as mesmas posições no fim de cada tacada.
- **Testes:**
  - unidade: colisões, tabelas, caçapas e efeito; cada falta, atribuição de grupo e a 8;
  - sala: partidas 1×1 e 2×2 simuladas;
  - ponta a ponta: tacada e placar em dois navegadores.
- **Feito:**
  - **Física e regras compartilhadas** (`shared/src/pool.ts`): a tacada é simulada até as bolas pararem, em passos fixos de 1/360 s, só com somas, multiplicações, divisões e raiz quadrada. O mesmo começo e a mesma tacada dão exatamente o mesmo fim no servidor e em qualquer navegador.
    - Atrito do pano, tabelas com perda (fora das bocas das caçapas) e seis caçapas: os quatro cantos e o meio das tabelas compridas.
    - O choque entre bolas é resolvido no instante exato do contato, na linha dos centros. Assim, o caminho da bola acertada é o que a linha-guia mostra.
    - Efeito: alto faz a branca seguir depois do primeiro choque e baixo faz ela voltar; o de lado muda o rebote na tabela.
    - Juiz da tacada:
      - abertura: a 8 encaçapada volta para a mesa;
      - mesa aberta até a primeira bola encaçapada fora da abertura definir lisas ou listradas;
      - as quatro faltas (branca na caçapa, não acertar nada, acertar primeiro a bola errada, nenhuma bola na tabela depois do contato), com bola na mão para o outro lado;
      - a 8: vence quem a encaçapa na caçapa cantada depois do grupo; perde quem a encaçapa cedo, na caçapa errada ou com falta.
    - 2×2: as duplas alternam as tacadas (A1, B1, A2, B2). Quem encaçapa continua, e a vez seguinte do lado passa para o parceiro.
  - **Servidor** (`server/src/rooms/pool.ts`): quem tem a vez manda a tacada (direção, força, efeito, onde pôs a branca e a caçapa da 8). O servidor confere, simula, julga e manda a tacada gravada e as posições finais.
    - A vez, o placar e o aviso da falta ou do grupo só aparecem quando as bolas param na tela de todos.
    - 30 s por tacada, contados depois que as bolas param. Se o tempo acaba, é falta, com bola na mão para o outro lado. Com alguém fora da sala, o relógio para.
    - Placar: as bolas do próprio grupo já encaçapadas. No fim, placar de vitórias e aviso no chat com o motivo ("a 8 na caçapa cantada").
    - A mira de quem taca vai para os outros até 10 vezes por segundo, para todo mundo ver o taco.
  - **Navegador** (`client/src/ui/pool.ts`): o painel cresce e vira a mesa ao vivo, vista de cima e em arte própria (bolas numeradas, lisas e listradas, taco e tabelas).
    - Mira arrastando na mesa, com a linha-guia: até a bola-fantasma, o caminho da bola acertada e o desvio da branca (ou o rebote na tabela). As setas do teclado afinam a mira.
    - Força: puxe a barra ao lado da mesa e solte para tacar; o taco recua junto.
    - Efeito: clique no círculo da branca onde o taco bate (em cima segue, embaixo volta, dos lados muda o rebote).
    - Bola na mão: arraste a branca (na abertura, só atrás da linha). Se ela caiu, aparece atrás da linha num lugar livre. Num lugar que não dá, ganha um anel vermelho.
    - Na vez da 8, as caçapas piscam: toque numa para cantar.
    - Relógio da tacada, bolas que faltam de cada lado e o aviso da última tacada.
    - Quem assiste vê o taco de quem joga, a animação e o placar, também na placa sobre a mesa (com os grupos). Depois do fim, a mesa final continua à mostra.
    - A tacada é animada a partir do instante do servidor, igual para todos, e termina nas posições que o servidor mandou.
    - Painel das mesas: os botões, as vagas e os textos só são refeitos quando mudam. A mira e as raquetes chegam várias vezes por segundo, e um clique no meio se perdia. A placa sobre a mesa também só é redesenhada quando o texto dela muda.
  - **Testes:**
    - unidade:
      - `shared/src/pool.test.ts`: choque de frente, linha dos centros igual à guia, tabela e efeito de lado, caçapas do canto e do meio, efeito alto, baixo e sem efeito, mesmo resultado depois do JSON, abertura sem bolas encostadas, guia na tabela, bola na mão, a branca que caiu, faltas, grupos, a 8, a 8 na abertura, ordem das duplas e tempo esgotado;
      - `server/src/rooms/pool.test.ts`: começo, recusas, tacada igual à simulação com o resultado só no fim, falta, tempo esgotado e relógio parado, a 8 cantada e na caçapa errada, 2×2;
      - `arcade.test.ts` (placar com os grupos, mesa aberta e motivo do fim) e `client/src/ui/pool.test.ts` (conversão da mesa e bolas que faltam);
    - sala: três testes em `OfficeRoom.test.ts` (abertura igual para todos e tempo esgotado; vitória cantando a 8, com placar e chat; 2×2 com as duplas alternando e falta com bola na mão);
    - ponta a ponta: `sinuca.spec.ts` (abertura e mais uma tacada em dois navegadores; as mesmas bolas para quem joga e quem assiste, iguais à simulação de cada página; placar e grupos; desistência).
- **Como testar:**
  1. No Salão de Jogos, duas pessoas entram numa mesa de sinuca e uma clica em Começar. O lado A abre.
  2. Arraste a branca (atrás da linha), arraste na mesa para mirar e puxe a barra à direita para tacar.
  3. Clique na parte de baixo do círculo da branca e taque reto numa bola: a branca volta.
  4. Uma terceira pessoa abre a mesa e assiste: vê o taco, as bolas rolando e o placar.
  5. Para ver a 8: encaçape o seu grupo; na vez da 8, toque na caçapa e taque.

### Tela de chamada: rostos, efeitos, dispositivos, tela cheia e mini-player ✅ implementada
- **Pedido:**
  1. Sem câmera, o rosto do avatar (visual atual) no lugar do nome; a boca acompanha o volume do microfone e fecha quando a pessoa para de falar; o contorno verde de "falando" continua.
  2. Desfoque de fundo e supressão de ruído, cada um com liga/desliga, salvos para as próximas chamadas.
  3. Botão Dispositivos funcionando: microfone, câmera e saída de áudio, com prévia da câmera e medidor do microfone; trocar durante a chamada não derruba a chamada.
  4. Tela cheia da chamada inteira e, em cada vídeo (câmera ou tela), destacar na janela e tela cheia só daquele vídeo.
  5. Minimizar para um mini-player arrastável num canto (quem fala; mudo, câmera, sair e restaurar), com a chamada seguindo normal.
- **Decisões:** desfoque com o modelo de recorte de pessoa do MediaPipe, servido pelo próprio site (o WebAssembly tem ~13 MB e baixa só na primeira vez que alguém liga o desfoque); supressão de ruído é a do navegador.
- **Feito:**
  - **Quadros** (`client/src/ui/calls.ts`): um por pessoa. Com câmera ou tela, o vídeo; sem, o rosto do avatar de frente (montado no navegador como a prévia do editor, `callFace` em `main.ts`). O servidor manda o visual de cada um na chamada (`figure` em `CallMember`).
    - A boca usa os quadros de fala do avatar: fechada no silêncio e no mudo, entreaberta ou aberta conforme o volume (`mouthFor`, em `client/src/ui/callFace.ts`).
    - O volume de cada um é medido a cada 100 ms em ~43 ms de som e cai devagar (uma sílaba segura a boca e o contorno por alguns décimos, sem piscar). O áudio do navegador retoma no primeiro toque se começar pausado.
  - **Dispositivos e efeitos:** janela própria (antes, a caixa sumia porque o painel se redesenhava logo depois do clique). Microfone com medidor, câmera com prévia, saída de áudio (onde o navegador deixa; no Safari e no Firefox, aviso), desfoque e supressão de ruído. Escolhas salvas em `ev-call-prefs` (`client/src/net/callPrefs.ts`), aproveitando as de antes.
    - Trocar microfone, câmera, ruído ou desfoque troca a trilha nas conexões (`replaceTrack`, sem renegociar).
    - **Desfoque** (`client/src/net/backgroundBlur.ts`): recorta a pessoa e borra o fundo num canvas; o vídeo só sai depois de borrado. Se o navegador não rodar o recorte, a câmera vai sem e avisa. O Vite copia o WebAssembly do pacote para `client/public/mediapipe/wasm` (fora do git); o modelo (`selfie_segmenter.tflite`, 250 KB) fica no repositório. A política de segurança ganhou `'wasm-unsafe-eval'`.
  - **Tela cheia** (`client/src/ui/fullscreen.ts`): a chamada inteira ou um vídeo só. No iPhone, um vídeo vai pelo player do sistema; sem nada disso, cobre a janela.
  - **Destacar:** o vídeo ocupa a janela da chamada (ampliada) e os outros ficam numa faixa; duplo clique no vídeo também.
  - **Mini-player:** quem está falando (ou falou por último), em vídeo ou com o rosto do avatar; mudo, câmera, sair e restaurar. Arrasta pela imagem e lembra o lugar.
  - O painel das mesas e o da chamada só refazem botões quando mudam.
- **Testes:**
  - unidade: `callFace.test.ts` (boca por volume e mudo, quem aparece no mini-player, escolhas salvas) e `CallService.test.ts` (visual de cada um na chamada);
  - ponta a ponta: `chamada-tela.spec.ts` com 3 pessoas, uma no celular (rostos, boca mexendo e fechando no mudo, contorno, dispositivos com medidor e prévia, troca de microfone sem cair, efeitos salvos, câmera com desfoque chegando para o outro, destacar, tela cheia de um vídeo e da chamada, minimizar, arrastar, mudo e sair pelo mini-player, restaurar, painel cabendo no celular); `chamada.spec.ts`, `chamada-microfone.spec.ts` e `video.spec.ts` ajustados aos quadros.
- **Como testar:**
  1. Três pessoas numa chamada, uma com câmera e as outras sem: quem está sem câmera aparece com o rosto do avatar, e a boca mexe enquanto fala.
  2. Em Dispositivos, troque o microfone no meio da conversa, ligue o desfoque e ligue a câmera.
  3. Passe o mouse num vídeo: destaque ou tela cheia. No topo da janela: tela cheia da chamada e minimizar.
  4. Minimizada, use o escritório; mude o mudo pelo mini-player e restaure.

### Qualidade das chamadas: servidor de mídia, câmera e tela juntas, conexão e detalhes ✅ implementada
- **Pedido:** vídeo com a maior qualidade, o menor atraso e o maior fps possíveis, caindo aos poucos quando a rede ou a máquina não aguentam. Tela legível (nitidez) ou fluida (fluidez), à escolha. Câmera e tela ao mesmo tempo: a tela em destaque, a câmera em miniatura móvel e escondível, e dá para trocar e maximizar cada um. Ajuste automático por pessoa, com a tela tendo prioridade na banda. Qualidade nas configurações (Automática, Alta, Economia). Indicador de conexão em cada pessoa e um painel de detalhes (resolução, fps, bitrate, atraso). Medir o antes e o depois, com 3 ou mais pessoas e rede ruim.
- **Decisões:** servidor de mídia na VPS (LiveKit, uma SFU) no lugar da malha, porque as chamadas costumam ter 5 ou mais pessoas; limite subiu de 6 para 12.
- **Feito:**
  - **Servidor de mídia:** serviço `livekit` no `docker-compose.yml` (`livekit.yaml`), com UDP 7882 e TCP 7881 abertos; o Caddy encaminha `/livekit` para ele.
    - O escritório continua cuidando de convites e participantes. Em vez de repassar a sinalização WebRTC, entrega uma **credencial** só para quem está na chamada, só na aba que fala, só para a sala daquela chamada (`MediaService`, `CallMessage.Token`). Quem sai é tirado da sala na hora (evento `left` do `CallService`).
    - O TURN da Cloudflare vai junto para o navegador. Em desenvolvimento e nos testes: `livekit-server --dev` (`scripts/livekit-dev.mjs`, `brew install livekit`).
  - **Envio** (`client/src/net/CallManager.ts`, `QUALITY_PLANS`):
    - câmera capturada em até 1080p a 30 fps, em 3 camadas (simulcast: 1080p, 540p e 180p), cedendo resolução e fps juntos;
    - tela em nitidez (guarda a resolução, cede fps) ou fluidez (guarda o fps, até 60 na Alta), com prioridade alta na banda e a câmera com prioridade baixa;
    - camada que ninguém está vendo não é codificada (dynacast).
  - **Recebimento:**
    - cada vídeo chega no tamanho do quadro onde aparece (em dobro na tela retina), e quadro escondido não recebe vídeo;
    - destacar um vídeo faz a qualidade dele subir;
    - na Economia, as camadas menores.
  - **Câmera e tela juntas** (`client/src/ui/calls.ts`): a tela em destaque e a câmera numa miniatura que arrasta dentro do quadro, esconde e mostra, troca de lugar com a tela (botão ou duplo clique) e vai sozinha para a tela cheia.
  - **Compartilhar:** antes de escolher a tela, Nitidez ou Fluidez (salvo); compartilhando, um botão troca o modo sem escolher a tela de novo.
  - **Qualidade** em Dispositivos: Automática, Alta ou Economia, salva em `ev-call-prefs` e aplicada na hora.
  - **Conexão:** pontinho verde, amarelo ou vermelho no nome de cada um (a qualidade de conexão que o LiveKit mede).
  - **Detalhes da conexão** (botão no topo da janela): cada vídeo que sai (as camadas) e que chega, com resolução, fps, bitrate, perda, motivo de limitação e atraso estimado, atualizando a cada segundo.
  - A política de segurança libera o servidor de mídia quando ele está em outro endereço (desenvolvimento e testes).
- **Medição** (`npm run medir:chamada`, `e2e/medicao/`): navegadores em Docker, um por pessoa, rede ruim com `tc netem`, atraso real medido por um relógio desenhado no vídeo. O antes e o depois ficam em [docs/MEDICAO-CHAMADAS.md](docs/MEDICAO-CHAMADAS.md).
- **Testes:**
  - unidade: escolhas salvas (qualidade e modo da tela), credencial da sala de mídia só para quem está na chamada e na aba que fala, quem sai é tirado da sala, limite de pessoas, política de segurança;
  - ponta a ponta: `chamada-qualidade.spec.ts` com 3 pessoas (câmera e tela juntas, miniatura trocando, escondendo, arrastando e em tela cheia, indicador de conexão, detalhes, nitidez/fluidez, Economia saindo em até 360p); os outros testes de chamada passam pelo LiveKit.
- **Como testar:**
  1. Numa chamada, ligue a câmera e compartilhe a tela: os outros veem a tela grande e você na miniatura.
  2. Abra os Detalhes da conexão (ícone de atividade no topo) e destaque alguém: a resolução sobe.
  3. Em Dispositivos, troque a qualidade para Economia e veja a câmera sair em 360p.

### Depois da primeira reunião de verdade (25/10/2026) ✅ implementada
- **Como foi a reunião de 24/10** (registros da VPS): 5 pessoas, das 17h07 às 19h32, sem nenhum erro no servidor (processador folgado, menos de 1 GB de memória). As travadas vieram da internet de envio de duas pessoas (uma com perda de pacotes, outra com banda limitada por uns 13 minutos), e o servidor de mídia baixou a qualidade só delas. Uma conta aparecia duas vezes na Recepção (duas abas).
- **Pedido:** uma presença por conta, o ajuste de rede do servidor de mídia, avisar quem está com internet fraca, voltar sozinho para a chamada, e os extras X1 (olhar para quem fala), X3 (ranking e conquistas do Salão) e X4 (torcida).
- **Feito:**
  - **Uma aba por pessoa:** cada aba manda a sua identidade (`client/src/net/tab.ts`) ao entrar nas salas e no canal global. Entrar por outra aba ou aparelho tira as conexões das outras abas da mesma conta (`PresenceRegistry.claim`, ouvido por cada sala e pelo canal global), e a aba antiga mostra "Você abriu o escritório em outra aba ou aparelho" com **Usar aqui** (recarrega e tira a outra). A aba substituída não volta sozinha ao reconectar (recusa com o código `4409`); recarregar a página pode. Trocar de sala pela mesma aba não tira ninguém.
  - **Rede do servidor de mídia:** na VPS, `/etc/sysctl.d/60-livekit.conf` sobe o buffer de UDP para 5 MB (`net.core.rmem_max`/`wmem_max`), o tamanho que o LiveKit pede para produção; o aviso dele sumiu.
  - **Voltar sozinho para a chamada:** quem cai (aba fechada, recarregada, sem internet além dos 30 s de reconexão, ou a conta aberta em outra aba) fica na chamada como "reconectando…" por 60 s (`CALL_REJOIN_MS`, `CallService.hold`/`resume`), já fora da sala de mídia e com câmera e tela desligadas. Voltando nesse prazo, a página nova entra na chamada sozinha e avisa "Você voltou para a chamada.". **Sair** continua saindo na hora, e um admin tirar do escritório também. Com duas abas abertas, fechar a que fala passa a chamada para a outra.
  - **Internet fraca:** se a conexão de quem fala fica ruim por 4 s (a medida do servidor de mídia), aparece um aviso no topo da janela da chamada só para essa pessoa, com dicas e **Usar Economia**; some depois de 8 s boa de novo, e fechado não volta por 3 min. Com a chamada minimizada, vira uma notificação.
  - **Olhar para quem fala (X1):** quem está a até 4 tiles de quem falou no chat vira a cabeça para essa pessoa por 3 s (até 2 direções para cada lado; de costas, não vira). O corpo fica como está; andando, deitado, num emote, dançando ou jogando no Salão, nada muda. Tudo no cliente (`facingToward`/`headTurn` em `shared/src/avatarAnim.ts`, `AvatarView.lookAt`), igual para todos porque todos recebem a mesma fala.
  - **Ranking e conquistas do Salão (X3):** o placar guarda as vitórias seguidas e a melhor sequência de cada jogo (migração `0029_sequencias`). No painel da mesa, **🏅 Ranking** mostra os 10 melhores (vitórias, derrotas e 🔥 sequência) e o seu placar. Conquistas novas: **Estreia no Salão** (1ª vitória), **Mestre da Sinuca** (10 na sinuca), **Rei do Ping-pong** (10 no ping-pong) e **Imbatível** (5 seguidas no mesmo jogo).
  - **Torcida (X4):** quem não está jogando tem 👏 😮 🔥 😂 no painel da mesa; o emoji sobe sobre a mesa na sala para todo mundo e pula sobre a vista da mesa no painel. Até 3 seguidas e depois 1 por segundo.
- **Testes:**
  - unidade: segurar e devolver a vaga na chamada (prazo, voltar e cair de novo, o outro sair), aba substituída e volta automática no canal global, chamada passando para a outra aba, ranking com sequência, conquistas e torcida na sala, direção do olhar e giro da cabeça;
  - ponta a ponta: `presenca-e-salao.spec.ts` (mesma conta em dois navegadores e **Usar aqui**; recarregar no meio da chamada e voltar sozinho, com o aviso de internet fraca; a cabeça virando para quem fala e voltando; torcida e ranking com três pessoas).
- **Como testar:**
  1. Abra o escritório em duas abas com a mesma conta: a primeira mostra o aviso, e a pessoa aparece uma vez só na sala.
  2. Numa chamada, recarregue a página: os outros veem "reconectando…" e você volta sozinho.
  3. Pare perto de alguém e peça para a pessoa falar no chat: a cabeça do seu avatar vira para ela.
  4. No Salão de Jogos, jogue uma partida, abra **🏅 Ranking** na mesa e peça para quem assiste torcer.

### Sinuca e ping-pong mais fáceis de jogar (25/10/2026) ✅ implementada
- **Pedido:** a sinuca não explica nada para quem nunca jogou (a vez, o grupo, a falta, a bola na mão, cantar a 8) e a tacada parece forte demais; o ping-pong obriga a clicar o tempo todo. Medir a física contra uma sinuca de verdade antes de mexer, escolher o melhor controle do ping-pong e avaliar 3D.
- **Diagnóstico (medido):**
  - Sinuca: nenhum bug de verdade (choques, caçapas e efeitos corretos). Mas o pano freava de 6 a 8 vezes mais que o real, sem a fase em que a bola desliza, e a barra era linear: metade dela mandava a branca duas mesas, e as tacadas normais (menos de uma mesa) ficavam espremidas nos primeiros 30%. A abertura derrubava a mesma bola em 15 de 16. Na tela, a explicação da falta sumia na tacada seguinte, o placar "1 × 2" não dizia o que contava, e cantar a 8 era só um texto pequeno.
  - Ping-pong: a rebatida já era automática, mas a raquete tinha que ficar a ±11 cm da linha da bola (14% da mesa, uns ±12 px na tela), e cada cm fora do centro desviava a bola 4 cm (direção quase aleatória). Com ping alto, a rebatida do outro aparecia adiantada.
  - 3D: three.js daria pouco ganho de jogabilidade com muito custo; a perspectiva desenhada no canvas dá a leitura da altura e da hora certa sem biblioteca. Escolhida a perspectiva (decisão de 25/10).
- **Feito — sinuca:**
  - **Física** (`shared/src/pool.ts`): atrito em duas fases (desliza a 2 m/s² até 5/7 da velocidade, depois rola a 0,35 m/s²), força em curva (`shotSpeed`: o meio da barra manda a branca uma mesa, o fim quase cinco, a abertura para em uns 4 s) e o triângulo com um desalinhamento de até 0,6 mm sorteado pelo servidor (`rackBalls(random)`). Os navegadores continuam animando a mesma simulação a partir das posições que o servidor manda.
  - **Tela:** painel maior (até 880 px, sem passar da altura da tela; durante a partida as vagas e o modo saem do caminho), faixa da vez ("Sua vez" / "Vez de Fulano") com o objetivo da tacada (`shotGoal`), cartões de cada lado (quem, grupo, quantas faltam, a vez destacada) no lugar do placar ambíguo, histórico das últimas tacadas no estado da mesa (`log`, com a explicação de cada falta por `foulHelp`), linha-guia verde ou vermelha (`firstHitFoul`: "Cuidado: acertar primeiro uma lisa é falta"), mãozinha e anel pulsando na bola na mão, passo próprio para cantar a 8 (a mesa escurece e as caçapas viram botões; sem escolher, não dá para mirar), "Força" e "Efeito" com nome (a força em palavras: fraca, média, forte), botão **Regras** e tutorial de 4 passos na primeira mesa (fica guardado no navegador). Relógio de 45 s por tacada.
- **Feito — ping-pong** (`client/src/ui/pong.ts`, `shared/src/pong.ts`):
  - **Controle:** só para os lados (mouse em qualquer lugar da tela, dedo arrastando em qualquer lugar ou ←/→ e A/D); a raquete espera atrás da linha de fundo e avança sozinha até onde a bola dá para rebater (`interceptX`). Raquete de 15 cm e um ímã de 20 cm que só age com a bola já quicada e perto (`magnetY`). Pegar no centro manda mais forte e fundo; a beirada desvia e sai mais fraca; mexendo para o lado na hora do toque, a bola vai para esse lado. Saque sozinho em 2,5 s (ou clique, espaço, Enter). Parado, não devolve nada: medido contra o robô, 0 devoluções em 40 s.
  - **Perspectiva** para quem joga (`perspective`): a mesa vista do próprio lado, a bola subindo com sombra no tampo, a rede e o adversário lá no fundo, a minha raquete meio transparente. Quem assiste continua com a vista de cima.
  - **Ping alto:** a rebatida do outro que chega atrasada sai de onde a bola estava na tela e alcança o caminho certo em 0,25 s (`catchupTime`); a conferência do servidor não mudou.
  - Dica nas primeiras partidas (até a terceira rebatida).
- **Testes:**
  - unidade: força em curva e distâncias, atrito em duas fases, triângulo sorteado, primeira bola que daria falta, objetivo da tacada, explicação das faltas, histórico no servidor (`pool.test.ts`), alcance, centro e beirada, direção pelo movimento (`pong.test.ts`), perspectiva, ponto de espera em que toda bola passa ao alcance, ímã e o alcance do atraso (`client/src/ui/pong.test.ts`);
  - ponta a ponta: `sinuca.spec.ts` (tutorial, faixa da vez, Regras, cartões, histórico com a explicação) e `pingpong.spec.ts` (raquete só para os lados com o mouse, uma devolução só com o teclado e saque sozinho, com 150 ms de atraso; a bola vista por quem assiste agora é conferida a cada quadro, o que tirou a instabilidade antiga do teste).
- **Jogado de verdade** contra um robô temporário, com 150 ms de atraso, nos dois jogos.
- **Como testar:**
  1. Sente numa mesa de sinuca pela primeira vez: o tutorial aparece. Mire numa bola do outro grupo e veja a linha ficar vermelha.
  2. Faça uma falta: o histórico embaixo da mesa explica a regra.
  3. No ping-pong, mexa o mouse só para os lados (ou use ←/→) e deixe a raquete rebater.

### Jogar sozinho: treino e contra o computador (25/10/2026) ✅ implementada
- **Pedido:** jogar sozinho, principalmente na sinuca (treino livre e contra o computador em três níveis, com todas as regras e cantando a 8); no ping-pong, máquina de bolas ou computador. Quem está na sala assiste, e a mesa fica liberada se alguém quiser jogar de verdade (quem treina aceita ou recusa).
- **Decisões (25/10):** contra o computador não conta no placar, no ranking nem nas conquistas (nem vai para o chat); aceitando o pedido, os dois viram adversários (quem treinava fica na vaga, quem pediu entra na outra); sem resposta em 20 s, a mesa é liberada.
- **Feito:**
  - **Base** (`shared/src/arcade.ts`, `server/src/rooms/arcade.ts`): a mesa ganhou `solo` ('practice' | 'cpu'), `level` (fácil, médio, difícil) e o pedido (`askSession`, `askName`, `askUntil`). O computador e a máquina de bolas ocupam a vaga do outro lado com a sessão `cpu` (`soloOpponentName`), e o resto (vez, saque, placar, W.O.) funciona como numa partida entre pessoas. Só dá para jogar sozinho com a mesa só sua, no 1×1. Sair da vaga, parar o treino ou sair da sala libera a mesa na hora, sem vencedor; depois de jogar contra o computador, a vaga dele fica livre para quem chegar.
  - **Pedir a mesa:** quem assiste vê "Fulano está treinando" e **Pedir a mesa**; quem treina recebe aviso com som e, no painel, **Jogar contra Fulano** ou **Continuar sozinho**, com a contagem. Aceitando (ou sem resposta em 20 s), o treino acaba e quem pediu entra na vaga do outro lado e anda até a mesa; recusando, ele é avisado. Se quem pediu sair da sala, o pedido cai.
  - **Treino de sinuca** (`server/src/rooms/pool.ts`): a vez é sempre de quem treina, sem relógio e sem falta mudando nada; a branca vai onde a pessoa quiser. Dá para **arrastar qualquer bola** (`PoolPlace`, sem sobrepor), **repetir a última tacada** (as bolas voltam e a mira e o efeito também, com a marca da força na barra) e **arrumar de novo**. O histórico diz o que caiu.
  - **Computador da sinuca** (`server/src/rooms/poolCpu.ts`): procura as tacadas diretas com caminho livre (bola certa, caçapa e corte possível), confere as melhores simulando a tacada de verdade e erra a mira e a força conforme o nível; com bola na mão, testa lugares para a branca; sem tacada direta, encosta numa bola certa para não fazer falta; na vez da 8, canta a caçapa. Ele "pensa" 1,4–2,6 s e o taco aparece mirando antes de tacar. Medido em 80 mesas sorteadas: fácil encaçapa ~25% (falta ~28%), médio ~60%, difícil ~90% (falta ~3%), em menos de 1 ms por decisão.
  - **Ping-pong** (`server/src/rooms/pong.ts`): a **máquina de bolas** lança sozinha (no difícil, mais rápida, mais funda e mais aberta) e o placar vira devolvidas × perdidas, sem fim; o **computador** saca sozinho e rebate com o tempo de reação, a velocidade da raquete e a chance de errar do nível, mandando a bola para longe de quem joga (no difícil). A raquete dele anda na mesa para todo mundo ver; a máquina aparece como uma caixa cinza.
  - **Painel:** só você na mesa, aparece **Jogar sozinho** (Treino livre ou Máquina de bolas, Contra o computador, e o nível, guardado no navegador). Jogando sozinho, **Parar treino** ou **Desistir**; no treino de sinuca, **Repetir a última tacada** e **Arrumar de novo**. A placa sobre a mesa diz "Fulano treinando".
- **Testes:**
  - unidade: regras de jogar sozinho, pedido aceito, recusado e vencido, e o computador saindo da vaga (`arcade.test.ts`); computador da sinuca por nível, bola fácil, a 8 cantada, abertura e bola na mão (`poolCpu.test.ts`); treino de sinuca e a vez do computador (`pool.test.ts`); máquina de bolas e computador do ping-pong, com os níveis (`pong.test.ts`); vista e placa (`shared/src/arcade.test.ts`); na sala, contra o computador sem ranking nem chat, pedido recusado e aceito, e o prazo vencendo (`OfficeRoom.test.ts`);
  - ponta a ponta: `jogar-sozinho.spec.ts` (treino de sinuca arrastando bola, repetindo e arrumando; pedido da mesa aceito; ping-pong contra o computador devolvendo e a máquina de bolas).
- **Como testar:**
  1. Sente sozinho numa mesa de sinuca e clique em **Treino livre**: arraste bolas, taque, **Repetir a última tacada**.
  2. Outra pessoa abre a mesa e clica em **Pedir a mesa**: responda no painel.
  3. Numa mesa de ping-pong, escolha o nível e **Contra o computador** ou **Máquina de bolas**.

### Extras sugeridos (fora do pedido; dá para encaixar depois)

| Código | Ideia | Impacto | Esforço |
|---|---|---|---|
| X1 | ✅ **Olhar para quem fala** (feito em 25/10/2026) | médio | baixo |
| X2 | **Cochilo automático:** ausente há 10 min, fecha os olhos e mostra "Zzz" (usa o emote dormir) | baixo | baixo |
| X3 | ✅ **Ranking e conquistas do Salão de Jogos** (feito em 25/10/2026) | médio | médio |
| X4 | ✅ **Torcida** (feito em 25/10/2026) | médio | baixo |
| X5 | **Gesto de "pegar"** na geladeira ou no café antes de ficar com o item | baixo | baixo |
| X6 | **Teste visual automático das poses:** grade comparada com imagens de referência, para pegar regressões de animação | médio | médio |
