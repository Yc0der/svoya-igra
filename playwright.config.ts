import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // e2e/lobby.spec.ts и e2e/round.spec.ts работают против одного и того же
  // процесса сервера (webServer один на весь testDir, Room внутри процесса
  // тоже одна на всё время его жизни). Playwright по умолчанию гоняет разные
  // spec-файлы параллельными воркерами — сериализуем их, чтобы участник,
  // присоединившийся в одном файле, не оставался физически подключённым в
  // момент, когда другой файл запускает игру.
  workers: 1,
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
