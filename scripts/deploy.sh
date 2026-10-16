#!/usr/bin/env bash
# Envia o projeto para o VPS e sobe (ou atualiza) os containers.
#
#   scripts/deploy.sh ubuntu@IP [~/.ssh/chave] [--setup]
#
# --setup roda antes o setup-oracle.sh na máquina (primeira vez).
# O .env do servidor NÃO é enviado: crie-o uma vez em ~/escritorio/.env (veja docs/DEPLOY-ORACLE.md).
# Os dados (~/escritorio/data) nunca são apagados pelo deploy.
set -euo pipefail

TARGET="${1:?uso: scripts/deploy.sh usuario@host [chave_ssh] [--setup]}"
shift
KEY=""
SETUP=0
for arg in "$@"; do
  case "$arg" in
    --setup) SETUP=1 ;;
    *) KEY="$arg" ;;
  esac
done

SSH=(ssh -o StrictHostKeyChecking=accept-new)
[ -n "$KEY" ] && SSH+=(-i "$KEY")
REMOTE_DIR="escritorio"
cd "$(dirname "$0")/.."

if [ "$SETUP" = 1 ]; then
  echo "==> Preparando a máquina (setup-oracle.sh)"
  "${SSH[@]}" "$TARGET" 'bash -s' < scripts/setup-oracle.sh
fi

echo "==> Enviando o código"
rsync -az --delete \
  --exclude node_modules --exclude '**/node_modules' --exclude client/dist \
  --exclude data --exclude .env --exclude .git --exclude .claude --exclude '*.log' \
  -e "${SSH[*]}" ./ "$TARGET:$REMOTE_DIR/"

echo "==> Subindo os containers"
"${SSH[@]}" "$TARGET" "cd $REMOTE_DIR && \
  if [ ! -f .env ]; then echo 'Falta ~/$REMOTE_DIR/.env no servidor (INVITE_CODE e DOMAIN). Veja docs/DEPLOY-ORACLE.md.'; exit 1; fi && \
  docker compose up -d --build --remove-orphans && docker compose ps && docker image prune -f >/dev/null"

DOMAIN="$("${SSH[@]}" "$TARGET" "grep -E '^DOMAIN=' $REMOTE_DIR/.env | cut -d= -f2-")"
echo "==> No ar: https://$DOMAIN (o primeiro certificado pode levar ~1 minuto)"
