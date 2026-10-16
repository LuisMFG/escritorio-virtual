import { defineConfig } from 'vite';

/** Em desenvolvimento, REST e assets passam pelo Vite (mesma origem); o WebSocket vai direto ao servidor. */
const SERVER = 'http://localhost:2567';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/hh': SERVER,
      '/healthz': SERVER,
    },
  },
  build: { target: 'es2022' },
});
