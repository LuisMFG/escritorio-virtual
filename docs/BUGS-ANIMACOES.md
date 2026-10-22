# Bugs de animação, interação e empilhamento (21/10/2026)

Levantamento feito antes da Fase 52, a pedido do usuário. Duas frentes:

- **No navegador**, com a arte de verdade:
  - uma grade com todas as poses do avatar nas 8 direções (em pé, andando, sentado, deitado, acenando, segurando e bebendo);
  - pegar bebida na geladeira;
  - colocar uma Cama de Casal e clicar nela.
- **No código**, três revisões completas:
  - animação do avatar (montagem das poses);
  - interação com móveis (sentar, deitar, usar, itens na mão);
  - Decorar e empilhamento.

Alguns achados das revisões foram confirmados rodando o próprio código de montagem e de movimento com as folhas de roupa já convertidas.

**Gravidade:**

| | Significado |
|---|---|
| **alta** | quebra uma função principal ou acontece sempre |
| **média** | atrapalha com frequência, ou raramente com efeito grave |
| **baixa** | detalhe visual, caso raro ou desempenho |

Cada bug tem um código (AN = animação, IN = interação, DE = Decorar/empilhar), usado no roadmap (seção 19 do `PLAN.md`).

**Situação:**
- A Fase 52 corrigiu AN1–AN8, AN10, AN11, AN13, AN14, IN1–IN11, IN13, IN15 e o IN16 (achado na conferência).
- A Fase 53 corrigiu DE1–DE10, DE13–DE17 e DE20. DE11, DE12 e DE18 ficaram de fora do roadmap.
- A Fase 56 corrigiu IN14 e DE19 (regra de tampo nova: todo móvel sólido com altura serve de base, menos assentos, camas e uma lista de exceções).

---

## Animação do avatar (AN)

### AN1 · Com bebida ou café o avatar fica com um braço só — **alta** (confirmado no navegador) · ✅ corrigido na Fase 52
- **Reproduzir:** pegue uma bebida na geladeira (ou digite `/cafe`) e vire para baixo-esquerda com as setas, ou ande para a esquerda.
  - Nas direções 4, 5 e 6 o braço do lado da câmera some, e sobra uma mão embaixo do copo.
  - Com `/acenar`, `/mao` e `/joinha` nessas direções, ficam dois braços do mesmo lado.
- **Causa:**
  - As direções 4–6 são desenhadas como espelho das 2–0, mas o espelho não troca as peças esquerda↔direita (`lh↔rh`, `ls↔rs`, `lc↔rc`, `li↔ri`), como o Habbo faz.
  - Por isso os dois braços desenhados acabam sendo os de trás.
  - Código: `shared/src/figureRender.ts` (espelho em `composeFigure`; braços em `GESTURE_ARM`). O teste atual fixa o comportamento errado.

### AN2 · Deitado, a cabeceira e o cobertor da cama cobrem o avatar — **alta** · ✅ corrigido na Fase 52
- **Reproduzir:** Decorar → Cama de Casal → clicar na cama (depois de corrigir IN1/IN2). Só um pedaço do rosto aparece.
- **Causa:**
  - Desde o desenho por camadas das camas (20/10), as camadas altas da cama (cabeceira, laterais, cobertor) vão para as "fatias da frente", que sempre ficam na frente de quem deita.
  - O deslocamento do avatar deitado (`LAY_OFFSET`) foi calibrado quando a cama era uma imagem só, atrás do avatar.
  - Medido: 63% da cabeça e 93% do corpo ficam cobertos.
  - Código: `client/src/entities/FurniView.ts` (fatias de `canLay`), `AvatarView.ts`.

### AN3 · Ao chegar andando no assento ou na cama, o avatar fica virado para onde andava — **alta**, intermitente · ✅ corrigido na Fase 52
- **Reproduzir:** clique numa cadeira chegando de lado ou pela diagonal, ou numa cama pela lateral. Acontece até em localhost e mais ainda pelo túnel. O avatar:
  - senta de lado ou de costas;
  - na diagonal, aparece **em pé** dentro da cadeira;
  - na cama, deita atravessado ou fora dela.
  - Fica assim até chegar outra atualização dessa pessoa.
- **Causa:**
  - O servidor manda "sentou + direção" no mesmo pacote do último passo.
  - O cliente descarta a direção se ainda está animando esse passo e nunca a reaplica.
  - Código: `client/src/entities/AvatarView.ts` (`applySnapshot`).

