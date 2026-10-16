# Escritório Virtual

Escritório virtual isométrico para amigos e colegas (até ~10 pessoas online): avatares no estilo Habbo andando por salas, conversando por balões de chat, sentando nas cadeiras e decorando o espaço juntos. Projeto pessoal, sem fins comerciais.

- **Requisitos:** [SPEC.md](SPEC.md) · **Plano e decisões:** [PLAN.md](PLAN.md) · **Origem dos assets:** [ASSETS.md](ASSETS.md)

## O que dá para fazer

- Entrar com um nome e o código de convite; o navegador lembra de você.
- Montar o visual do avatar (270 peças do Habbo Brasil, cores das paletas reais) na entrada ou pelo botão **Meu visual**.
- Andar clicando no piso, com desvio de móveis e outras pessoas, sincronizado em tempo real.
- Conversar: **Enter** abre o campo de mensagem; a fala aparece em balão sobre o avatar e fica no histórico **Conversa**. Há um som de mensagem opcional (🔔/🔕).
- Três salas: **Recepção**, **Sala de reunião** e **Copa**, ligadas por portas. Dá para abrir direto numa sala pela URL: `#/reception`, `#/meeting`, `#/pantry`.
- Sentar: clique numa cadeira ou sofá.
- Decorar: botão **Decorar** → escolha um móvel no catálogo e clique no piso. Clique num móvel para selecionar, arraste para mover, **R** gira, **Delete** remove, **Esc** cancela. Tudo fica salvo.

## Rodar localmente

Requer Node.js 22 ou mais recente (testado com o 24).

```bash
npm install
```

```bash
cp .env.example .env
```

(O `.env` é opcional em desenvolvimento.) Depois:

```bash
npm run dev
```

