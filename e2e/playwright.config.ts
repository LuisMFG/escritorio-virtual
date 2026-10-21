import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Testes de ponta a ponta: o servidor sobe em modo produção (servindo o client/dist) numa
 * porta própria, com banco e backups temporários, sem atrapalhar o `npm run dev`.
 */
const PORT = 2600;
const data = mkdtempSync(join(tmpdir(), 'escritorio-e2e-'));

export default defineConfig({
  testDir: './tests',
  // Um servidor e um banco para todos: cada teste usa contas próprias, mas em sequência.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../e2e-report' }]],
  outputDir: '../e2e-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Chamadas (Fase 49): microfone de mentira e permissão sem perguntar.
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: [
    {
      // Jira Cloud de mentira (Fase 30).
      command: 'node e2e/jira-mock.mjs',
      cwd: '..',
      url: 'http://127.0.0.1:2601/healthz',
      reuseExistingServer: false,
    },
    {
      command: 'npx tsx server/src/index.ts',
      cwd: '..',
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'production',
        PORT: String(PORT),
        INVITE_CODE: 'convite-e2e',
        DATABASE_PATH: join(data, 'e2e.db'),
        BACKUP_DIR: join(data, 'backups'),
        UPLOAD_DIR: join(data, 'uploads'),
        ASSET_CACHE_DIR: join(data, 'cache'),
        LOGIN_RATE_LIMIT: '1000',
        SPOTIFY_CLIENT_ID: '',
        ADMIN_USERNAMES: 'admin.e2e',
        JIRA_SITE: 'http://127.0.0.1:2601',
        // Catálogo completo sem o imager (Fase 36).
        FURNI_MEASURE: 'offline',
      },
    },
  ],
});