### AN4 · Sentado numa direção diagonal o avatar é desenhado em pé — **média** (confirmado na grade de poses) · ✅ corrigido na Fase 52
- **Reproduzir:**
  - Sentado, use um móvel que fica na diagonal (IN8).
  - Ou chegue na cadeira pela diagonal (AN3).
- **Causa:**
  - A pose "sentado" do Habbo só existe nas direções 0/2/4/6; nas ímpares, a montagem cai na pose em pé.
  - Falta normalizar a direção para uma par sempre que a pessoa está sentada.

### AN5 · Deslocamento de quem deita não usa a mesma direção do desenho — **média** · ✅ corrigido na Fase 52
- **Reproduzir:** deitar com a direção 5 ou 6 chegando ao cliente (via AN3 ou dança): o corpo fica 72 px fora da cama.
- **Causa:** cada lugar normaliza a direção de deitar de um jeito: o servidor (`layDirection`), a montagem (`composeFigure`) e o `LAY_OFFSET`.

### AN6 · Gestos deitado desenham um braço em pé flutuando — **média** · ✅ corrigido na Fase 52
- **Reproduzir:** deite e use `/acenar`, `/joinha`, `/coracao` ou `/cafe`. Aparece um braço em pé no ar, acima do corpo deitado.
- **Causa:** o gesto é aplicado sem olhar a postura, e não existem desenhos de gesto deitado.

### AN7 · Dança sentado ou deitado — **média** · ✅ corrigido na Fase 52
- **Reproduzir:**
  - Sentado + `/dancar`: o avatar "anda no lugar" dentro da cadeira.
  - Deitado + `/dancar`: fica em pé, deslocado.
- **Causa:**
  - A dança troca a postura por "andar" e gira o corpo, mantendo os deslocamentos de sentado/deitado.
  - No fim, a direção volta à de antes da dança, desfazendo viradas feitas nesse meio tempo.

### AN8 · Textura de avatar destruída enquanto aparece: o avatar some e a cena pode congelar — **média** (impacto alto) · ✅ corrigido na Fase 52
- **Reproduzir (provável):**
  - Duas pessoas com o mesmo visual: uma parada (ausente) e a outra gerando umas 160 poses novas (andar, falar, beber).
  - A textura de quem está parado é descartada e destruída 2 s depois, ainda na tela.
  - O desenho do Pixi lança erro e o laço de quadros para.
  - O mesmo risco existe quando o cache passa de 64 visuais.
- **Causa:**
  - O cache de poses (LRU de 160) e o de visuais (64) liberam texturas em uso.
  - A pose exibida não é "tocada" a cada quadro.
  - Código: `client/src/assets/FigureAvatarRenderer.ts`, `AvatarTextureCache.ts`.

### AN9 · Roupa animada (pet de ombro, itens) recria a textura 8 vezes por segundo — **média** (desempenho)
- **Causa:**
  - O quadro da roupa animada cresce sem parar e entra na chave do cache, que por isso nunca acerta.
  - Isso também acelera o AN8.

### AN10 · Na primeira vez, o copo demora a aparecer na mão — **baixa** · ✅ corrigido na Fase 52
- **Reproduzir:** recarregue a página e use `/cafe`. Muitas vezes o café inteiro (2,5 s) sai sem xícara.
- **Causa:**
  - A biblioteca de itens da mão é baixada na hora.
  - A cena só pede a pose de novo quando ela muda (piscar, gole), não quando a biblioteca chega.

### AN11 · O item da mão some durante acenar, joinha ou coração — **baixa** · ✅ corrigido na Fase 52
- **Causa:** "carregar" (braço direito + item) e o gesto do braço esquerdo não podem acontecer juntos.

### AN12 · Ponto preto solto no pescoço ao segurar bebida (direções 6 e 7) — **baixa**
- **Causa:** recortes de 1×1 px sem transparência na conversão das folhas de roupa (353 no `hh_human_item`).
- Código: `server/src/assets/swfFigure.ts`.

### AN13 · Falando, cabelo e chapéu pulam 1 px — **baixa** · ✅ corrigido na Fase 52
- **Causa:** quando falta o quadro da fala, a montagem cai no quadro 0 da fala, que é deslocado. O certo é cair na pose parada.

### AN14 · Andar "engasga" entre passos — **baixa** · ✅ corrigido na Fase 52
- **Causa:** se o passo acaba antes do próximo pacote, a pose parada aparece por alguns quadros. Falta uma tolerância.

### AN15 · Mangas e acessórios não acompanham alguns gestos — **baixa**
- **Exemplo:** sentado + joinha, a mão faz o gesto mas a manga fica sentada.
- **Causa:** não existem mangas para joinha, placa e beijo; dá para usar as de acenar e beber no lugar.