Isso sobe o servidor (http://localhost:2567) e o cliente (http://localhost:5173). Abra o cliente e entre com um nome e o código de convite: o `INVITE_CODE` do `.env`, ou `convite` se não houver `.env`.

Para testar com várias pessoas sozinho, abra uma janela **anônima** (cada navegador guarda o próprio acesso) ou rode robôs que passeiam e conversam na Recepção:

```bash
npm run bot -- Bia 3
```

Opções de URL do cliente: `?offline=1` usa só a arte provisória gerada por código (sem chamar a HabboAssets); `?debug=1` desenha os footprints da ordenação de profundidade.

### Variáveis de ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `INVITE_CODE` | `convite` em dev; **obrigatória** em produção | Código pedido na entrada |
| `HABBOASSETS_API_KEY` | vazio | Token gratuito da HabboAssets (só no servidor), usado pelo `assets:sync` para ler dados de móveis |
| `PORT` | `2567` | Porta HTTP/WebSocket |
| `DATABASE_PATH` | `./data/sqlite.db` | Arquivo SQLite |
| `ASSET_CACHE_DIR` | `./data/asset-cache` | Cache em disco das imagens da HabboAssets |

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor (tsx watch) + cliente (Vite) juntos |
| `npm run dev:server` / `npm run dev:client` | Só um dos dois |
| `npm test` | Testes unitários e de integração (Vitest) |
| `npm run typecheck` | Checagem de tipos de todos os pacotes |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build` | Build de produção do cliente (`client/dist`) |
| `npm start` | Servidor em modo produção (serve o `client/dist`) |
| `npm run bot` | Robôs de teste |
| `npm run assets:sync` | Regera os manifestos de roupas e móveis a partir da HabboAssets |
| `npm run db:generate` | Gera migration SQL após mudar `server/src/db/schema.ts` |

## Estrutura

```
shared/   código comum: coordenadas isométricas, A*, ordenação de profundidade, regras de
          colocação de móveis, validação de visual, protocolo de rede e estado sincronizado
server/   Express + Colyseus no mesmo processo; SQLite (better-sqlite3 + Drizzle);
          proxy de imagens com cache; scripts (assets:sync, bot)
client/   Vite + PixiJS (cena isométrica) e HTML/CSS (entrada, editor, chat, catálogo)
data/     banco e cache de imagens (fora do git)
```

## Assets: HabboAssets e arte própria

Os gráficos vêm do imager público da [HabboAssets](https://www.habboassets.com/api) (Habbo Brasil, `X-Hotel-ID: 2`). O navegador pede as imagens ao próprio servidor (`/hh/...`), que baixa cada uma uma única vez e guarda em `data/asset-cache`. Se o servidor não conseguir, o navegador tenta o imager direto e, por último, desenha uma arte provisória por código.

**Catálogos.** Os manifestos `client/public/assets/avatar/manifest.json` (roupas) e `client/public/assets/furni/manifest.json` (móveis) são gerados e versionados no git:

```bash
npm run assets:sync -- --thumbs
```

- Roupas: a curadoria (categorias e bibliotecas `hh_human_*`) fica em `server/src/assets/avatarManifest.ts`. `--thumbs` pré-baixa as miniaturas do editor.
- Móveis: liste o classname, o nome e a categoria em português em `server/src/assets/furniCatalog.ts`. O script baixa os renders e mede a âncora (onde o móvel encosta no piso) e o tamanho a partir das imagens. Se souber o tamanho, informe `width`/`depth`, que têm prioridade.
- Com `HABBOASSETS_API_KEY`, o script também tenta ler nome e tamanho da furnidata (esse caminho ainda não foi testado com um token real).

**Arte própria ou CC0.** Para um móvel que não vem da HabboAssets:

1. Salve as imagens em `client/public/assets/local/furni/{id}_{direção}.png` (uma por direção: 0, 2, 4 e/ou 6).
2. Adicione em `server/src/assets/furniCatalog.ts` uma entrada com `source: 'local'`, `width`, `depth`, `directions` e `anchors` (o pixel de cada imagem que fica sobre o canto da frente do piso).
3. Rode `npm run assets:sync` e registre autor, licença e URL no [ASSETS.md](ASSETS.md).

## Deploy

O app é **um único processo Node** (cliente compilado + API + WebSocket) com SQLite em arquivo. Rode **uma instância só**: as salas vivem na memória do processo. O que precisa persistir fica em `/app/data` (banco e cache de imagens), então use um volume.

### Docker

```bash
docker build -t escritorio-virtual .
```

```bash
docker run -d --name escritorio -p 2567:2567 -e INVITE_CODE=troque-isto -v escritorio-dados:/app/data escritorio-virtual
```

A imagem roda como usuário `node`, tem healthcheck em `GET /healthz` e encerra com elegância no `SIGTERM`.

### VPS (Oracle Cloud grátis, DigitalOcean, Hetzner…)

O `docker-compose.yml` sobe o app e o **Caddy**, que pega o certificado HTTPS sozinho para o `DOMAIN` do `.env` (sem domínio próprio, use `escritorio.<ip-com-hifens>.sslip.io`). Só as portas 80 e 443 ficam abertas.

Passo a passo completo para a **Oracle Cloud Always Free** (criar a VM, liberar portas, `.env`, primeiro deploy, backup e problemas comuns): **[docs/DEPLOY-ORACLE.md](docs/DEPLOY-ORACLE.md)**. Em resumo, com o `.env` criado na VM:

```bash
scripts/deploy.sh ubuntu@IP-DA-VM ~/caminho/da-chave.key --setup
```

O `--setup` (só na primeira vez) instala o Docker, libera as portas no firewall interno da VM e cria swap se precisar. Depois, para atualizar, rode o mesmo comando sem `--setup`: o código vai por rsync e os dados da VM (`~/escritorio/data`) nunca são apagados.

Backup: copie `~/escritorio/data` com o app parado (veja o guia).

### Fly.io

O `fly.toml` do projeto já tem volume, healthcheck e a máquina sempre ligada:

```bash
fly apps create escritorio-virtual-SEU-NOME
```

```bash
fly volumes create escritorio_dados --size 1 --region gru
```

```bash
fly secrets set INVITE_CODE=troque-isto
```

```bash
fly deploy
```

Troque `app` no `fly.toml` pelo nome criado. Mantenha uma máquina só.

### Segurança

- Entrada por código de convite (limite de 10 tentativas por minuto por IP); o token de sessão fica no navegador e o banco guarda só o hash.
- Em produção: CSP restrita (sem `eval`), `X-Frame-Options: DENY`, `nosniff`; mensagens WebSocket de no máximo 4 KB; limites por ação (andar, chat, decorar, trocar visual).
- Texto do chat sempre exibido como texto puro; visuais e colocações de móveis validados no servidor.
- Os gráficos são da Sulake/Habbo (via HabboAssets, não afiliada): uso pessoal e privado. Não publique o site de forma aberta.
