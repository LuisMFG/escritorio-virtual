# Deploy na Oracle Cloud (Always Free)

Passo a passo para colocar o Escritório Virtual numa VM gratuita da Oracle Cloud, com HTTPS. Resultado: um endereço como `https://escritorio.203-0-113-10.sslip.io` (ou o seu domínio), com o app, o banco SQLite e o certificado rodando em Docker na VM.

> Os nomes de menus do painel da Oracle mudam de vez em quando; se algo estiver com outro nome, procure pelo equivalente.

## 1. Conta

1. Crie a conta em <https://www.oracle.com/cloud/free/>. O cartão é só para verificação; os recursos *Always Free* não são cobrados.
2. **Região principal (home region):** escolha com cuidado, porque não dá para trocar depois. Para o Brasil: *Brazil East (São Paulo)* ou *Brazil Southeast (Vinhedo)*. As VMs Ampere (A1) costumam esgotar nessas regiões; se isso for um problema, uma região menos disputada (ex.: *US East (Ashburn)*) funciona bem, só com um pouco mais de latência.

## 2. Criar a VM

**Compute → Instances → Create instance**

| Campo | Escolha |
|---|---|
| Nome | `escritorio` |
| Imagem | **Canonical Ubuntu 24.04** (com shape A1, a versão ARM/aarch64 é escolhida sozinha) |
| Shape | **Ampere → VM.Standard.A1.Flex**, com 1–2 OCPUs e 6–12 GB (o grátis vai até 4 OCPUs e 24 GB no total). Se der *Out of capacity*, tente outro *Availability Domain*, tente mais tarde, ou use **VM.Standard.E2.1.Micro** (AMD, 1 GB: funciona, o script cria swap para o build). |
| Rede | Crie uma VCN nova com **sub-rede pública** e marque **Assign a public IPv4 address**. |
| Chaves SSH | Envie a sua chave pública (`~/.ssh/id_ed25519.pub`) **ou** escolha *Generate a key pair* e baixe a chave privada. |
| Disco | O padrão serve (até 200 GB grátis no total). |

Ao terminar, anote o **IP público** da instância.

O app foi testado em ARM64 e em x86_64: as duas opções funcionam.

## 3. Liberar as portas 80 e 443 na rede da Oracle

Na página da instância: **Subnet → Security Lists → Default Security List → Add Ingress Rules**

| Source CIDR | Protocolo | Porta de destino |
|---|---|---|
| `0.0.0.0/0` | TCP | `80,443` |
| `0.0.0.0/0` | UDP | `443` (opcional, HTTP/3) |

A porta 22 (SSH) já vem liberada. Existe ainda um **segundo firewall dentro da VM** (as imagens Ubuntu da Oracle só aceitam SSH); o `setup-oracle.sh` cuida dele.

## 4. Endereço (domínio)

- **Sem domínio próprio:** use o [sslip.io](https://sslip.io), que aponta qualquer nome com o IP embutido para esse IP. Troque os pontos do IP por hífens: IP `203.0.113.10` → `escritorio.203-0-113-10.sslip.io`.
- **Com domínio próprio:** crie um registro **A** (ex.: `escritorio.seudominio.com.br`) apontando para o IP público e espere propagar.

O Caddy pede o certificado HTTPS (Let's Encrypt) sozinho na primeira subida; para isso a porta 80 precisa estar aberta (passo 3).

## 5. Primeiro deploy (do seu computador)

Se baixou a chave da Oracle, proteja-a:

```bash
chmod 600 ~/Downloads/ssh-key-*.key
```

Teste o acesso (o usuário das imagens Ubuntu é `ubuntu`):

```bash
ssh -i ~/Downloads/ssh-key-XXXX.key ubuntu@203.0.113.10 'uname -m && free -h'
```

Crie o `.env` de produção **na VM** (escolha um código de convite difícil de adivinhar):

```bash
ssh -i ~/Downloads/ssh-key-XXXX.key ubuntu@203.0.113.10 'mkdir -p escritorio && cat > escritorio/.env && chmod 600 escritorio/.env' <<'ENV'
INVITE_CODE=troque-por-um-codigo-seu
DOMAIN=escritorio.203-0-113-10.sslip.io
HABBOASSETS_API_KEY=
ENV
```

Na pasta do projeto, prepare a VM e suba tudo (o `--setup` só precisa na primeira vez):

```bash
scripts/deploy.sh ubuntu@203.0.113.10 ~/Downloads/ssh-key-XXXX.key --setup
```

O primeiro build leva alguns minutos (mais na VM de 1 GB). No fim, o script mostra o endereço `https://…`.

## 6. Atualizar

Depois de mudar o código, rode o mesmo comando sem `--setup`:

```bash
scripts/deploy.sh ubuntu@203.0.113.10 ~/Downloads/ssh-key-XXXX.key
```

O banco e o cache de imagens (`~/escritorio/data` na VM) nunca são apagados pelo deploy. Quem estiver online é reconectado sozinho quando o app reinicia.

## 7. Operação

Ver os logs:

```bash
ssh -i CHAVE ubuntu@IP 'cd escritorio && docker compose logs -f --tail 100'
```

Backup do banco (para o app por alguns segundos):

```bash
ssh -i CHAVE ubuntu@IP 'cd escritorio && docker compose stop escritorio && tar czf ~/backup-escritorio.tgz data/sqlite.db* && docker compose start escritorio'
```

```bash
scp -i CHAVE ubuntu@IP:backup-escritorio.tgz .
```

Trocar o código de convite: edite `~/escritorio/.env` na VM e rode `docker compose up -d` na pasta `escritorio`.

## 8. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| O site não abre (tempo esgotado) | Faltou a regra de entrada do passo 3, ou o `setup-oracle.sh` não rodou (firewall interno). |
| Erro de certificado / Caddy não pega o certificado | O `DOMAIN` não aponta para o IP, ou a porta 80 está fechada. Veja `docker compose logs caddy`. |
| *Out of capacity* ao criar a VM A1 | Falta de máquinas na região: tente outro Availability Domain, outro horário, ou a E2.1.Micro. |
| Build travando ou morrendo na VM de 1 GB | Falta de memória: confirme o swap com `swapon --show` (o setup cria 2 GB). |
| A VM some depois de semanas parada | A Oracle pode recuperar instâncias *Always Free* muito ociosas. Converter a conta para *Pay As You Go* evita isso e continua sem custo dentro dos limites grátis. |
