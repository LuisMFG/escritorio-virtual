# syntax=docker/dockerfile:1
# Escritório Virtual: um único processo Node serve o cliente compilado, a API e o WebSocket.

# ---------- Build do cliente ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
# Scripts de instalação não são necessários: better-sqlite3 traz binários prontos e o
# esbuild usa o pacote opcional da plataforma.
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY shared shared
COPY client client
RUN npm run build -w client

# ---------- Runtime ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=2567 \
    DATABASE_PATH=/app/data/sqlite.db \
    ASSET_CACHE_DIR=/app/data/asset-cache
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --ignore-scripts --workspace server --workspace shared \
  && npm cache clean --force
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
# O servidor lê os manifestos (catálogo de móveis e de roupas) para validar.
COPY client/public/assets client/public/assets
COPY --from=build /app/client/dist client/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/data && chown node:node /app/data

VOLUME /app/data
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "server/src/index.ts"]
