# Medição das chamadas: antes e depois do servidor de mídia

Medido em 24/10/2026 com `npm run medir:chamada` (`e2e/medicao/`). O mesmo roteiro rodou no código antigo (malha: cada pessoa manda o vídeo direto para cada outra) e no novo (LiveKit: cada pessoa manda uma vez, em camadas, e o servidor entrega a certa para cada um).

## Como é medido

- **Pessoas:** 3, cada uma num navegador Chromium em Docker próprio, com a janela da chamada ampliada. Ana liga a câmera e compartilha a tela; Beto e Caio ligam a câmera.
- **Fases (25 s cada):**
  1. rede boa para todos;
  2. Ana e Caio destacam a câmera do Beto;
  3. rede ruim só para o Caio (4G fraco: 80 ms ± 20 de atraso, 2% de perda, 1,5 Mbit/s de subida e 2 de descida, com `tc netem`).
- **Câmera e tela:** canvas com movimento e texto. Num canto vai um relógio em blocos; quem recebe lê o relógio de cada quadro e calcula o **atraso de verdade** (da captura até o quadro na tela). Todos os navegadores usam o mesmo relógio.
- **Resolução, fps e bitrate:** saem das estatísticas do WebRTC de cada navegador.

**Limite da medição:** os 3 navegadores rodam numa máquina só (Mac M4, 10 núcleos), sem placa de vídeo, codificando em software. Isso derruba o **fps** de tudo, inclusive da própria captura (de 5 a 10 fps). Os números de fps abaixo são desta máquina; num computador de verdade, cada pessoa tem o próprio processador e a câmera sai a 30 fps. Atraso, banda e resolução comparam bem, porque as duas versões rodaram nas mesmas condições.

## Resultado

| | Antes (malha) | Depois (LiveKit) |
|---|---|---|
| Câmera da Ana enquanto ela compartilha a tela | não aparece (a tela substitui a câmera) | aparece, em miniatura sobre a tela |
| Upload de vídeo de quem só tem câmera | ~3 Mbit/s (uma cópia para cada pessoa) | 0,16 Mbit/s (uma camada, do tamanho do quadro) |
| Atraso das câmeras, rede boa (mediana / p95) | 120–215 ms / 230–370 ms | 100–115 ms / 175–240 ms |
| Câmera do Beto em destaque | 640×360 (resolução fixa) | 960×540 (sobe sozinha com o quadro) |
| Tela compartilhada, rede boa (mediana / p95) | 265–290 ms / 1,0–1,2 s | ~360 ms / ~640 ms |
| Câmera do Caio (rede ruim) para os outros | 525–550 ms | 290–310 ms |
| Câmeras dos outros chegando para o Caio (rede ruim) | ~290 ms | ~210 ms |
| Congelamentos por pessoa em 25 s (rede ruim) | 6–8 | 2–5 |

### Leitura

- **Atraso:** caiu em todas as câmeras. Com a rede ruim do Caio, o vídeo dele chega aos outros em cerca de metade do tempo.
- **Banda e escala:** antes, cada pessoa subia uma cópia do vídeo para cada outra; com 6 pessoas, seriam 5 cópias. Agora sobe uma só, e cada um recebe a camada que cabe no quadro e na conexão dele.
- **Qualidade que acompanha o tamanho:** com o quadro pequeno, chega a camada pequena; destacado, chega a de 960×540, e a de 1080p em tela grande ou retina.
- **Tela compartilhada:** a mediana ficou parecida. Nesta máquina, a Ana estava no limite do processador (codificando tela e câmera em 1080p por software), e é isso que segura o fps da tela. O pico (p95) caiu quase pela metade.
- **Rede ruim:** quem tem rede boa continua recebendo do mesmo jeito. A rede do Caio pesa só no vídeo do próprio Caio.

Os números completos de cada rodada ficam em `e2e/medicao/resultados/` (fora do git) quando a medição roda.
