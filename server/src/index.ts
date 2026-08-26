import { networkInterfaces } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, type RoomState } from './room.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { readLanHostConfig, writeLanHostAddress } from './lan-host.js';
import { listLanCandidates, pickLanAddress } from './network.js';
import { createServer } from './server.js';
import { loadPack } from './pack.js';
import { listAvailablePacks } from './packs.js';
import { GameHistory } from './history.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH ?? './room-snapshot.json';
const PACK_PATH = process.env.PACK_PATH ?? './packs/current.json';
// Резолвится от import.meta.url, а не от cwd (тем же приёмом, что и
// CLIENT_DIST_PATH ниже) — иначе дефолт молча разъезжается с тем, что
// использует server/scripts/*.ts (те запускаются из server/, а не из
// корня): GameHistory создаёт файл базы, если его нет, поэтому запуск не
// из того каталога не падает с ошибкой, а тихо открывает пустую базу
// рядом (финальное ревью ветки, п. 4). server/src/*.ts (dev через tsx),
// server/dist/*.js (собранный) и server/scripts/*.ts лежат на одной
// глубине относительно корня репозитория, так что путь '../../' общий.
const HISTORY_PATH =
  process.env.HISTORY_PATH ??
  join(dirname(fileURLToPath(import.meta.url)), '../../game-history.db');
const LAN_HOST_CONFIG_PATH =
  process.env.LAN_HOST_CONFIG_PATH ?? './lan-host.local.json';
const PROFILE_PATH =
  process.env.PROFILE_PATH ?? './docs/pack-generator-profile.md';
// Разовая добавка к hiddenInterfaces из LAN_HOST_CONFIG_PATH ниже — для
// одного запуска, не заводя постоянную запись в файл. Список интерфейсов,
// не адресов: у заведомо бесполезных на этой машине адаптеров (VPN,
// виртуалки) interfaceName стабильнее, чем их address, — тот может
// смениться между запусками, имя обычно нет.
const LAN_HOST_HIDE_ENV = new Set(
  (process.env.LAN_HOST_HIDE ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0),
);
const CLIENT_DIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../client/dist',
);
const PACKS_DIR = dirname(PACK_PATH);

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

  // Автовыбор адреса — эвристика «первый non-internal IPv4», и она вполне
  // может указать на виртуальный адаптер (VirtualBox/WSL/Hyper-V), недостижимый
  // с телефона. Сервер при этом слушает все интерфейсы и работает, а вот QR на
  // табло ведёт в никуда — отказ молчаливый. Поэтому печатаем всех кандидатов,
  // чтобы человек увидел, что выбрано и что ещё было, и даём выбрать нужный
  // прямо в админ-панели (Admin.tsx) — выбор переживает перезапуск через
  // LAN_HOST_CONFIG_PATH, не только через ручной LAN_HOST на этот один раз.
  let lanConfig = {
    address: null as string | null,
    hiddenInterfaces: [] as string[],
  };
  try {
    lanConfig = await readLanHostConfig(LAN_HOST_CONFIG_PATH);
  } catch (err) {
    console.error(
      `Файл ${LAN_HOST_CONFIG_PATH} повреждён, игнорируем сохранённые адрес и список скрытых адаптеров:`,
      err,
    );
  }
  const hiddenInterfaces = new Set([
    ...lanConfig.hiddenInterfaces,
    ...LAN_HOST_HIDE_ENV,
  ]);

  const interfaces = networkInterfaces();
  const candidates = listLanCandidates(interfaces).filter(
    (c) => !hiddenInterfaces.has(c.interfaceName),
  );
  console.log(
    candidates.length > 0
      ? `Найденные сетевые адреса: ${candidates
          .map(({ address, interfaceName }) => `${address} (${interfaceName})`)
          .join(', ')}`
      : 'Найденные сетевые адреса: нет',
  );

  // Сохранённый адрес мог устареть (сменилась сеть/адаптеры, или адаптер
  // только что скрыли) — используем его, только если он всё ещё среди
  // реально найденных кандидатов, иначе тихо откатываемся к автовыбору
  // вместо того, чтобы упорствовать в адресе, которого больше нет.
  const savedAddressStillValid =
    lanConfig.address !== null &&
    candidates.some((c) => c.address === lanConfig.address);

  const lanAddressSource = process.env.LAN_HOST
    ? 'LAN_HOST'
    : savedAddressStillValid
      ? LAN_HOST_CONFIG_PATH
      : null;
  const lanAddress =
    process.env.LAN_HOST ??
    (savedAddressStillValid ? lanConfig.address : pickLanAddress(interfaces));
  console.log(
    `Используется: ${lanAddress ?? 'localhost'}${
      lanAddressSource ? ` (из ${lanAddressSource})` : ''
    }. Выбрать другой можно в /admin, задать вручную — LAN_HOST=<ваш IP>.`,
  );

  const initialAvailablePacks = await listAvailablePacks(PACKS_DIR);

  // Битая или недоступная база не должна мешать серверу подняться — история
  // побочная функция, партия важнее её всегда (design.md,
  // 2026-08-20-game-history-design.md, «Отказы не ломают партию»).
  let history: GameHistory | undefined;
  try {
    history = new GameHistory(HISTORY_PATH);
  } catch (err) {
    console.error(
      `Не удалось открыть историю партий ${HISTORY_PATH}, играем без записи:`,
      err,
    );
  }

  const room = new Room(
    initial ?? undefined,
    pack,
    { candidates, address: lanAddress },
    basename(PACK_PATH),
    history,
  );
  room.refreshAvailablePacks(null, initialAvailablePacks);

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

  // Только явный выбор в /admin доходит сюда (Room.setLanAddress) — обычный
  // автовыбор при старте ничего не пишет, иначе файл переписывался бы на
  // каждом запуске без участия человека.
  room.onLanChange((address) => {
    if (address === null) return;
    writeLanHostAddress(LAN_HOST_CONFIG_PATH, address).catch((err: unknown) => {
      console.error(`Не удалось сохранить ${LAN_HOST_CONFIG_PATH}:`, err);
    });
  });

  const { httpServer } = createServer({
    room,
    clientDistPath: CLIENT_DIST_PATH,
    port: PORT,
    packsDir: PACKS_DIR,
    profilePath: PROFILE_PATH,
    // Та же самая база, что пишет Room, — но сервер видит её через узкий
    // интерфейс только на чтение.
    history,
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
    console.log(
      `Своя игра слушает на http://${lanAddress ?? 'localhost'}:${PORT}/`,
    );
  });
}

main().catch((err: unknown) => {
  console.error('Не удалось запустить сервер:', err);
  process.exitCode = 1;
});