### AN16 · Efeitos com "apelido" de imagem funcionam por coincidência — **baixa**
- **Causa:** a camada de efeitos não segue o `source` dos apelidos (ex.: Twinkle).
- Código: `client/src/entities/EffectLayer.ts`.

### AN17 · Texturas dos visuais tirados do cache nunca são liberadas — **baixa** (memória)

### AN18 · Altura de quem senta é fixa (16 px), sem olhar a altura do assento — **baixa**, verificar
- **Efeito:** na almofada fica baixo demais; na banqueta, alto demais.

### AN19 · O quadro do avatar corta sapatos (sentado), rabos e bolsas largas — **baixa**

### AN20 · Efeitos não acompanham o avatar deitado — **baixa**

---

## Interação com móveis (IN)

### IN1 · Camas e cadeiras do catálogo "com estados" viram interruptor: clicar liga/desliga em vez de deitar/sentar — **alta** · ✅ corrigido na Fase 52
- **Reproduzir:** coloque a "Cama Arco-íris" ou a "Cama bagunçada" e clique nela. O avatar anda até o lado e a cama muda de estado, mas ele não deita. Afeta:
  - 47 de 135 camas do catálogo;
  - 375 de 987 assentos.
- **Causa:**
  - Itens com vários estados recebem a interação "liga/desliga".
  - O servidor trata "usar" antes de "sentar/deitar".
  - Código: `server/src/services/FurniDefService.ts`, `OfficeRoom.handleInteract`.

### IN2 · A cama só aceita a cabeceira como destino, sem testar se dá para chegar — **alta** (confirmado no navegador) · ✅ corrigido na Fase 52
- **Reproduzir:** cama encostada na parede (ou com criado-mudo dos lados) → clicar → "Não dá para chegar nesse lugar.", com o outro travesseiro livre. No teste, o avatar parou ao lado da cama e ficou em pé.
- **Causa:**
  - A escolha do lugar usa só a distância, sem calcular o caminho.
  - Os tiles da cama não servem de entrada; no Habbo dá para entrar por qualquer tile e "escorregar" até o travesseiro.
  - Código: `shared/src/posture.ts`, `OfficeRoom.handleInteract`.

### IN3 · Sentado, clicar no tile da mesa (ou "Ir até" um colega ao lado) deixa o avatar em pé dentro da cadeira — **alta** · ✅ corrigido na Fase 52
- **Reproduzir:** sente numa estação e clique na mesa à frente. Ele fica em pé no tile da cadeira, na altura do assento, e `/sentar` deixa de funcionar.
- **Causa:**
  - Com destino inalcançável, o "lugar alcançável mais perto" vira o próprio tile do assento.
  - Com um caminho vazio, o servidor muda a ação para parado.
  - Código: `shared/src/pathfinding.ts`, `server/src/rooms/MovementSystem.ts`.

### IN4 · Criar, editar ou excluir uma sala tira todo mundo dos assentos e manda para a entrada — **média-alta** · ✅ corrigido na Fase 52
- **Reproduzir:** com gente sentada na Recepção, um admin cria uma sala ou renomeia uma sala ligada à Recepção.
- **Causa:**
  - Ao reaplicar o layout, assentos contam como "não andáveis" para quem já está sentado, e a pessoa é realocada.
  - Quem estava num móvel apagado pela edição continua "sentado" no ar.

### IN5 · Falhar ao ir sentar ou usar deixa um passo pendurado; depois `/sentar`, `/deitar`, `/levantar` e as setas não funcionam — **média** · ✅ corrigido na Fase 52
- **Reproduzir:** clique numa cama inalcançável a 3 tiles ou mais (IN2). O avatar dá um passo e para; `/deitar` não faz nada.
- **Causa:** o movimento é iniciado antes de saber se o destino serve e não é desfeito na recusa.

### IN6 · Um "usar" antigo sequestra a ida à cadeira — **média** · ✅ corrigido na Fase 52
- **Reproduzir:** clique na máquina de café longe e, antes de chegar, clique numa cadeira cujo caminho passe por ela. O avatar pega café e não senta. Se no lugar da máquina houver um teleporte, a pessoa é teleportada.
- **Causa:** sentar e usar guardam intenções separadas, e a antiga não é apagada.

### IN7 · Objeto em cima de mesa (computador, luminária) fica impossível de usar — **média** · ✅ corrigido na Fase 52
- **Reproduzir:** coloque um computador no meio da mesa de 3×2 encostada na parede e clique nele: "Não dá para chegar perto desse móvel.". Quem está sentado em frente também não alcança.
- **Causa:** "chegar perto" usa só o tile do próprio objeto, não a mesa embaixo dele.

