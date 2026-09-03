import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from 'node:http';
import { basename, join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import sirv from 'sirv';
import type { Room, RoomState } from './room.js';
import type {
  ClientMessage,
  ParticipantView,
  ServerMessage,
} from './protocol.js';
import {
  listAvailablePacks,
  updateQuestion,
  deleteQuestion,
  findQuestionLocation,
} from './packs.js';
import { loadPack } from './pack.js';
import type { Question } from './pack.js';
import {
  appendComplaint,
  rewriteAutoSection,
  type ComplaintEntry,
} from './generatorProfile.js';
import { TAG_REASONS } from './protocol.js';
import type { ProfileAggregateSource, PeopleAdmin } from './history.js';
import { parsePlayerCard, sameName } from './playerCard.js';
import {
  deletePlayerCard,
  readPlayerCard,
  readPlayerList,
  savePlayerCard,
  savePlayerStats,
} from './playersFile.js';

export interface CreateServerOptions {
  room: Room;
  clientDistPath: string;
  port: number;
  packsDir: string;
  // Опционально: нужен только для admin-report-question. Опционален, чтобы
  // не менять все существующие вызовы createServer в тестах, которым этот
  // путь не нужен вовсе — сервер без него просто не может принимать жалобы
  // (тихий no-op, см. handleReportQuestion).
  profilePath?: string;
  // Только чтение сводки и слияние профилей людей — записывать сыгранные
  // партии в историю может лишь Room (задача 4, sdd/2026-08-26-player-identity).
  history?: ProfileAggregateSource & PeopleAdmin;
  // docs/players.md — анкеты интересов (design.md, 2026-08-26).
  playersPath?: string;
}

export interface GameServer {
  httpServer: HttpServer;
  close(): Promise<void>;
}

/**
 * Как часто сервер пингует клиентов. Умерший сокет обнаруживается на втором
 * тике, то есть в худшем случае через два интервала.
 *
 * Зачем вообще: когда на телефоне падает Wi-Fi, радио просто перестаёт
 * отвечать — ни FIN, ни RST до сервера не доходит. Клиент видит `close`
 * мгновенно и начинает переподключаться, а сервер без пингов узнал бы о смерти
 * сокета только по таймауту TCP-ретрансмиссии, а это минуты. Всё это время
 * участник висел бы на табло как подключённый, и обещанное дизайном
 * «(отключён)» не появлялось бы вовсе.
 */
export const HEARTBEAT_INTERVAL_MS = 5000;

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function toParticipantView(state: RoomState): ParticipantView[] {
  return state.participants.map(({ id, name, connected }) => ({
    id,
    name,
    connected,
  }));
}

// Ловушка «Выбор локального IP на Windows» (svoya-igra-dev) — фолбэк на
// localhost, когда кандидатов вообще нет, а не пустая строка/null: с этим
// URL по-прежнему можно открыть игру локально, просто без LAN-доступа.
function lanUrlFor(address: string | null, port: number): string {
  return `http://${address ?? 'localhost'}:${port}/`;
}

export function createServer(options: CreateServerOptions): GameServer {
  const {
    room,
    clientDistPath,
    port,
    packsDir,
    profilePath,
    history,
    playersPath,
  } = options;
  const assets = sirv(clientDistPath, { single: true });
  // Раздаёт packsDir/media/... под префиксом /media/ — БЕЗ single:true:
  // отсутствующая картинка обязана дать настоящий 404, а не откат на
  // клиентский index.html (design.md, 2026-08-16, «Отказы»). Смонтирован
  // на packsDir/media (не на сам packsDir) — префикс /media/ снимается с
  // req.url перед вызовом, поэтому dir для sirv должен совпадать с тем,
  // что остаётся ПОСЛЕ снятия префикса.
  // dev: true — иначе sirv синхронно сканирует directory (readdirSync) уже
  // в момент создания и бросает ENOENT, если packsDir/media ещё не
  // существует (обычный случай — большинство паков без картинок вообще не
  // создают эту папку). С dev: true поиск файла ленивый, по одному
  // request'у (fs.existsSync), без скана каталога и без исключения при
  // старте — отсутствие результата по-прежнему уходит в наш собственный
  // 404-обработчик ниже, а не в SPA-фолбэк.
  const media = sirv(join(packsDir, 'media'), { dev: true });

  const httpServer = createHttpServer((req, res) => {
    if (req.url?.startsWith('/media/')) {
      req.url = req.url.slice('/media'.length);
      media(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
      return;
    }
    assets(req, res, () => {
      res.statusCode = 404;
      res.end('Not found');
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const connections = new Map<WebSocket, string>();
  // Tracks which socket currently "owns" each participant, so a stale
  // socket's 'close' event can't disconnect a participant who has already
  // reconnected on a different socket in the meantime.
  const owners = new Map<string, WebSocket>();

  // Не один общий payload на всех: `correctAnswer` на judging в режиме с
  // ведущим обязан дойти только до сокета ведущего (protocol.ts,
  // GameStateView.correctAnswer) — остальным, включая табло, строится
  // отдельное сообщение с viewerId = null/чужой id, и Room.toGameStateView
  // сама скрывает в нём ответ.
  const stateMessageFor = (viewerId: string | null): ServerMessage => {
    const lan = room.getLanInfo();
    const packInfo = room.getPackInfo();
    return {
      type: 'state',
      participants: toParticipantView(room.getState()),
      hostParticipantId: room.getState().hostParticipantId,
      game: room.toGameStateView(viewerId),
      people: room.getPeople(),
      lanUrl: lanUrlFor(lan.address, port),
      lanCandidates: lan.candidates,
      availablePacks: packInfo.available,
      activePackFilename: packInfo.activeFilename,
      // ВРЕМЕННО — см. Room.textRevealWordsPerSecond.
      textRevealWordsPerSecond: room.getTextRevealWordsPerSecond(),
      // ВРЕМЕННО — см. Room.textRevealEnabled.
      textRevealEnabled: room.getTextRevealEnabled(),
      // ВРЕМЕННО — см. Room.textRevealFadeMs.
      textRevealFadeMs: room.getTextRevealFadeMs(),
      historyEnabled: room.getHistoryEnabled(),
      historyRecording: room.isHistoryRecording(),
    };
  };

  const broadcastState = (): void => {
    // Deferred to a microtask so that a direct, synchronous reply to the
    // triggering client (e.g. the 'joined' confirmation sent right after
    // room.join()/room.reconnect() returns, later in the same 'message'
    // handler) is written to that client's socket before this broadcast
    // reaches it. room.join()/room.reconnect() call this synchronously as
    // part of their own execution, before the handler gets a chance to send
    // its direct reply; without the defer, the client would deterministically
    // see its own broadcasted 'state' before its 'joined' confirmation, since
    // both are written to the same TCP stream in that order.
    //
    // Why here and not elsewhere: reordering the handler to send 'joined'
    // before calling room.join() is impossible — the confirmation needs the
    // data join() produces. Deferring inside Room itself was rejected to keep
    // Room synchronous and free of transport-timing concerns (it doesn't know
    // about sockets or delivery order, and shouldn't have to). This defers
    // only the broadcast side, at the one place two writes to the same socket
    // actually interleave.
    queueMicrotask(() => {
      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          send(ws, stateMessageFor(connections.get(ws) ?? null));
        }
      }
    });
  };

  room.onChange(broadcastState);
  // Разбор идёт УЖЕ ПОСЛЕ game-end, поэтому одного этого пересчёта мало —
  // причины он не увидит (их ловит точка в обработчике tag-reason ниже, в
  // handleMessage). Нужен он ради чисел по ценам: они обновятся, даже если
  // разбирать никто ничего не станет.
  let previousPhase: string | null = null;
  room.onChange((state) => {
    const phase = state.game?.phase ?? null;
    if (phase === 'game-end' && previousPhase !== 'game-end') {
      void refreshAutoSection();
      void refreshPlayerStats();
    }
    previousPhase = phase;
  });
  room.onLanChange(broadcastState);
  room.onPackChange(broadcastState);
  // ВРЕМЕННО — см. Room.textRevealWordsPerSecond.
  room.onTextRevealRateChange(broadcastState);
  // ВРЕМЕННО — см. Room.textRevealEnabled.
  room.onTextRevealEnabledChange(broadcastState);
  // ВРЕМЕННО — см. Room.textRevealFadeMs.
  room.onTextRevealFadeChange(broadcastState);
  room.onHistoryEnabledChange(broadcastState);

  // `ws`, будучи прицепленным к готовому httpServer, переподписывает его
  // 'error' на себя. Без слушателя здесь EventEmitter на 'error' бросает
  // исключение — то есть даже обработанная ошибка httpServer (тот же
  // EADDRINUSE) всё равно ронял бы процесс сырым стеком, уже через wss.
  // Осмысленное сообщение печатает владелец порта (index.ts), тут только
  // не даём событию превратиться в исключение и оставляем след для диагностики.
  wss.on('error', (err) => {
    console.error('Ошибка WebSocket-сервера:', err);
  });

  // Сокеты, ответившие на последний пинг (или только что подключившиеся).
  // WeakSet, чтобы закрытые сокеты не удерживались в памяти.
  const alive = new WeakSet<WebSocket>();

  // Сериализует конкурентные записи в один и тот же файл между собой — общий
  // паттерн для обоих ресурсов, которые сервер пишет: файлы пакетов
  // (updateQuestion/deleteQuestion) и profile.md (appendComplaint и
  // rewriteAutoSection — двое писателей с появлением пересчёта
  // «Автособранного», design.md, 2026-08-25). Без
  // этого два запроса подряд читают файл до того, как предыдущий успел его
  // перезаписать, и один результат теряет правку другого (см. комментарий у
  // исходного withPackWriteLock, Веха A) — тот же баг возможен и для
  // profile.md, только там вместо потерянной правки вопроса теряется вся
  // жалоба целиком. .catch(() => {}) на очереди — не глотает ошибку
  // вызывающего (та уже ушла через результат withLock), а не даёт
  // отклонённому промису прервать очередь для последующих операций.
  function createWriteLock(): <T>(fn: () => Promise<T>) => Promise<T> {
    let queue: Promise<unknown> = Promise.resolve();
    return function withLock<T>(fn: () => Promise<T>): Promise<T> {
      const result = queue.then(fn, fn);
      queue = result.catch(() => {});
      return result;
    };
  }
  const withPackWriteLock = createWriteLock();
  const withProfileWriteLock = createWriteLock();
  // Анкеты игроков живут в своём файле (docs/players.md) — сериализовать
  // его запись с профилем генератора незачем, файлы разные. Этот же замок
  // держит и savePlayerCard (admin-save-player), и savePlayerStats
  // (refreshPlayerStats ниже) — оба пишут в один и тот же players.md, и без
  // общего замка партия, дошедшая до game-end одновременно с сохранением
  // анкеты, теряла бы одну из двух правок тем же способом, каким это уже
  // объяснено у withPackWriteLock.
  const withPlayersWriteLock = createWriteLock();

  // Пересчёт раздела «Автособранное» (design.md, 2026-08-25). Ошибки
  // проглатываются с записью в лог по тому же правилу, что и остальная
  // работа с профилем: партия важнее файла для генератора.
  async function refreshAutoSection(): Promise<void> {
    if (!profilePath || !history) return;
    try {
      const aggregate = history.profileAggregate();
      await withProfileWriteLock(() =>
        rewriteAutoSection(profilePath, aggregate),
      );
    } catch (err) {
      console.error('Не удалось пересчитать «Автособранное» в профиле:', err);
    }
  }

  // Пересчёт раздела «Показывает в игре» (design.md, 2026-08-26-player-identity,
  // задача 5). Две точки вызова: game-end (вместе с refreshAutoSection) и
  // слияние профилей в admin-merge-people ниже — после слияния числа обязаны
  // сойтись сразу, ведущий ради этого его и делает.
  //
  // А вот на разбор причины, в отличие от «Автособранного», пересчитывать
  // смысла нет: playerStats() строится из game_people и played_questions, до
  // которых оценкам (question_tags) дела нет — эти числа на них не меняются.
  async function refreshPlayerStats(): Promise<void> {
    if (!playersPath || !history) return;
    try {
      const stats = history.playerStats();
      await withPlayersWriteLock(() => savePlayerStats(playersPath, stats));
    } catch (err) {
      console.error(
        'Не удалось пересчитать «Показывает в игре» в анкетах:',
        err,
      );
    }
  }

  // Сборка записи жалобы для handleReportQuestion — единственного
  // вызывающего: кнопки «Пожаловаться» в редакторе пакетов. Разбор в конце
  // партии сюда не заходит (финальное ревью ветки, п. 4) — его оценки
  // попадают в файл через refreshAutoSection выше, из истории, а не из
  // текущего содержимого файла пакета.
  async function buildComplaintEntry(
    filename: string,
    questionId: string,
    complaint: string,
  ): Promise<ComplaintEntry> {
    const pack = await loadPack(join(packsDir, filename));
    const location = findQuestionLocation(pack, questionId);
    if (!location) {
      throw new Error(`вопрос с id "${questionId}" не найден в пакете`);
    }
    return {
      date: new Date().toISOString().slice(0, 10),
      packFilename: filename,
      packTitle: pack.title,
      themeName: location.themeName,
      price: location.question.price,
      questionText: location.question.text,
      answer: location.question.answer,
      complaint,
    };
  }

  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));

    send(ws, stateMessageFor(connections.get(ws) ?? null));

    ws.on('message', (data) => {
      void handleMessage(data);
    });

    async function handleMessage(data: WebSocket.RawData): Promise<void> {
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }

      if (message.type === 'join' && typeof message.name === 'string') {
        const result = room.join(message.name);
        if ('error' in result) {
          send(ws, { type: 'name-taken' });
          return;
        }
        connections.set(ws, result.participant.id);
        owners.set(result.participant.id, ws);
        send(ws, {
          type: 'joined',
          participantId: result.participant.id,
          token: result.participant.token,
          name: result.participant.name,
        });
      }

      if (message.type === 'join-as' && typeof message.personId === 'number') {
        const result = room.joinAsPerson(message.personId);
        if ('error' in result) {
          send(ws, { type: result.error });
          return;
        }
        connections.set(ws, result.participant.id);
        owners.set(result.participant.id, ws);
        send(ws, {
          type: 'joined',
          participantId: result.participant.id,
          token: result.participant.token,
          name: result.participant.name,
        });
      }

      if (message.type === 'reconnect' && typeof message.token === 'string') {
        const result = room.reconnect(message.token);
        if ('error' in result) {
          send(ws, { type: 'invalid-token' });
          return;
        }
        connections.set(ws, result.participant.id);
        owners.set(result.participant.id, ws);
        send(ws, {
          type: 'joined',
          participantId: result.participant.id,
          token: result.participant.token,
          name: result.participant.name,
        });
      }

      if (message.type === 'start-game') {
        const participantId = connections.get(ws);
        if (participantId) {
          const result = room.startGame(participantId);
          if ('error' in result) {
            send(ws, { type: 'start-game-error', reason: result.error });
          }
        }
      }

      if (message.type === 'reset-game') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.resetGame(participantId);
        }
      }

      if (message.type === 'toggle-host') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.toggleHost(participantId);
        }
      }

      if (message.type === 'select-question') {
        const participantId = connections.get(ws);
        if (
          participantId &&
          typeof message.themeIndex === 'number' &&
          typeof message.questionId === 'string'
        ) {
          const result = room.selectQuestion(
            participantId,
            message.themeIndex,
            message.questionId,
          );
          if ('error' in result) {
            send(ws, { type: 'select-question-error', reason: result.error });
          }
        }
      }

      if (message.type === 'place-bid' && typeof message.amount === 'number') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.placeBid(participantId, message.amount);
        }
      }

      if (message.type === 'pass-bid') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.passBid(participantId);
        }
      }

      if (
        message.type === 'assign-cat' &&
        typeof message.recipientParticipantId === 'string'
      ) {
        const participantId = connections.get(ws);
        if (participantId) {
          room.assignCat(participantId, message.recipientParticipantId);
        }
      }

      if (message.type === 'buzz') {
        const participantId = connections.get(ws);
        if (participantId && room.buzz(participantId) === 'falsestart') {
          send(ws, { type: 'falsestart' });
        }
      }

      if (message.type === 'said-answer') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.saidAnswer(participantId);
        }
      }

      if (message.type === 'vote') {
        const participantId = connections.get(ws);
        if (participantId && typeof message.correct === 'boolean') {
          room.vote(participantId, message.correct);
        }
      }

      if (
        message.type === 'tag-question' &&
        (message.thumb === 'up' || message.thumb === 'down')
      ) {
        const participantId = connections.get(ws);
        if (participantId) {
          room.tagQuestion(participantId, message.thumb);
        }
      }

      if (
        message.type === 'tag-reason' &&
        typeof message.questionId === 'string' &&
        (message.reason === null ||
          (TAG_REASONS as readonly string[]).includes(message.reason)) &&
        typeof message.text === 'string'
      ) {
        const participantId = connections.get(ws);
        if (participantId) {
          // room.submitTagReason сама проверяет фазу game-end и что
          // participantId реально ставил палец вниз по этому questionId, ещё
          // не разобранному — в базу уходит только реально существовавшая,
          // ещё не записанная оценка, а не любой присланный клиентом id
          // (ревью задачи 4, Important 1) и не повторная отправка той же
          // оценки (финальное ревью ветки, п. 3: WHERE-условие
          // recordTagReason теперь includes reason IS NULL AND reason_text
          // IS NULL).
          const recorded = room.submitTagReason(
            participantId,
            message.questionId,
            message.reason,
            message.text,
          );
          // recorded === true означает, что оценка реально записалась в базу
          // (гейт — возврат recordTagReason, финальное ревью ветки, п. 2) —
          // только тогда есть что пересчитывать. Дописывания буллета в
          // «Жалобы и оценки игроков» здесь больше нет: то же самое теперь
          // приходит пересчётом, в схлопнутом виде (design.md, 2026-08-25).
          if (recorded) await refreshAutoSection();
        }
      }

      if (message.type === 'adjust-score') {
        const participantId = connections.get(ws);
        if (
          participantId &&
          typeof message.participantId === 'string' &&
          typeof message.delta === 'number'
        ) {
          room.adjustScore(participantId, message.participantId, message.delta);
        }
      }

      if (message.type === 'cancel-question') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.cancelQuestion(participantId);
        }
      }

      if (message.type === 'eliminate-final-theme') {
        const participantId = connections.get(ws);
        if (participantId && typeof message.themeIndex === 'number') {
          room.eliminateFinalTheme(participantId, message.themeIndex);
        }
      }

      if (message.type === 'submit-wager') {
        const participantId = connections.get(ws);
        if (participantId && typeof message.amount === 'number') {
          room.submitWager(participantId, message.amount);
        }
      }

      if (message.type === 'submit-final-answer') {
        const participantId = connections.get(ws);
        if (participantId && typeof message.text === 'string') {
          room.submitFinalAnswer(participantId, message.text);
        }
      }

      if (message.type === 'final-vote') {
        const participantId = connections.get(ws);
        if (
          participantId &&
          typeof message.participantId === 'string' &&
          typeof message.correct === 'boolean'
        ) {
          room.finalVote(participantId, message.participantId, message.correct);
        }
      }

      // Табло тоже не делает 'join', поэтому сигнал об окончании клипа, как
      // и админские сообщения ниже, не ищет отправителя в connections.
      if (
        message.type === 'media-finished' &&
        typeof message.questionId === 'string'
      ) {
        room.mediaFinished(message.questionId);
      }

      // Админ-панель (design.md, «Админ-панель») — сокет админки никогда не
      // шлёт 'join', поэтому в отличие от всего выше эти сообщения не ищут
      // отправителя в connections: авторизация не по личности отправителя,
      // а по самому факту, что сообщение админского типа.
      if (message.type === 'admin-start-game') {
        const result = room.startGame(null);
        if ('error' in result) {
          send(ws, { type: 'start-game-error', reason: result.error });
        }
      }

      if (message.type === 'admin-reset-game') {
        room.resetGame(null);
      }

      if (message.type === 'admin-reset-room') {
        room.resetRoom();
      }

      if (
        message.type === 'admin-kick' &&
        typeof message.participantId === 'string'
      ) {
        room.kickParticipant(message.participantId);
        // Кикнутый мог быть подключён прямо сейчас — рвём его сокет, чтобы
        // клиент увидел invalid-token и вернулся на экран входа, а не завис
        // с мёртвым participantId. Штатный обработчик 'close' ниже сам
        // разберётся с owners/connections для этого сокета.
        const ownerWs = owners.get(message.participantId);
        if (ownerWs) {
          ownerWs.terminate();
        }
      }

      if (
        message.type === 'admin-set-host' &&
        (message.participantId === null ||
          typeof message.participantId === 'string')
      ) {
        room.setHost(message.participantId);
      }

      // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в engine.ts.
      if (message.type === 'admin-skip-to-final') {
        room.skipToFinal();
      }

      if (message.type === 'admin-cancel-question') {
        room.cancelQuestion(null);
      }

      if (
        message.type === 'admin-set-lan-address' &&
        typeof message.address === 'string'
      ) {
        room.setLanAddress(message.address);
      }

      // ВРЕМЕННО — см. Room.textRevealWordsPerSecond.
      if (
        message.type === 'admin-set-text-reveal-rate' &&
        typeof message.wordsPerSecond === 'number'
      ) {
        room.setTextRevealWordsPerSecond(message.wordsPerSecond);
      }

      // ВРЕМЕННО — см. Room.textRevealEnabled.
      if (
        message.type === 'admin-set-text-reveal-enabled' &&
        typeof message.enabled === 'boolean'
      ) {
        room.setTextRevealEnabled(message.enabled);
      }

      // ВРЕМЕННО — см. Room.textRevealFadeMs.
      if (
        message.type === 'admin-set-text-reveal-fade-ms' &&
        typeof message.fadeMs === 'number'
      ) {
        room.setTextRevealFadeMs(message.fadeMs);
      }

      if (
        message.type === 'admin-set-history-enabled' &&
        typeof message.enabled === 'boolean'
      ) {
        room.setHistoryEnabled(message.enabled);
      }

      if (message.type === 'refresh-packs') {
        const participantId = connections.get(ws);
        if (participantId) {
          const packs = await listAvailablePacks(packsDir);
          room.refreshAvailablePacks(participantId, packs);
        }
      }

      if (message.type === 'admin-refresh-packs') {
        const packs = await listAvailablePacks(packsDir);
        room.refreshAvailablePacks(null, packs);
      }

      if (
        message.type === 'select-pack' &&
        typeof message.filename === 'string'
      ) {
        const participantId = connections.get(ws);
        if (participantId) {
          await handleSelectPack(participantId, message.filename);
        }
      }

      if (
        message.type === 'admin-select-pack' &&
        typeof message.filename === 'string'
      ) {
        await handleSelectPack(null, message.filename);
      }

      if (
        message.type === 'admin-get-pack' &&
        typeof message.filename === 'string'
      ) {
        await handleGetPack(message.filename);
      }

      if (
        message.type === 'admin-update-question' &&
        typeof message.filename === 'string' &&
        typeof message.questionId === 'string' &&
        typeof message.price === 'number' &&
        typeof message.text === 'string' &&
        typeof message.answer === 'string' &&
        (message.comment === undefined ||
          typeof message.comment === 'string') &&
        typeof message.questionType === 'string'
      ) {
        await handleUpdateQuestion(message.filename, message.questionId, {
          price: message.price,
          text: message.text,
          answer: message.answer,
          comment: message.comment,
          questionType: message.questionType as Question['type'],
        });
      }

      if (
        message.type === 'admin-delete-question' &&
        typeof message.filename === 'string' &&
        typeof message.questionId === 'string'
      ) {
        await handleDeleteQuestion(message.filename, message.questionId);
      }

      if (
        message.type === 'admin-report-question' &&
        typeof message.filename === 'string' &&
        typeof message.questionId === 'string' &&
        typeof message.complaint === 'string'
      ) {
        await handleReportQuestion(
          message.filename,
          message.questionId,
          message.complaint,
        );
      }

      if (message.type === 'admin-get-players') {
        if (!playersPath) return;
        send(ws, {
          type: 'admin-players',
          players: await readPlayerList(playersPath),
        });
      }

      if (
        message.type === 'admin-save-player' &&
        typeof message.code === 'string' &&
        typeof message.replace === 'boolean'
      ) {
        await handleSavePlayer(
          message.code,
          message.replace,
          typeof message.originalName === 'string'
            ? message.originalName
            : undefined,
        );
      }

      if (
        message.type === 'admin-get-player' &&
        typeof message.name === 'string'
      ) {
        await handleGetPlayer(message.name);
      }

      if (
        message.type === 'admin-delete-player-card' &&
        typeof message.name === 'string'
      ) {
        await handleDeletePlayerCard(message.name);
      }

      if (
        message.type === 'admin-merge-people' &&
        typeof message.fromId === 'number' &&
        typeof message.intoId === 'number'
      ) {
        if (!history) return;
        // Пока партия идёт, человек связан с участником и счётчиком за
        // столом; перепривязка под ногами у идущей игры — класс ошибок,
        // которого проще не заводить (design.md, «Слияние профилей»).
        if (room.hasActiveGame()) {
          send(ws, {
            type: 'admin-people-error',
            reason: 'нельзя сливать игроков, пока идёт партия',
          });
          return;
        }
        if (message.fromId === message.intoId) {
          send(ws, {
            type: 'admin-people-error',
            reason: 'не удалось слить — выбраны один и тот же игрок?',
          });
          return;
        }
        // Проверяем существование ДО вызова mergePeople и отдельно от
        // совпадения id выше — причина отказа обязана быть честной (ревью
        // задачи 4, Important 1). Если кого-то из двоих уже слили с другого
        // устройства между тем, как ведущий открыл диалог, и тем, как
        // подтвердил его, mergePeople(fromId, intoId) тоже вернёт false —
        // но «выбран один и тот же игрок» тут была бы неправдой: ведущий
        // только что видел в диалоге два разных имени.
        const existingIds = new Set(history.listPeople().map((p) => p.id));
        if (
          !existingIds.has(message.fromId) ||
          !existingIds.has(message.intoId)
        ) {
          send(ws, {
            type: 'admin-people-error',
            reason: 'такого игрока уже нет — обнови список',
          });
          return;
        }
        const merged = history.mergePeople(message.fromId, message.intoId);
        if (!merged) {
          // Существование и несовпадение id уже проверены выше — сюда
          // попадает только настоящий сбой mergePeople (ошибка БД).
          send(ws, {
            type: 'admin-people-error',
            reason: 'не удалось слить — попробуй ещё раз',
          });
          return;
        }
        // Перепривязываем живых участников комнаты со слитого fromId на
        // intoId (финальное ревью ветки, п. 2, Important, часть б) — иначе
        // участник, оставшийся в лобби со старым personId, сломает следующий
        // startGame() и позволит второму телефону войти тем же человеком
        // через joinAsPerson (room.ts, reassignPerson).
        room.reassignPerson(message.fromId, message.intoId);
        // Пересчитываем «Показывает в игре» сразу после слияния (финальное
        // ревью ветки, п. 3, Important) — иначе ведущий сливает профили
        // именно затем, чтобы числа сошлись, а файл до конца следующей
        // партии продолжает показывать два раздела со старыми числами,
        // один из которых принадлежит уже удалённому человеку.
        void refreshPlayerStats();
        // Список уже едет в обычном состоянии комнаты (stateMessageFor
        // кладёт room.getPeople() → history.listPeople()) —
        // broadcastState() разносит свежий список всем: другим открытым
        // админкам и, важнее, лобби на телефонах игроков, где список виден
        // для входа «я — вот этот из списка» (ревью задачи 4, Important 2).
        broadcastState();
        send(ws, { type: 'admin-people', people: history.listPeople() });
      }

      if (
        message.type === 'admin-forget-person' &&
        typeof message.id === 'number'
      ) {
        if (!history) return;
        // Дословно та же причина, что у слияния: человек за столом связан с
        // участником и счётчиком, и трогать эту связь под ногами у идущей партии —
        // класс ошибок, которого проще не заводить.
        if (room.hasActiveGame()) {
          send(ws, {
            type: 'admin-people-error',
            reason: 'нельзя удалять человека, пока идёт партия',
          });
          return;
        }
        if (!history.forgetPerson(message.id)) {
          // forgetPerson возвращает false и когда человека уже нет (его убрали с
          // другого устройства, пока ведущий смотрел на список), и при сбое базы.
          // Для ведущего ответ один и тот же: список у него устарел.
          send(ws, {
            type: 'admin-people-error',
            reason: 'такого игрока уже нет — обнови список',
          });
          return;
        }
        // Пересчёт «Показывает в игре» сразу, а не после следующей партии, — иначе
        // имя удалённого осталось бы в файле. В отличие от слияния его здесь ждём:
        // ведущий открывает файл сразу после удаления, и порядок «ответ ушёл, файл
        // ещё старый» видно глазами.
        await refreshPlayerStats();
        // Список людей едет и в обычном состоянии комнаты: лобби на телефонах
        // показывает его для входа «я — вот этот из списка» (та же причина, по
        // которой broadcastState стоит в слиянии).
        broadcastState();
        send(ws, { type: 'admin-people', people: history.listPeople() });
      }

      // Сырые сообщения Node (ENOENT: ... open 'C:\...\packs\ghost.json') не
      // годятся для отправки в админку — они на английском и раскрывают
      // абсолютный путь на диске сервера. Ошибки validatePack/updateQuestion/
      // deleteQuestion, наоборот, уже человекочитаемые по-русски и должны
      // доходить как есть — от файловых их отличает код ENOENT, которого у
      // тех ошибок нет.
      function adminPackErrorReason(err: unknown): string {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return 'файл не найден';
        }
        return (err as Error).message;
      }

      // Тот же приём, что у handleSelectPack: легитимный клиент никогда сам
      // не конструирует filename — эхом отправляет то, что уже видел в
      // availablePacks. Значение, не прошедшее эту проверку, может прийти
      // только от нестандартного отправителя — тихий no-op.
      async function handleGetPack(filename: string): Promise<void> {
        if (basename(filename) !== filename) return;
        try {
          const pack = await loadPack(join(packsDir, filename));
          send(ws, { type: 'admin-pack', filename, pack });
        } catch (err) {
          send(ws, {
            type: 'admin-pack-error',
            filename,
            reason: adminPackErrorReason(err),
          });
        }
      }

      async function handleUpdateQuestion(
        filename: string,
        questionId: string,
        fields: {
          price: number;
          text: string;
          answer: string;
          comment?: string;
          questionType: Question['type'];
        },
      ): Promise<void> {
        if (basename(filename) !== filename) return;
        try {
          const pack = await withPackWriteLock(() =>
            updateQuestion(packsDir, filename, questionId, fields),
          );
          send(ws, { type: 'admin-pack', filename, pack });
        } catch (err) {
          send(ws, {
            type: 'admin-pack-error',
            filename,
            reason: adminPackErrorReason(err),
          });
        }
      }

      async function handleDeleteQuestion(
        filename: string,
        questionId: string,
      ): Promise<void> {
        if (basename(filename) !== filename) return;
        try {
          const pack = await withPackWriteLock(() =>
            deleteQuestion(packsDir, filename, questionId),
          );
          send(ws, { type: 'admin-pack', filename, pack });
        } catch (err) {
          send(ws, {
            type: 'admin-pack-error',
            filename,
            reason: adminPackErrorReason(err),
          });
        }
      }

      async function handleReportQuestion(
        filename: string,
        questionId: string,
        complaint: string,
      ): Promise<void> {
        if (basename(filename) !== filename) return;
        if (!profilePath) return;
        // Fix 7 (финальное ревью) — две разные операции могут провалиться
        // здесь (поиск пакета/вопроса vs. запись жалобы в профиль), и общий
        // catch на весь метод стирал это различие: ENOENT от appendComplaint
        // (файл профиля пропал/переехал) и ENOENT от loadPack (пакет
        // пропал/переехал) оба превращались в одинаковое «файл не найден» —
        // не видно, какой из двух файлов имелся в виду. Два отдельных
        // try/catch держат сообщения однозначными.
        let entry: ComplaintEntry;
        try {
          entry = await buildComplaintEntry(filename, questionId, complaint);
        } catch (err) {
          send(ws, {
            type: 'admin-report-error',
            filename,
            questionId,
            reason: adminPackErrorReason(err),
          });
          return;
        }
        try {
          await withProfileWriteLock(() => appendComplaint(profilePath, entry));
          send(ws, { type: 'admin-report-ack', filename, questionId });
        } catch (err) {
          send(ws, {
            type: 'admin-report-error',
            filename,
            questionId,
            reason:
              (err as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'не удалось сохранить жалобу — файл профиля не найден'
                : adminPackErrorReason(err),
          });
        }
      }

      // Анкеты интересов игроков (design.md, 2026-08-26). Проверка «такой
      // уже есть» и сама запись идут ВНУТРИ одной блокировки: между ними
      // файл меняться не должен, иначе два подтверждения замены подряд
      // затрут друг друга.
      async function handleSavePlayer(
        code: string,
        replace: boolean,
        originalName?: string,
      ): Promise<void> {
        if (!playersPath) return;
        const parsed = parsePlayerCard(code);
        if (!parsed.ok) {
          send(ws, { type: 'admin-player-error', reason: parsed.reason });
          return;
        }
        try {
          // Правка своей же анкеты — не конфликт: раздел с этим именем и
          // есть тот, который правят. Спрашивать про замену тут значило бы
          // требовать подтверждения у человека, который только что нажал
          // «Редактировать» именно на нём.
          const editingSelf =
            originalName !== undefined &&
            sameName(originalName, parsed.card.name);
          const conflict = await withPlayersWriteLock(async () => {
            const existing = await readPlayerList(playersPath);
            const same = existing.find((player) =>
              sameName(player.name, parsed.card.name),
            );
            if (same && !replace && !editingSelf) return same.name;
            await savePlayerCard(
              playersPath,
              parsed.card,
              new Date().toISOString().slice(0, 10),
              // При переименовании пометки ищутся под старым именем: раздел
              // под новым либо чужой, либо его ещё нет.
              originalName ?? parsed.card.name,
            );
            // Переименование: новый раздел уже записан, старый убирается
            // здесь же, под тем же замком. Иначе между записью и удалением
            // в файле лежали бы два раздела одного человека, и партия,
            // дошедшая до game-end в этот момент, увидела бы их оба.
            if (originalName !== undefined && !editingSelf) {
              await deletePlayerCard(playersPath, originalName);
            }
            return null;
          });
          if (conflict !== null) {
            send(ws, { type: 'admin-player-exists', name: conflict });
            return;
          }
          send(ws, {
            type: 'admin-players',
            players: await readPlayerList(playersPath),
          });
        } catch (err) {
          send(ws, {
            type: 'admin-player-error',
            reason:
              (err as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'файл анкет не найден'
                : 'не удалось сохранить анкету',
          });
        }
      }

      // Анкета для формы правки. Отсутствие раздела — не ошибка сервера, а
      // устаревший список у ведущего: анкету могли удалить с другого
      // устройства, пока он смотрел на экран.
      async function handleGetPlayer(name: string): Promise<void> {
        if (!playersPath) return;
        const found = await readPlayerCard(playersPath, name);
        if (!found) {
          send(ws, {
            type: 'admin-player-error',
            reason: 'такой анкеты уже нет — обнови список',
          });
          return;
        }
        send(ws, {
          type: 'admin-player',
          card: found.card,
          extraLines: found.extraLines,
        });
      }

      async function handleDeletePlayerCard(name: string): Promise<void> {
        if (!playersPath) return;
        // Проверки «идёт ли партия» здесь нет намеренно: удаление анкеты, как и её
        // правка, трогает файл, а не состояние игры. С партией связан человек в
        // истории — его убирает admin-forget-person, и вот там запрет на месте.
        try {
          await withPlayersWriteLock(() => deletePlayerCard(playersPath, name));
          send(ws, {
            type: 'admin-players',
            players: await readPlayerList(playersPath),
          });
        } catch (err) {
          send(ws, {
            type: 'admin-player-error',
            reason:
              (err as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'файл анкет не найден'
                : 'не удалось удалить анкету',
          });
        }
      }

      async function handleSelectPack(
        requesterId: string | null,
        filename: string,
      ): Promise<void> {
        if (basename(filename) !== filename) {
          // Легитимный клиент никогда сам не конструирует filename — он лишь
          // эхом отправляет значение из серверного availablePacks. Значение,
          // не прошедшее эту проверку, может прийти только от нестандартного
          // отправителя — тихий no-op, как при not-host (см. Task 3).
          return;
        }
        let pack;
        try {
          pack = await loadPack(join(packsDir, filename));
        } catch {
          send(ws, { type: 'select-pack-error', reason: 'unknown-file' });
          return;
        }
        const result = room.selectPack(requesterId, filename, pack);
        if ('error' in result && result.error === 'unknown-file') {
          send(ws, { type: 'select-pack-error', reason: 'unknown-file' });
        }
        // result.error === 'not-host' — тихий no-op, без ответа (см. Task 3).
      }
    }

    ws.on('error', (err) => {
      console.error('Ошибка WebSocket-соединения:', err);
    });

    ws.on('close', () => {
      const participantId = connections.get(ws);
      connections.delete(ws);
      if (participantId && owners.get(participantId) === ws) {
        owners.delete(participantId);
        room.disconnect(participantId);
      }
    });
  });

  // Стандартный для `ws` хартбит: на каждом тике добиваем тех, кто не ответил
  // на пинг предыдущего тика, остальных помечаем «не ответившими» и пингуем.
  // `terminate()` рвёт сокет и вызывает штатный обработчик 'close' — то есть
  // участник помечается отключённым тем же путём (через защиту `owners`),
  // что и при обычном закрытии вкладки.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Unref'd so this interval alone can't keep the event loop alive. On a
  // successful start the listening httpServer (and any open WS connections)
  // already hold their own refs, so the process still stays up normally.
  // The reason this matters: when httpServer.listen() fails (e.g. EADDRINUSE
  // in index.ts), createServer() has already run and this interval is
  // ticking, but close() — the only thing that clearInterval()s it — never
  // gets called, because the caller never got a server to close. A ref'd
  // timer in that state keeps the process running forever despite
  // process.exitCode being set, which is exactly the busy-port hang this
  // fixes.
  heartbeat.unref();

  return {
    httpServer,
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(heartbeat);
        wss.close();
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
