import { defineConfig } from '@playwright/test';
import base from '../playwright.config.js';

/**
 * Medição das chamadas (`npm run medir:chamada`): o mesmo servidor de teste dos outros testes,
 * mas os navegadores rodam em Docker (um por pessoa). Dentro de cada contêiner, o localhost:2600
 * é repassado para este computador (o escritório).
 */
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '*.medicao.ts',
  timeout: 600_000,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../e2e-results',
  use: { ...base.use, baseURL: 'http://localhost:2600' },
  // As pastas dos servidores são relativas à configuração (esta fica um nível abaixo). O LiveKit
  // daqui roda num contêiner na mesma rede dos navegadores (o teste sobe), não no computador.
  webServer: [base.webServer ?? []]
    .flat()
    .filter((w) => !String(w.command).includes('livekit'))
    .map((w) => ({
      ...w,
      cwd: '../..',
      env: {
        ...w.env,
        // Cada contêiner repassa o próprio localhost:7880 para o LiveKit da rede da medição.
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_URL: 'http://127.0.0.1:7880',
      },
    })),
});