### IN8 · Usar um móvel sentado ou deitado gira o corpo para qualquer direção — **média** · ✅ corrigido na Fase 52
- **Efeito:** quebra a pose sentada (AN4) e tira o corpo da cama.

### IN9 · Duplo clique usa o móvel duas vezes (luz liga e desliga; teleporte dispara 2×) — **média** · ✅ corrigido na Fase 52
- **Causa:** cada clique vira um "usar" e o limite deixa passar rajadas; o teleporte não trava enquanto já está acontecendo.

### IN10 · Assento movido enquanto alguém anda até ele: a pessoa "senta no ar" onde ele estava — **baixa-média** · ✅ corrigido na Fase 52

### IN11 · `/levantar` num assento deixa a pessoa em pé dentro da cadeira ou da cama — **baixa-média** · ✅ corrigido na Fase 52

### IN12 · Pets ocupam cadeiras, sofás e camas, e jogadores sentam "em cima" do pet — **baixa**

### IN13 · O servidor recusa móvel no destino final de quem está andando ("Tem alguém nesse lugar." com o fantasma verde) — **baixa-média** · ✅ corrigido na Fase 52

### IN14 · Blocos altos "de pisar" (`bc_block`) não servem de base: o que vai em cima fica afundado — **baixa** · ✅ corrigido na Fase 56

### IN15 · Menores — **baixa** · ✅ corrigido na Fase 52
- O item na mão de uma aba some nas outras abas com `/largar`.
- O registro de itens na mão nunca apaga entradas vencidas.
- O teleporte acontece mesmo se a pessoa sair andando no meio.
- Sem o avatar montado (reserva do imager), deitar é desenhado como sentado.
- Camas do catálogo ganham altura de deitar até 1,0 (contra 0,5 calibrado). Conferido: flutuavam.

### IN16 · Deitado numa cama encostada em outros móveis, não dá para sair — **média** · ✅ corrigido na Fase 52
- **Achado na conferência da Fase 52.** Cama de Casal com a cabeceira encostada numa mesa, uma cadeira de um lado e a impressora do outro.
- **Reproduzir:** deite no travesseiro e clique no chão: "Não dá para chegar nesse lugar." `/levantar` responde "Não tem espaço para levantar." A pessoa fica presa na cama.
- **Causa:** em volta do travesseiro só há a própria cama, e cama não serve de passagem (só de destino).
- **Correção:** quem está numa cama ou sofá atravessa esse móvel para sair, como no Habbo, sem poder parar em cima dele. Sem vizinho livre, `/levantar` sai andando por cima da cama até o chão livre mais perto.

---

## Decorar e empilhar (DE)

### DE1 · Arrastar um objeto empilhado pela parte de cima faz ele pular para o chão atrás da mesa — **alta** · ✅ corrigido na Fase 53
- **Reproduzir:** computador em cima de uma mesinha; arraste-o pela tela. O fantasma vai para o chão 2 tiles atrás, verde; soltando, ele desce para lá.
- **Causa:**
  - O alvo do arrasto é o tile do piso sob o ponteiro. No isométrico, esse tile fica atrás do objeto.
  - O modo "tampo" só acerta dentro do losango do tampo.
  - Código: `client/src/scene/DecorMode.ts`, `RoomScene.pickTile/pickSurfaceTile`.

### DE2 · Ao arrastar perto de mesas, o fantasma pula e empilha sem querer — **alta** · ✅ corrigido na Fase 53
- **Reproduzir:** arraste uma mesa pelo canto e passe por cima de outra: ela salta um tile e sobe na outra. Soltando, empilha mesa sobre mesa.
- **Causa:** o ponto de pega é descontado no piso, mas não no tampo, e o tampo tem prioridade.

### DE3 · Móveis altos encostados na parede do fundo não arrastam pela parte de cima — **alta** · ✅ corrigido na Fase 53
- **Exemplos:** estante, geladeira, quadro, divisória de vidro.
- **Reproduzir:** pegue pela metade de cima e arraste: nada aparece, e soltar não faz nada, em silêncio.
- **Causa:** sobre a parede não existe tile de piso, então o fantasma some.

### DE4 · O contorno verde/vermelho e o da seleção ficam escondidos ao empilhar — **média** · ✅ corrigido na Fase 53
- **Reproduzir:** aponte a impressora para o tile da mesa ocupado pelo computador. O vermelho fica embaixo da mesa e o fantasma aparece no chão. Só ao clicar vem o erro.
- **Causa:** a camada de contornos fica por baixo dos móveis e é desenhada na altura do piso; o fantasma inválido desce para o chão e não muda de cor.

