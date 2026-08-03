import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './room.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { pickLanAddress } from './network.js';
import { createServer } from './server.js';

const PORT = 8080;
const SNAPSHOT_PATH = './room-snapshot.json';
const CLIENT_DIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../client/dist',
);

async function main(): Promise<void> {
  const initial = await readSnapshot(SNAPSHOT_PATH);
  const room = new Room(initial ?? undefined);

  // Записи снапшота сериализуются в очередь, чтобы более медленная запись
  // не перезаписала диск устаревшим состоянием после более быстрой поздней записи.
  let writeQueue: Promise<void> = Promise.resolve();
  room.onChange((state) => {
    writeQueue = writeQueue.then(() =>
      writeSnapshot(SNAPSHOT_PATH, state).catch((err: unknown) => {
        console.error('Не удалось записать снапшот:', err);
      }),
    );
  });

  const lanAddress = pickLanAddress(networkInterfaces());
  const lanUrl = lanAddress
    ? `http://${lanAddress}:${PORT}/`
    : `http://localhost:${PORT}/`;

  const { httpServer } = createServer({
    room,
    clientDistPath: CLIENT_DIST_PATH,
    lanUrl,
  });

  httpServer.listen(PORT, () => {
    console.log(`Своя игра слушает на ${lanUrl}`);
  });
}

void main();
