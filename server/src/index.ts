import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, type RoomState } from './room.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { listLanCandidates, pickLanAddress } from './network.js';
import { createServer } from './server.js';
import { loadPack } from './pack.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH ?? './room-snapshot.json';
const PACK_PATH = process.env.PACK_PATH ?? './packs/current.json';
const CLIENT_DIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../client/dist',
);

async function main(): Promise<void> {
  // Битый снапшот не должен мешать серверу подняться. `writeSnapshot` теперь
  // пишет во временный файл и переименовывает его поверх настоящего — это
  // само по себе исключает обрезку при Ctrl+C посреди записи, но не отменяет
  // необходимость в этой защите: файл может быть повреждён и другим способом
  // (ручная правка, перенос со старой версии сервера). `readSnapshot`
  // пробрасывает всё, кроме ENOENT, а `deserializeSnapshot` бросает голый
  // TypeError на невалидном JSON или отсутствующем `participants` — на любой
  // такой случай пустая комната куда лучший исход, чем сервер, который вообще
  // отказывается стартовать.
  let initial: RoomState | null = null;
  try {
    initial = await readSnapshot(SNAPSHOT_PATH);
  } catch (err) {
    console.error(
      `Снапшот ${SNAPSHOT_PATH} повреждён, стартуем с пустой комнатой:`,
      err,
    );
  }
  let pack;
  try {
    pack = await loadPack(PACK_PATH);
  } catch (err) {
    console.error(
      `Не удалось загрузить пакет вопросов ${PACK_PATH} — без него игру не начать:`,
      err,
    );
    process.exitCode = 1;
    return;
  }

  const room = new Room(initial ?? undefined, pack);

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

  // Автовыбор адреса — эвристика «первый non-internal IPv4», и она вполне
  // может указать на виртуальный адаптер (VirtualBox/WSL/Hyper-V), недостижимый
  // с телефона. Сервер при этом слушает все интерфейсы и работает, а вот QR на
  // табло ведёт в никуда — отказ молчаливый. Поэтому печатаем всех кандидатов,
  // чтобы человек увидел, что выбрано и что ещё было, и даём переопределить.
  const interfaces = networkInterfaces();
  const candidates = listLanCandidates(interfaces);
  console.log(
    candidates.length > 0
      ? `Найденные сетевые адреса: ${candidates
          .map(({ address, interfaceName }) => `${address} (${interfaceName})`)
          .join(', ')}`
      : 'Найденные сетевые адреса: нет',
  );

  const lanAddress = process.env.LAN_HOST ?? pickLanAddress(interfaces);
  console.log(
    `Используется: ${lanAddress ?? 'localhost'}${
      process.env.LAN_HOST ? ' (из LAN_HOST)' : ''
    }. Если адрес не тот, задайте LAN_HOST=<ваш IP>.`,
  );

  const lanUrl = lanAddress
    ? `http://${lanAddress}:${PORT}/`
    : `http://localhost:${PORT}/`;

  const { httpServer } = createServer({
    room,
    clientDistPath: CLIENT_DIST_PATH,
    lanUrl,
  });

  // Без этого обработчика занятый порт (например, процесс, оставшийся от
  // предыдущего прогона живой проверки) выпадает необработанной ошибкой
  // сокета и печатает сырой стек вместо внятного объяснения.
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Порт ${PORT} уже занят — вероятно, сервер уже запущен. Остановите его и попробуйте снова.`,
      );
    } else {
      console.error('Ошибка HTTP-сервера:', err);
    }
    process.exitCode = 1;
  });

  httpServer.listen(PORT, () => {
    console.log(`Своя игра слушает на ${lanUrl}`);
  });
}

main().catch((err: unknown) => {
  console.error('Не удалось запустить сервер:', err);
  process.exitCode = 1;
});