### DE5 · Sem atualização na hora: o móvel volta ao lugar antigo até o servidor responder; R rápido perde um giro; R durante o arrasto é desfeito — **média** · ✅ corrigido na Fase 53

### DE6 · Desfazer/refazer sai de sincronia e pode duplicar um móvel empilhado — **média** · ✅ corrigido na Fase 53
- **Exemplos:**
  - Remover uma base com coisas em cima mostra "removido [Desfazer]" junto com o erro.
  - O Desfazer do aviso desfaz a última ação, não aquela.
  - Um desfazer recusado pelo servidor, refeito depois, põe uma segunda mesa em cima da primeira.
- **Causa:** o histórico grava antes da confirmação do servidor e não percebe falhas.

### DE7 · Duplo clique (ou o modo "colocar" que continua) empilha cópias — **média** · ✅ corrigido na Fase 53

### DE8 · Trocar a cor de uma base com coisas em cima deixa os itens flutuando — **média** · ✅ corrigido na Fase 53
- **Exemplo:** o cofre (`safe_silo`) tem tampo, mas as outras cores dele vêm do catálogo sem tampo.

### DE9 · No celular: colocar é às cegas e um 2º dedo durante o arrasto embaralha tudo — **média** · ✅ corrigido na Fase 53

### DE10 · O clique pega o móvel errado — **média** · ✅ corrigido na Fase 53
- O acerto é exato por pixel, sem folga: 1–2 px fora do item pequeno pegam a mesa.
- No Decorar, arrastar sobre um tapete move o tapete em vez da câmera.
- O fallback por tile não olha a altura.

### DE11 · Itens de parede sobrepostos: o clique seleciona o de baixo — **baixa**

### DE12 · Itens de parede: o centro pula para o ponteiro e o x fica preso no meio de cada tile — **baixa**

### DE13 · Braços e encosto dos sofás ficam opacos no lugar antigo durante o arrasto — **baixa** · ✅ corrigido na Fase 53

### DE14 · Teclado: Esc não cancela o arrasto; segurar R ou Ctrl+Z manda dezenas de ações por segundo ("Calma!") — **baixa** · ✅ corrigido na Fase 53

### DE15 · Validação desatualizada: o fantasma fica verde onde alguém acabou de entrar ou num assento com gente — **baixa** · ✅ corrigido na Fase 53

### DE16 · Girar sem aviso em móveis de uma direção só; uma base quadrada com coisas em cima não gira — **baixa** · ✅ corrigido na Fase 53

### DE17 · Corrida no painel: o "Preparando…" de um item do catálogo substitui uma escolha mais nova — **baixa** · ✅ corrigido na Fase 53

### DE18 · Desempenho do arrasto — **baixa**
- A cada movimento do mouse: validação completa (com caminho até cada porta) e redesenho da grade.

### DE19 · O "tem tampo" do catálogo tem falsos positivos e falsos negativos — **baixa** · ✅ corrigido na Fase 56
- **Falsos positivos:** luminárias e velas "de mesa", cortinas.
- **Falsos negativos:** blocos e plataformas.

### DE20 · Botão direito ou do meio pode iniciar um arrasto que fica "armado" — **baixa/média** (provável no macOS) · ✅ corrigido na Fase 53

---

## O que está certo (conferido)
- A ordem de profundidade de móveis empilhados e avatares está correta em todas as combinações testadas: item na frente, atrás e dos lados; avatar sentado em frente à mesa. Os problemas visuais vêm dos contornos e do fantasma.
- A chave de cache das poses cobre todos os campos, e a troca de visual durante o carregamento é protegida.
- Os tempos de andar (4 quadros por passo), piscar e falar estão certos.
- Sentado + segurando item alinha corretamente.

## Limites da arte do Habbo (importante para danças e emotes)
- As roupas só têm desenhos destas ações:
  - em pé, andando (4 quadros), sentado e deitado;
  - braço esquerdo: acenar, joinha e placa;
  - braço direito: beijo, carregar e beber;
  - fala e expressões do rosto.
- **Não existem** desenhos de dança, palmas, pulo, reverência nem dos dois braços para cima.
- As danças do próprio Habbo reaproveitam esses desenhos, com ação, quadro, deslocamento e ajuste de direção por parte do corpo, quadro a quadro. É assim que as danças e os emotes novos vão ser feitos (seção 19 do `PLAN.md`).
