Escritório virtual isométrico

Contexto
Quero construir um escritório virtual web para usar com meus amigos e colegas (até 10 pessoas online ao mesmo tempo). É um projeto pessoal, sem fins comerciais. A ideia junta duas referências:
- Mecânica do Gather: cada pessoa tem um avatar que anda por um espaço compartilhado, vê os outros em tempo real e conversa com eles.
- Estética do Habbo: visão isométrica, salas com piso em losangos, avatares e móveis em estilo retrô/pixel art, balões de chat sobre a cabeça.

Fonte de Assets & Identidade
- Os assets visuais e dados de catálogo (mobis, roupas/partes de avatar, ícones e sons) serão consumidos e integrados a partir da HabboAssets API v2 (https://www.habboassets.com/api/v2).
- Para o contexto do hotel Brasil, utilize o cabeçalho `X-Hotel-ID: 2` nas requisições da API conforme necessário.
- Caso algum asset específico não esteja disponível via API ou para testes offline/locais, o sistema deve suportar arte provisória gerada por código ou pacotes adicionais CC0, registrando a origem no arquivo `ASSETS.md`.

Funcionalidades (escopo da v1)
1. Entrar no escritório
  - Tela inicial: digitar um nome e um código de convite (definido em variável de ambiente). Sem cadastro com senha por enquanto.
  - Montar o visual do avatar no editor (ver item 6) antes de entrar.
  - Lembrar o nome e o avatar no navegador; o avatar também fica salvo no servidor.
2. Salas isométricas
  - Grade isométrica de tiles com paredes em dois lados, no estilo de quarto.
  - Pelo menos 3 salas iniciais: Recepção, Sala de reunião e Copa.
  - Portas que levam de uma sala para outra.
  - Lista de pessoas presentes em cada sala.
3. Movimento
  - Clicar em um tile para andar até ele, com pathfinding (A*) desviando de móveis e paredes.
  - Animação de caminhada nas direções isométricas.
  - Movimento sincronizado em tempo real para todos na sala, com interpolação suave.
  - O servidor é a autoridade: valida o caminho e as posições.
4. Chat de texto
  - Campo de mensagem na parte de baixo da tela.
  - A mensagem aparece como balão sobre o avatar, que some após alguns segundos.
  - Histórico de chat da sala em um painel lateral recolhível.
  - Mensagens visíveis só para quem está na mesma sala.
5. Decorar salas
  - Catálogo de móveis alimentado via HabboAssets API v2 (ou fallback local): mesas, cadeiras, sofá, planta, estante, quadro branco, máquina de café, tapete etc.
  - Colocar, mover, girar e remover móveis com o mouse, encaixando na grade.
  - Móveis ocupam tiles e bloqueiam a passagem (exceto tapetes).
  - Sentar em cadeiras e sofás ao clicar neles.
  - Modo "editar sala" separado do modo normal, para não mover nada sem querer.
  - Layout das salas salvo no servidor e carregado para todos.
6. Avatar personalizável em camadas
  - O avatar é montado em camadas sobrepostas (corpo, calça, blusa, cabelo, acessórios, etc.), integrando partes e renders da HabboAssets API v2 e/ou sprites em camadas locais.
  - Suporte a tons de pele, estilos de cabelo e opções de vestuário recoloríveis.
  - Editor de avatar: prévia com rotação, abas por categoria e seletores de cores. Acessível na entrada e a qualquer momento no escritório.
  - Estrutura extensível: manifesto em `client/public/assets/avatar/manifest.json` mapeando peças, URLs da API e camadas.
7. Suporte a Imager & Caching
  - Utilizar os endpoints e imagers públicos da HabboAssets para renderização ágil de mobis e avatares diretamente por URL, armazenando em cache no client/servidor para otimizar requisições.

Fora do escopo da v1 (deixar o código preparado, mas não implementar)
- Vídeo e áudio por proximidade (WebRTC).
- Login com conta Google/Microsoft.
- Editor para criar salas novas do zero.
- App mobile.

Stack sugerida
- Linguagem: TypeScript no front e no back, em um monorepo simples (`/client`, `/server`, `/shared` para tipos e constantes comuns).
- Front: Vite + PixiJS (ou Phaser 3) para renderizar a cena isométrica; HTML/CSS comum para a interface (chat, catálogo, editor de avatar, lista de pessoas).
- Tempo real: Colyseus (salas com estado sincronizado) ou Socket.IO.
- Persistência: SQLite (via better-sqlite3 ou Prisma) para usuários, avatares, salas e móveis.
- Deploy: um único processo Node servindo o front compilado e o WebSocket, com Dockerfile, pronto para Render, Fly.io ou um VPS.

Requisitos técnicos
- Ordenação de profundidade correta (avatares passam na frente e atrás dos móveis certos).
- Conversão entre coordenadas de grade e de tela isométrica centralizada em um módulo testado.
- Composição das camadas do avatar em cache (montar a textura uma vez por combinação, não a cada frame).
- Tratar e gerenciar adequadamente requisições para a HabboAssets API v2 (CORS, tokens quando necessários, fallbacks).
- Rate limit simples no chat e nas ações de movimento.
- Escapar o texto do chat (sem HTML injetado).
- Validar no servidor os dados do avatar (ids e cores válidos).
- Reconexão automática se a conexão cair.
- Funcionar nos navegadores de desktop atuais; em telas pequenas, pelo menos ser utilizável.
- Testes unitários para pathfinding, conversão de coordenadas, validação de colocação de móveis e integração/parsers de manifesto de assets.
- README.md explicando como rodar localmente (`npm install`, `npm run dev`), como consumir a HabboAssets API ou adicionar assets locais, e como fazer deploy.

Fases
- Fase 1: sala isométrica única renderizada, um avatar andando com clique e pathfinding (sem rede), estrutura inicial de assets com HabboAssets API.
- Fase 2: servidor em tempo real, vários usuários na mesma sala vendo uns aos outros, tela de entrada com código de convite.
- Fase 3: editor de avatar completo integrado à API / manifestos, com camadas, recoloração e persistência do avatar.
- Fase 4: chat com balões e histórico.
- Fase 5: várias salas e portas.
- Fase 6: modo de decoração, catálogo alimentado pela HabboAssets API, sentar, persistência das salas.
- Fase 7: acabamento visual, Docker, README e deploy.

Como trabalhar
1. Trabalhe uma fase por vez. Ao fim de cada uma, me diga como testar e espere meu ok antes de seguir.
2. Faça commits pequenos e descritivos.
3. Se alguma decisão afetar muito o projeto (trocar biblioteca, mudar o modelo de dados), pergunte antes.
4. Mantenha o PLAN.md atualizado se o plano mudar.
