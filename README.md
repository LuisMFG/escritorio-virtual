# Escritório Virtual

Escritório virtual isométrico para amigos e colegas (até ~10 pessoas online): avatares no estilo Habbo andando por salas, conversando por balões de chat, sentando nas cadeiras e decorando o espaço juntos. Projeto pessoal, sem fins comerciais.

- **Requisitos:** [SPEC.md](SPEC.md) · **Plano e decisões:** [PLAN.md](PLAN.md) · **Origem dos assets:** [ASSETS.md](ASSETS.md)

## O que dá para fazer

- Criar conta com o código de convite (usuário, senha, nome e visual) e entrar com usuário e senha de qualquer aparelho; o navegador lembra da sessão até você clicar em **Sair**.
- **Cargos** (Diretor, Coordenadores, Desenvolvedor, DBA…) aparecem sob o nome do avatar, na lista de pessoas e no cartão. Só administradores definem o cargo de alguém, pela aba **Equipe**.
- **Perfil**: nome exibido, bio, aniversário (🎂 no avatar e aviso no dia), troca de senha e "sair de todos os aparelhos".
- **Equipe**: todo mundo agrupado por cargo, com quem está online (e em que sala) e "visto por último" de quem não está.
- **Móveis interativos**: clique numa luminária, TV, computador, ventilador ou cofre para ligar/desligar (o avatar vai até lá); a máquina de café serve um ☕; o **Mural de Recados** guarda post-its coloridos para o pessoal.
- **Quadro branco**: clique no cavalete da Sala de reunião para desenhar junto com quem estiver na sala (pincel, borracha, texto, cores, desfazer). O desenho fica salvo e aparece em miniatura no próprio móvel.
- **Agenda de reuniões**: botão 📅 Agenda para marcar reunião (sala, horário, duração e convidados), responder Vou/Não vou e cancelar. Lembrete 5 min antes (aviso, notificação e DM) com "Ir para a sala"; durante a reunião a porta da sala mostra "🔴 Em reunião".
- **Mini-jogos**: jogo da velha na Mesa de Jogos da Copa (duas pessoas sentam e jogam, o resto da sala assiste, com placar) e `/dado` e `/moeda` no chat, sorteados pelo servidor.
- **Pets**: adote um bichinho no Perfil: **33 pets do Habbo** (cachorro, gato, urso, leão, dragão, macaco, sapo…, com padrão de pelagem e cor) ou os 4 desenhados (cachorro, gato, coelho e pintinho). Ele segue você entre as salas, passeia quando você para e obedece `/senta`, `/deita` e `/vem` no chat.
- **Conquistas**: 17 conquistas (conversar, decorar, explorar as salas, jogar, ir às reuniões…) com aviso ao desbloquear. Cada conquista tem um **emblema do Habbo**; no Perfil você escolhe até 3 para aparecer no seu cartão.
- **Status do editor de código**: com a extensão do VS Code ou do Visual Studio, seu cartão mostra “💻 Codando em C# no Visual Studio” enquanto você programa. No Perfil você escolhe o que aparece (nada, só “Codando”, a linguagem ou também o projeto). Veja [Extensões dos editores](#extensões-dos-editores).
- **Spotify**: conecte sua conta no Perfil e a música que você está ouvindo aparece no seu cartão (“🎵 Música – Artista”, com link). Dá para esconder sem desconectar. Precisa de um app do Spotify configurado; veja [Spotify](#spotify).
- **Avisos da diretoria**: botão 📢 Avisos. Admins publicam comunicados (normais ou urgentes); aparecem como faixa no topo para todo mundo, inclusive para quem entrar depois, até a pessoa clicar em **Li**. Histórico com “lido por N” para os admins.
- **Enquetes no chat**: `/enquete Pergunta? | opção 1 | opção 2` ou 😊 → 📊 Enquete (até 6 opções, com nomes ou anônima). Votos ao vivo com barras, dá para trocar o voto, e quem criou encerra.
- **Elogios**: botão 🙌 Elogiar no cartão do avatar e na Equipe (🙌 Ajudou muito, 💡 Boa ideia, 🚀 Entregou, 🤝 Parceria). A pessoa é avisada na hora, e o elogio vai para o **Quadro de Elogios** da Recepção. Elogiar e ser elogiado destrava conquistas.
- **Modo foco (Pomodoro)**: botão 🍅 Foco (25+5, 50+10, 90+15 ou o tempo que quiser). Os outros veem 🍅 com os minutos no seu avatar, no cartão e na lista de pessoas. Menções, mensagens e elogios ficam sem som e chegam num resumo no fim. A contagem aparece no botão e no título da aba.
- **Mapa do escritório**: botão 🗺️ Mapa com todas as salas ligadas pelas portas, quem está em cada uma e as reuniões em andamento. Clicar numa sala leva até ela; clicar numa pessoa leva até a sala dela e anda até perto.
- **Jira**: cada pessoa conecta a conta do Jira Cloud no Perfil (e-mail + token de API) e o cartão mostra a demanda em andamento (“📋 PROJ-123 · título”, com link; dá para mostrar só o código ou esconder). O **Quadro de Demandas** (na Sala de reunião, ou onde um admin colocar pelo Decorar) junta as demandas de quem conectou em A fazer / Em andamento / Concluídas, com filtro por pessoa. Veja [Jira](#jira).
- **Anexos e busca**: 📎 no chat da sala e nas Mensagens (ou cole um print / arraste o arquivo), até 10 MB: imagens, PDF, Office, texto/CSV e zip. Imagens aparecem em miniatura (clique amplia); links viram clicáveis com prévia do site. 🔎 busca no chat das salas e nas suas conversas.
- **Dia e noite** (opcional, desligado por padrão; liga em Configurações) pelo horário de Brasília, em tons leves, com as luzes acesas brilhando à noite (`?hora=21` força a hora para testar), e **som ambiente** opcional por sala (em Configurações: escritório, cafeteria ou chuva, gerado no próprio navegador).
- **Reações e respostas**: passe o mouse numa mensagem (sala ou privada) para reagir (👍 ❤️ 😂 😮 😢 🎉) ou responder citando; quem é respondido recebe aviso.
- **Mensagens privadas**: botão **Mensagens** (ou "Mensagem" no cartão/Equipe) para conversar com qualquer pessoa, em qualquer sala ou offline (ela lê quando voltar). Contador de não lidas, "Visto" e notificações do navegador opcionais (🔔 no painel) para DMs e menções com a aba em segundo plano.
- **Admin** (só administradores): promover/rebaixar, cargos (criar, renomear, cor, ordem), senha temporária, desativar conta, tirar alguém da sala ou do escritório, trocar o código de convite, travar a decoração por sala e ver o registro de ações. Mensagens do chat podem ser apagadas por quem escreveu ou por um admin (🗑 no histórico).
- Montar o visual do avatar ao criar a conta ou em **Perfil → Meu visual**: **todas as roupas do Habbo Brasil** (3.296 peças em 15 categorias, inclusive NFT, estampas, itens diversos e pets de ombro), com busca em português ("terno", "boné", "asas"), filtro de peças grátis ou do clube, roupas animadas (✨), **provador** (passe o mouse numa peça para ver em você), **desfazer** (Ctrl+Z) e **5 looks salvos** (clique num espaço vazio para guardar o visual atual).
- **Tela limpa**: a sala abre enquadrada inteira no espaço livre; a conversa fica num painel à esquerda (balões, contador de novas, recolhível); a barra de baixo agrupa Eu · Pessoas · Conversas · Escritório (e **Mais** para admins); a coluna da direita tem som, tema e câmera (aproximar, afastar, enquadrar a sala e centralizar em mim). Roda do mouse ou pinça para zoom.
- **Minha mesa**: sente numa estação da Recepção e clique em **Ficar com esta mesa**; seu nome aparece numa plaquinha na mesa e o botão **Minha mesa** leva você de volta (e senta) de qualquer sala. Ao entrar no escritório, um convite leva direto para ela.
- **Presença**: selo sobre a cabeça para ocupado, ausente e em reunião; segure **Alt** para ver o nome de todos sem encavalar; clique em alguém na lista de pessoas para a câmera ir até a pessoa.
- **Primeiro acesso e ajuda**: quem cria a conta ganha um tour guiado (andar, escolher a mesa, conversar, emotes e Decorar); aperte **?** (ou Mais → Ajuda) para ver comandos, atalhos e o que cada botão faz, e refazer o tour.
- **Desfazer**: remover um móvel, apagar uma mensagem ou soltar o pet mostra um aviso com **Desfazer** por alguns segundos. Se a conexão cair, uma faixa no alto avisa e o escritório volta sozinho.
- **Acessibilidade**: dá para usar tudo pelo teclado (as janelas recebem o foco, Tab não escapa delas e Esc fecha), os botões têm nome para leitores de tela e um teste automático (axe) confere contraste e estrutura das telas principais.
- **Celular**: barra com 5 botões e **Mais**, janelas que abrem como gaveta de baixo (arraste para baixo para fechar), campo do chat que sobe com o teclado, pinça para zoom e segurar sobre alguém para abrir o cartão.
- **Configurações** (engrenagem na coluna da direita): tema escuro, claro ou do sistema, tamanho do texto, reduzir movimento, som de mensagem, som ambiente e notificações; tudo fica salvo no navegador. O **Perfil** é dividido em abas (Perfil, Pet, Conquistas, Efeitos, Integrações e Conta).
- Andar clicando no piso, com desvio de móveis e outras pessoas, sincronizado em tempo real.
- Conversar: **Enter** abre o campo de mensagem; a fala aparece em balão sobre o avatar e fica no histórico **Conversa**. Há um som de mensagem opcional (sino na coluna da direita).
- Emotes: botão 😊 ao lado do chat ou comandos `/acenar`, `/rir`, `/joinha`, `/coracao`, `/cafe`, `/dancar`, `/mao`, `/sorrir`, `/triste`, `/bravo`, `/surpreso`.
- **Café e bebidas na mão**: a máquina de café entrega uma xícara e a geladeira uma bebida; o avatar segura e dá uns goles, por 5 minutos ou até `/largar` (também no menu 😊).
- **Efeitos do Habbo**: no **Perfil → ✨ Efeitos**, escolha um efeito para usar (brilho, corações, vaga-lumes, borboletas, auréola, holofote, raio…), liberados por conquistas e elogios recebidos. Em comemorações aparece um efeito por alguns segundos: holofote na conquista, joinha girando no elogio, medalha no fim do Pomodoro e corações no aniversário.
- **Avatares animados** como no Habbo: andam com os passos de verdade, sentam com as pernas dobradas, mexem a boca ao falar, piscam, acenam, levantam a mão, mandam beijo, bebem o café e mudam a expressão do rosto. Quem está **Ausente** fecha os olhos e solta um "zZ".
- Status **Disponível**, **Ocupado** ou **Ausente** no painel de pessoas; fica **Ausente** sozinho após 5 minutos parado.
- Passe o mouse num avatar para ver o nome; clique para abrir o cartão (status, sala, **Ir até**, **Mencionar**).
- Menções: digite `@` para escolher alguém da sala; quem é mencionado recebe destaque, aviso e som. Um "•••" mostra quem está digitando.
- **Recepção = o escritório de verdade:** a primeira sala reproduz a planta do escritório (uma fileira de 4 mesas, uma bancada de 10 mesas costas com costas com divisória de vidro e uma segunda bancada completando o open space), cada mesa com computador e cadeira giratória para sentar e trabalhar, e uma área de convivência com café, geladeira, mural de recados, Quadro de Demandas (Jira), Quadro de Elogios, quadro branco, lounge com sofás e duas mesas de jogo da velha. Bancos já existentes recebem esse layout sozinhos ao atualizar.
- Salas ligadas por portas: começa com **Recepção**, **Sala de reunião** e **Copa**; dá para abrir direto numa sala pela URL (`#/meeting`). Admins (e quem eles liberarem) criam e editam salas em **Mais → Editar sala**: nome, cores, formato do piso (inclusive em L), entrada e portas — a porta de volta aparece sozinha na outra sala.
- Sentar e deitar: clique numa cadeira, sofá, banqueta, pufe ou almofada para sentar (sofá de dois lugares cabe duas pessoas) e numa cama ou saco de dormir para deitar (cama de casal, dois). No chão: `/sentar`, `/deitar` e `/levantar` (ou pelo menu 😊). As setas ← → viram o avatar sem sair do lugar; sentado no chão, clicar num tile do lado também vira.
- Decorar: botão **Decorar** → escolha um móvel e clique no piso. Além dos móveis do escritório, o **catálogo completo do Habbo** (mais de 8.600 móveis) com busca e categorias: quadros, janelas e prateleiras vão **na parede** (aponte a parede e clique), móveis com **cores** trocam de cor no lugar e os que ligam/desligam funcionam com um clique. Clique num móvel para selecionar, arraste para mover, **R** gira, **Delete** remove, **Esc** cancela. Tudo fica salvo. Admins escolhem quais categorias aparecem (jogos e festa começam escondidos). Móveis animados do Habbo animam de verdade (lareira, TV, luminárias); o **dado** rola e mostra o resultado no chat, **teleportes** ligados no Decorar levam de um ao outro (até em outra sala) e a **jukebox** toca música para a sala. O painel tem **Recentes**, **Favoritos** (estrela), prévia grande, grade de tiles ao arrastar e **Desfazer/Refazer** (Ctrl+Z / Ctrl+Shift+Z).

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

Isso sobe o servidor (http://localhost:2567) e o cliente (http://localhost:5173). Abra o cliente e, na aba **Criar conta**, use o código de convite: o `INVITE_CODE` do `.env`, ou `convite` se não houver `.env`. Sem `ADMIN_USERNAMES`, a primeira conta vira administradora.

Para testar com várias pessoas sozinho, abra uma janela **anônima** (cada navegador guarda o próprio acesso) ou rode robôs que passeiam, conversam, fazem emotes, mencionam quem está na Recepção e respondem mensagens privadas:

```bash
npm run bot -- Bia 3
```

Opções de URL do cliente: `?offline=1` usa só a arte provisória gerada por código (sem chamar a HabboAssets); `?debug=1` desenha os footprints da ordenação de profundidade.

### Variáveis de ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `INVITE_CODE` | `convite` em dev; **obrigatória** em produção | Código pedido para criar conta (valor inicial: depois um admin pode trocar pelo painel) |
| `ADMIN_USERNAMES` | vazio | Usuários (login) sempre administradores, separados por vírgula. Vazio: a primeira conta criada vira admin |
| `HABBOASSETS_API_KEY` | vazio | Token gratuito da HabboAssets (só no servidor), usado pelo `assets:furni` para gerar o catálogo completo de móveis |
| `PORT` | `2567` | Porta HTTP/WebSocket |
| `DATABASE_PATH` | `./data/sqlite.db` | Arquivo SQLite |
| `ASSET_CACHE_DIR` | `./data/asset-cache` | Cache em disco das imagens da HabboAssets |
| `UPLOAD_DIR` | `./data/uploads` | Anexos do chat e das mensagens privadas |
| `JIRA_SITE` | vazio | Endereço do Jira Cloud fixo pelo servidor. Vazio: o admin define em **Admin → Convite e salas** |
| `SECRET_KEY` | vazio | Chave (32 bytes em base64, `openssl rand -base64 32`) que cifra os tokens do Jira. Vazio: gerada em `SECRET_KEY_FILE` |
| `SECRET_KEY_FILE` | `./data/secret.key` | Onde fica a chave gerada quando `SECRET_KEY` não é definida |

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor (tsx watch) + cliente (Vite) juntos |
| `npm run dev:server` / `npm run dev:client` | Só um dos dois |
| `npm test` | Testes unitários e de integração (Vitest) |
| `npm run e2e` | Testes de ponta a ponta no navegador (Playwright); veja abaixo |
| `npm run typecheck` | Checagem de tipos de todos os pacotes |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build` | Build de produção do cliente (`client/dist`) |
| `npm start` | Servidor em modo produção (serve o `client/dist`) |
| `npm run bot` | Robôs de teste (`npm run bot -- Bia 15`: até 20 robôs andando e falando na Recepção; serve para testar o desempenho) |
| `npm run assets:sync` | Regera o manifesto dos móveis curados do escritório a partir da HabboAssets |
| `npm run assets:furni` | Regera o catálogo completo de móveis (`client/public/assets/furni/catalog.json`) pela API da HabboAssets; precisa de `HABBOASSETS_API_KEY`. Cada móvel é medido no imager só quando alguém usa pela primeira vez |
| `npm run assets:pets` | Regera o catálogo dos pets do Habbo (`client/public/assets/pets/pets.json`): tipos, paletas e posturas, lendo os SWFs da HabboAssets |
| `npm run assets:figure` | Regera o catálogo completo de roupas (`client/public/assets/avatar/manifest.json`) e os dados para montar o avatar (`client/public/assets/figure/figuredata.json`), com itens na mão e efeitos. Lê ~2.300 bibliotecas da HabboAssets (com cache em disco: a primeira vez leva uns 10 minutos, depois segundos) |
| `npm run assets:figure-check` | Confere o avatar montado contra o imager (várias figuras, 8 direções) e grava as piores comparações em `data/figure-check/` |
| `npm run db:generate` | Gera migration SQL após mudar `server/src/db/schema.ts` |
| `npm run vscode:package` | Gera a extensão do VS Code em `client/public/downloads/escritorio-atividade.vsix` |

### Testes de ponta a ponta

`npm run e2e` compila o cliente, sobe o servidor em modo produção na porta 2600 (banco e backups temporários, sem mexer no `npm run dev`) e roda no Chromium os fluxos principais com pessoas de verdade clicando: criar conta e entrar, andar, conversar e trocar de sala, decorar, marcar reunião e jogar o jogo da velha.

- Primeira vez: `npx playwright install chromium`.
- Rodar só um: `npm run e2e -- jogo`. Testes de hoje: conta, sala, decorar, agenda, jogo da velha, avisos, enquetes, elogios, modo foco e mapa. Ver o navegador: `npm run e2e -- --headed`.
- Quando falha: `npx playwright show-trace e2e-results/<teste>/trace.zip` mostra passo a passo (tela, cliques, rede). O relatório fica em `e2e-report/`.
- A cena é um canvas; com `?e2e=1` no endereço, a página expõe `window.__e2e` (onde fica cada tile e móvel na tela e o estado da sala) para os testes clicarem com o mouse no lugar certo. Sem o parâmetro, nada muda.

## Estrutura

```
shared/   código comum: coordenadas isométricas, A*, ordenação de profundidade, regras de
          colocação de móveis, validação de visual, protocolo de rede e estado sincronizado
server/   Express + Colyseus no mesmo processo; SQLite (better-sqlite3 + Drizzle);
          proxy de imagens com cache; scripts (assets:sync, bot)
client/   Vite + PixiJS (cena isométrica) e HTML/CSS (entrada, editor, chat, catálogo)
vscode-extension/        extensão do VS Code (TypeScript, empacotada em .vsix)
visualstudio-extension/  extensão do Visual Studio 2022/2026 (C#, VisualStudio.Extensibility)
data/     banco e cache de imagens (fora do git)
```

## Extensões dos editores

As duas extensões mandam ao escritório, a cada minuto enquanto você mexe no código, a linguagem e o nome do projeto (ou da solução). Depois de 5 minutos parado, ou ao pausar/fechar, a atividade some. O token é pessoal (gerado em **Perfil → 💻 Editores de código**), só serve para mandar atividade e pode ser revogado a qualquer momento.

**VS Code**
1. Baixe a extensão pelo link no Perfil (ou `client/public/downloads/escritorio-atividade.vsix`).
2. No VS Code: Extensões → menu “…” → **Instalar do VSIX…** (ou `code --install-extension escritorio-atividade.vsix`).
3. No Perfil, gere o token e clique em **Conectar no VS Code**: o VS Code abre, pede para confirmar o link e conecta sozinho. Se o navegador não abrir o VS Code, clique em **Escritório** na barra de status (ou paleta → **Escritório: conectar**), confirme o endereço e cole o token. O token fica no armazenamento seguro do VS Code.
4. O item “Escritório” na barra de status mostra se está conectado; clique para pausar/retomar.

**Visual Studio 2022 (17.14+) / 2026**
1. Gere o `.vsix` **no Windows** (o empacotador da Microsoft só roda lá): abra `visualstudio-extension/EscritorioAtividade/EscritorioAtividade.csproj` no Visual Studio, ou rode `dotnet build -c Release` nessa pasta. O arquivo sai em `bin/Release/net8.0-windows8.0/`.
2. Dê dois cliques no `.vsix` para instalar e reabra o Visual Studio.
3. Menu **Extensões → Escritório: conectar** → endereço e token. O token fica criptografado para o seu usuário do Windows (DPAPI), em `%APPDATA%\EscritorioVirtual\atividade.json`.
4. **Extensões → Escritório: pausar ou retomar** e **Escritório: desconectar** fazem o resto.

Fora do Windows, `dotnet build` só compila (confere o código) e não gera o `.vsix`.

## Spotify

1. Em <https://developer.spotify.com/dashboard>, crie um app (tipo *Web API*).
2. Em **Redirect URIs**, cadastre o endereço de retorno:
   - desenvolvimento: `http://127.0.0.1:2567/api/spotify/callback` (o Spotify não aceita `localhost`);
   - produção: `https://SEU-DOMINIO/api/spotify/callback` (precisa de https).
3. No `.env`: `SPOTIFY_CLIENT_ID` (o Client ID do app; o segredo não é usado), e se precisar `SPOTIFY_REDIRECT_URI` e `SPOTIFY_RETURN_URL` (em dev, `http://localhost:5173/`).
4. Enquanto o app estiver em *Development mode*, o Spotify só deixa conectar quem você adicionar em **User Management** (até 25 pessoas, pelo e-mail da conta Spotify).
5. Reinicie o servidor. No Perfil, cada pessoa clica em **Conectar Spotify**.

O servidor consulta a música de quem está online a cada 20 segundos e guarda só o necessário para isso (o refresh token, com o escopo `user-read-currently-playing`).

## Jira

1. Um admin abre **Admin → Convite e salas → Jira Cloud** e informa o endereço (`suaempresa.atlassian.net`). Ou defina `JIRA_SITE` no `.env`.
2. Cada pessoa cria um token de API em <https://id.atlassian.com/manage-profile/security/api-tokens> e, no **Perfil → Jira**, informa o e-mail da conta Atlassian e o token. O servidor confere no Jira antes de guardar.
3. Pronto: em até 1 minuto a demanda **em andamento** (categoria de status “Em andamento” do Jira) aparece no cartão, e o **Quadro de Demandas** mostra as demandas abertas e as concluídas nos últimos 7 dias de quem conectou.

Como funciona: o servidor consulta o Jira a cada minuto, uma pessoa por vez, com o token de cada um (cada pessoa só aparece com o que ela mesma pode ver no Jira). O token fica cifrado no banco (AES-256-GCM) com a chave de `SECRET_KEY` ou `data/secret.key`; sem a chave, os tokens não abrem, e as pessoas só precisam conectar de novo. Se o Jira recusar um token (vencido ou revogado), a pessoa vê o aviso no Perfil e deixa de ser consultada até conectar de novo.

## Assets: HabboAssets e arte própria

Os gráficos vêm do imager público da [HabboAssets](https://www.habboassets.com/api) (Habbo Brasil, `X-Hotel-ID: 2`). O navegador pede as imagens ao próprio servidor (`/hh/...`), que baixa cada uma uma única vez e guarda em `data/asset-cache`. Se o servidor não conseguir, o navegador tenta o imager direto e, por último, desenha uma arte provisória por código.

**Catálogos.** Os manifestos `client/public/assets/avatar/manifest.json` (roupas) e `client/public/assets/furni/manifest.json` (móveis) são gerados e versionados no git:

```bash
npm run assets:sync -- --thumbs
```

- Roupas: a curadoria (categorias e bibliotecas `hh_human_*`) fica em `server/src/assets/avatarManifest.ts`. `--thumbs` pré-baixa as miniaturas do editor.
- Móveis: liste o classname, o nome e a categoria em português em `server/src/assets/furniCatalog.ts`. O script baixa os renders e mede a âncora (onde o móvel encosta no piso) e o tamanho a partir das imagens. Se souber o tamanho, informe `width`/`depth`, que têm prioridade.
- Catálogo completo: `npm run assets:furni` (com `HABBOASSETS_API_KEY`) gera `client/public/assets/furni/catalog.json`. As definições medidas na primeira vez que alguém usa um móvel ficam no banco (`furni_defs`).

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

O `docker-compose.yml` sobe o app e, conforme `COMPOSE_PROFILES` no `.env`, o jeito de chegar pela internet: `caddy` (VPS com IP público: HTTPS automático para o `DOMAIN`; sem domínio próprio, use `escritorio.<ip-com-hifens>.sslip.io`), `tunel-rapido` (Cloudflare Tunnel grátis e sem conta, para um PC de casa; `./scripts/tunel-url.sh` mostra o endereço) ou `tunel` (Cloudflare Tunnel fixo, com `TUNNEL_TOKEN`). Servidor num PC Windows com WSL2 e Docker: veja [docs/SERVIDOR-WINDOWS.md](docs/SERVIDOR-WINDOWS.md).

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

### Backups

O servidor faz uma cópia do banco **todo dia às 3h** (horário de Brasília) em `data/backups/` e guarda as últimas 7 (`BACKUP_DIR` e `BACKUP_KEEP` no `.env`). Se o servidor estava desligado às 3h, a cópia sai assim que ele voltar. A cópia usa a API de backup do SQLite, então é segura com o escritório funcionando. Em **Admin → Backups** dá para ver a lista, fazer um backup na hora e baixar (fica no Registro).

**Restaurar:**
1. Pare o servidor (`docker compose stop app`, ou Ctrl+C em desenvolvimento).
2. Guarde o banco atual por precaução: `mv data/sqlite.db data/sqlite.db.antes`, e apague `data/sqlite.db-wal` e `data/sqlite.db-shm` se existirem.
3. Copie o backup: `cp data/backups/escritorio-AAAA-MM-DD-HHMM.db data/sqlite.db`.
4. Suba de novo (`docker compose start app`). As migrations novas, se houver, são aplicadas sozinhas.

**Chave dos tokens:** guarde também `data/secret.key` (ou use `SECRET_KEY`). Sem ela, o banco restaurado funciona, mas cada pessoa precisa conectar o Jira de novo.

**Anexos:** o backup diário copia só o banco. Os arquivos anexados ficam em `data/uploads/`; para ter tudo, copie essa pasta junto (o `rsync` abaixo com `data/` inteiro em vez de `data/backups/` resolve).

**Levar os backups para fora da VM** (se a máquina sumir, os backups vão junto). Do seu computador, por exemplo uma vez por semana:

```bash
rsync -avz usuario@IP-DA-VM:~/escritorio-virtual/data/backups/ ./backups-escritorio/
```

### Segurança

- Contas criadas só com o código de convite; senhas com `scrypt` (sal por senha); limite de 10 tentativas de entrada/cadastro por minuto por IP. Cada aparelho tem seu token de sessão, e o banco guarda só o hash. Trocar a senha desconecta os outros aparelhos.
- Em produção: CSP restrita (sem `eval`), `X-Frame-Options: DENY`, `nosniff`; mensagens WebSocket de no máximo 4 KB; limites por ação (andar, chat, decorar, trocar visual).
- Anexos: só tipos da lista, com o conteúdo conferido; baixar exige login (e, numa DM, ser uma das duas pessoas); arquivos que não são imagem sempre baixam, nunca abrem como página. A prévia de link nunca acessa endereços internos (rede da VM, metadados da nuvem).
- Texto do chat sempre exibido como texto puro; visuais e colocações de móveis validados no servidor.
- Os gráficos são da Sulake/Habbo (via HabboAssets, não afiliada): uso pessoal e privado. Não publique o site de forma aberta.
