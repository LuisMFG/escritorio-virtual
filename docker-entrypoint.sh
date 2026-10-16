#!/bin/sh
# Garante que a pasta de dados (volume) seja gravável e roda o app como o usuário `node`.
set -e
DATA_DIR="$(dirname "${DATABASE_PATH:-/app/data/sqlite.db}")"
mkdir -p "$DATA_DIR" "${ASSET_CACHE_DIR:-/app/data/asset-cache}"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" "${ASSET_CACHE_DIR:-/app/data/asset-cache}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
