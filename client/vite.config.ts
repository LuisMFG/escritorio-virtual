import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Desfoque de fundo da chamada: o WebAssembly do recorte de pessoa vem do pacote do MediaPipe e
 * é servido pelo próprio site (em `public/mediapipe/wasm`, fora do git), sem depender de CDN.
 */
function mediapipeWasm(): Plugin {
  const copy = () => {
    const pkg = dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision'));
    const out = join(dirname(fileURLToPath(import.meta.url)), 'public/mediapipe/wasm');
    mkdirSync(out, { recursive: true });
    for (const name of ['vision_wasm_internal', 'vision_wasm_nosimd_internal']) {
      for (const ext of ['js', 'wasm']) {
        const file = `${name}.${ext}`;
        if (!existsSync(join(pkg, 'wasm', file))) throw new Error(`MediaPipe sem ${file}`);
        copyFileSync(join(pkg, 'wasm', file), join(out, file));
      }
    }
  };
  return { name: 'mediapipe-wasm', buildStart: copy };
}

/** Em desenvolvimento, REST e assets passam pelo Vite (mesma origem); o WebSocket vai direto ao servidor. */
const SERVER = 'http://localhost:2567';

export default defineConfig({
  plugins: [mediapipeWasm()],
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/hh': SERVER,
      '/healthz': SERVER,
    },
  },
  build: {
    target: 'es2022',
    // O PixiJS sozinho passa de 500 kB; com gzip o app inteiro fica em ~110 kB.
    chunkSizeWarningLimit: 700,
  },
});
