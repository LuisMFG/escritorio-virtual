# Servidor num PC Windows (WSL2 + Docker)

O PC Windows vira o "VPS" do escritório: o app roda em Docker dentro do Linux do WSL2, sobe
sozinho quando o PC liga e fica acessível pela internet por um túnel da Cloudflare (sem abrir
portas no roteador). O desenvolvimento continua em outra máquina; aqui só se atualiza com
`git pull`.

Folga de sobra: com 15–20 pessoas o app usa ~300–500 MB de RAM e quase nada de CPU.

## 1. WSL2 com Ubuntu

No **PowerShell como administrador**:

```powershell
wsl --install -d Ubuntu-24.04
```

Reinicie o PC quando pedir. Na primeira abertura do Ubuntu, crie o usuário e a senha do Linux.

## 2. Docker Desktop

```powershell
winget install -e --id Docker.DockerDesktop
```

Abra o Docker Desktop e, em **Settings**:
- **General:** marque *Use the WSL 2 based engine* e *Start Docker Desktop when you sign in to your computer*.
- **Resources → WSL integration:** ligue para o *Ubuntu-24.04*.

Confira no Ubuntu: `docker run --rm hello-world`.

## 3. Projeto dentro do Linux (não em `C:\`)

O banco é SQLite: ele precisa ficar no disco do Linux (`~/…`), não em `/mnt/c/…`, onde fica
lento e pode corromper. No **Ubuntu**:

```bash
sudo apt update && sudo apt install -y git unzip gh
gh auth login            # GitHub.com → HTTPS → login pelo navegador
gh repo clone LuisMFG/escritorio-virtual ~/escritorio-virtual
```

## 4. `.env` e dados

O `.env` e a pasta `data/` (banco, backups, `secret.key`, anexos) não estão no git: vêm no
`escritorio-dados.zip`. Baixe-o no Windows (ex.: Downloads) e, no Ubuntu:

```bash
cd ~/escritorio-virtual
unzip /mnt/c/Users/SEU_USUARIO_WINDOWS/Downloads/escritorio-dados.zip -d .
ls -la .env data/sqlite.db data/secret.key
```

No `.env`, para abrir pela internet com o túnel rápido:

```bash
COMPOSE_PROFILES=tunel-rapido
```

(`APP_BIND=0.0.0.0` também abre na rede local em `http://IP-DO-PC:2567`.)

## 5. Subir

```bash
cd ~/escritorio-virtual
docker compose up -d --build
docker compose ps
./scripts/tunel-url.sh      # endereço público https://….trycloudflare.com
```

No Windows, `http://localhost:2567` abre o escritório. O endereço do túnel é o que você manda
para os amigos (junto com o `INVITE_CODE` do `.env` para criarem conta).

O endereço do túnel rápido **muda quando o túnel reinicia** (PC reiniciado, `docker compose
restart`). Rode `./scripts/tunel-url.sh` de novo para ver o novo. Para um endereço fixo, use o
perfil `tunel` com uma conta e um domínio na Cloudflare (`TUNNEL_TOKEN` no `.env`).

## 6. Sempre ligado

- O Docker Desktop abre no login e os containers têm `restart: unless-stopped`: o escritório
  volta sozinho depois de reiniciar o PC (após o login no Windows).
- Desligue a suspensão com o PC na tomada (PowerShell como administrador):

  ```powershell
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  ```

## 7. Atualizar

```bash
cd ~/escritorio-virtual
git pull
docker compose up -d --build
./scripts/tunel-url.sh
```

As migrations do banco rodam sozinhas ao subir.

## 8. Dia a dia

| Para | Comando (no Ubuntu, em `~/escritorio-virtual`) |
|---|---|
| Ver os logs | `docker compose logs -f --tail 100 escritorio` |
| Parar / iniciar | `docker compose stop` / `docker compose up -d` |
| Endereço do túnel | `./scripts/tunel-url.sh` |
| Abrir a pasta no Windows | `\\wsl$\Ubuntu-24.04\home\SEU_USUARIO_LINUX\escritorio-virtual` no Explorer |

Backups automáticos do banco: `data/backups/` (todo dia às 3h). Copie de vez em quando para
fora do PC (Google Drive, por exemplo).

## Observações

- **Chamadas de áudio:** para funcionar com quem está em rede de empresa ou 4G, configure o
  TURN da Cloudflare: [TURN-CLOUDFLARE.md](TURN-CLOUDFLARE.md).

- **Spotify:** o endereço de retorno cadastrado no painel do Spotify precisa ser
  `https://ENDERECO-PUBLICO/api/spotify/callback` (e o mesmo no `SPOTIFY_REDIRECT_URI` do
  `.env`). Com o túnel rápido o endereço muda a cada reinício, então o Spotify só fica prático
  com o túnel fixo.
- **Gráficos do Habbo:** uso pessoal e privado, escritório fechado por convite.
