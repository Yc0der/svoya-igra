import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // e2e/lobby.spec.ts и e2e/round.spec.ts работают против одного и того же
  // процесса сервера (Room внутри процесса одна на всё время его жизни) —
  // сериализуем их, чтобы участник, присоединившийся в одном файле, не
  // оставался физически подключённым в момент, когда другой файл запускает
  // игру. e2e/final.spec.ts на это не завязан (отдельный сервер/порт/комната),
  // но общий workers: 1 не создаёт для него проблемы — только чуть медленнее.
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: 'node e2e/reset-snapshot.mjs && pnpm run start',
      port: 8080,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Отдельный порт, отдельный снапшот, отдельный (маленький) пакет —
      // не пересекается с комнатой, которую использует default-проект.
      command:
        'node e2e/reset-snapshot.mjs ./e2e/fixtures/final-room-snapshot.json && pnpm run start',
      port: 8081,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: '8081',
        PACK_PATH: './e2e/fixtures/final-pack.json',
        SNAPSHOT_PATH: './e2e/fixtures/final-room-snapshot.json',
      },
    },
  ],
  projects: [
    {
      name: 'default',
      testMatch: ['lobby.spec.ts', 'round.spec.ts'],
      use: { baseURL: 'http://localhost:8080' },
    },
    {
      name: 'final',
      testMatch: 'final.spec.ts',
      use: { baseURL: 'http://localhost:8081' },
    },
  ],
});
