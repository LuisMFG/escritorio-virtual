# TURN da Cloudflare para as chamadas

As chamadas de áudio (Fase 49) vão direto de um navegador para o outro (WebRTC). Entre redes
de casa isso quase sempre funciona sozinho. Em **rede corporativa, Wi-Fi de empresa e 4G/5G**
a conexão direta costuma ser bloqueada, e aí o áudio precisa passar por um servidor **TURN**,
que repassa o áudio. O PC Windows não consegue fazer esse papel (o túnel da Cloudflare só leva
tráfego web, e o TURN precisa de portas UDP abertas), então usamos o TURN da própria Cloudflare.

Sem a configuração abaixo o escritório continua funcionando; as chamadas só falham entre
algumas redes.

## 1. Criar a conta (grátis)

1. Acesse <https://dash.cloudflare.com/sign-up> e crie uma conta com seu e-mail (não precisa de
   domínio nem de cartão para o plano gratuito do TURN).
2. Confirme o e-mail e entre no painel.

## 2. Criar a chave do TURN

1. No menu da esquerda, abra **Realtime** (em contas antigas aparece como **Calls**).
2. Entre em **TURN Server** e clique em **Create** (ou "Create TURN key").
3. Dê um nome, por exemplo `escritorio-virtual`, e confirme.
4. A tela mostra dois valores:
   - **Turn Token ID** (o identificador da chave);
   - **API Token** (o segredo). **Copie agora**: ele só aparece uma vez. Se perder, apague a
     chave e crie outra.

Confira na própria tela do TURN o limite do plano gratuito (é uma cota mensal de tráfego, de
sobra para um grupo de amigos conversando por áudio).

## 3. Colocar no servidor

No Ubuntu do PC Windows, em `~/escritorio-virtual`, edite o `.env` (por exemplo com
`nano .env`) e preencha:

```bash
CLOUDFLARE_TURN_KEY_ID=o-turn-token-id
CLOUDFLARE_TURN_API_TOKEN=o-api-token
```

Depois reinicie:

```bash
docker compose up -d
```

E confira no log:

```bash
docker compose logs --tail 30 escritorio | grep chamadas
```

Tem que aparecer `[chamadas] TURN da Cloudflare ligado`. Se aparecer `só STUN`, as variáveis
não foram lidas (confira o nome e se não há espaço antes do `=`).

## Como funciona por dentro

- O servidor pede à Cloudflare credenciais **temporárias** (valem 12 h e são renovadas a cada
  6 h) e entrega só elas ao navegador, junto com o STUN. O **API Token nunca sai do servidor**.
- Se a Cloudflare não responder, a chamada tenta só com STUN (não quebra).
- Código: `server/src/services/TurnService.ts`.

## Segurança

- Não coloque o API Token no git nem mande por chat; ele fica só no `.env` do servidor.
- Se ele vazar: no painel da Cloudflare, apague a chave do TURN e crie outra.
