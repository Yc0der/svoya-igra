import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'node e2e/reset-snapshot.mjs && pnpm run build && pnpm run start',
    port: 8080,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:8080',
  },
});
