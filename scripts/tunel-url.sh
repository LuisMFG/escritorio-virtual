#!/bin/sh
# Mostra o endereço público do túnel rápido da Cloudflare (perfil tunel-rapido do compose).
# O endereço muda sempre que o túnel reinicia; rode de novo depois de reiniciar.
cd "$(dirname "$0")/.."
URL="$(docker compose logs tunel-rapido 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)"
if [ -z "$URL" ]; then
  echo "Túnel ainda sem endereço. Confira: COMPOSE_PROFILES=tunel-rapido no .env e 'docker compose ps'."
  exit 1
fi
echo "$URL"
