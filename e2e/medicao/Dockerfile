# Navegador de uma pessoa na medição das chamadas: o Chromium do Playwright num contêiner
# próprio, para simular rede ruim (tc netem) só para ela. O teste conecta pela porta 3000.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
RUN apt-get update -qq && apt-get install -y -qq iproute2 socat >/dev/null && rm -rf /var/lib/apt/lists/*
RUN npm install -g playwright@1.64.1 >/dev/null
ENV NODE_PATH=/usr/lib/node_modules
COPY navegador.cjs /navegador.cjs
EXPOSE 3000
# O escritório e o servidor de mídia aparecem em localhost (endereço seguro para o navegador:
# microfone e câmera só funcionam assim).
CMD socat TCP-LISTEN:2600,fork,reuseaddr TCP:host.docker.internal:2600 & \
    socat TCP-LISTEN:7880,fork,reuseaddr TCP:${LIVEKIT_HOST}:7880 & \
    node /navegador.cjs
