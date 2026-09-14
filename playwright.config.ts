import { defineConfig } from '@playwright/test';

// Каталог данных сервера e2e: снапшот комнаты, история, анкеты, профиль
// генератора, текущий пакет. Без явных путей сервер брал умолчания — настоящие
// данные компании, и прогон их переписывал (см. e2e/reset-data.mjs). У
// каждого webServer свой каталог: общая история просачивалась бы между ними —
// человек, вошедший на 8080, появлялся бы в лобби на 8081.
//
// Пакет не указывается как файл примера напрямую: сервер заводит
// current.json из packs/current.example.json сам (ensureFileFromExample), так
// что локальный прогон берёт тот же пакет, что и чистый checkout, и ничего не
// пишет в сам пример.
function isolatedData(dir: string): Record<string, string> {
  return {
    SNAPSHOT_PATH: `${dir}/room-snapshot.json`,
    HISTORY_PATH: `${dir}/game-history.db`,
    PLAYERS_PATH: `${dir}/players.md`,
    PROFILE_PATH: `${dir}/pack-generator-profile.md`,
    LAN_HOST_CONFIG_PATH: `${dir}/lan-host.local.json`,
    AUDIO_SETTINGS_PATH: `${dir}/audio-settings.local.json`,
  };
}

const DEFAULT_DATA = './e2e/.data/default';
const FINAL_DATA = './e2e/.data/final';

export default defineConfig({
  testDir: './e2e',
  // e2e/lobby.spec.ts и e2e/round.spec.ts работают против одного и того же
  // процесса сервера (Room внутри процесса одна на всё время его жизни) —
  // сериализуем их, чтобы участник, присоединившийся в одном файле, не
  // оставался физически подключённым в момент, когда другой файл запускает
  // игру. e2e/final.spec.ts на это не завязан (отдельный сервер/порт/комната),
  // но общий workers: 1 не создаёт для него проблемы — только чуть медленнее.
  workers: 1,
  webServer: [
    {
      command: `node e2e/reset-data.mjs ${DEFAULT_DATA} && pnpm run start`,
      port: 8080,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...isolatedData(DEFAULT_DATA),
        PACK_PATH: `${DEFAULT_DATA}/current.json`,
      },
    },
    {
      // Отдельный порт, отдельный каталог данных, отдельный (маленький)
      // пакет — не пересекается с комнатой, которую использует default-проект.
      command: `node e2e/reset-data.mjs ${FINAL_DATA} && pnpm run start`,
      port: 8081,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...isolatedData(FINAL_DATA),
        PORT: '8081',
        PACK_PATH: './e2e/fixtures/final-pack.json',
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
