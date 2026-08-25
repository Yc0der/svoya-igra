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
import { appendComplaint, type ComplaintEntry } from './generatorProfile.js';
import { TAG_REASONS } from './protocol.js';
import type { TagComplaintContext } from './history.js';

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
  const { room, clientDistPath, port, packsDir, profilePath } = options;
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
  // (updateQuestion/deleteQuestion) и profile.md (appendComplaint). Без
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

  // Общая сборка записи жалобы: используется и кнопкой «Пожаловаться» в
  // редакторе пакетов, и разбором в конце партии — материал у них
  // одинаковый (вопрос, ответ, тема, цена), различается только текст
  // претензии и то, кому отвечать об успехе.
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

  // Палец вниз БЕЗ причины в профиль не идёт: «кому-то не понравилось,
  // неизвестно чем» — генератору нечего с этим делать (design.md,
  // 2026-08-21-question-tags-design.md, «Куда уходит собранное»). Такая
  // оценка остаётся в базе цифрой и дождётся агрегации слайса B.
  //
  // context приходит от room.submitTagReason() — это вопрос ТОЙ ПАРТИИ, В
  // КОТОРОЙ ЕГО РЕАЛЬНО ИГРАЛИ (history.complaintContext), а не текущий
  // активный пакет: до этой правки жалоба собиралась через
  // room.getPackInfo().activeFilename и loadPack(), а на game-end ведущий
  // волен уже переключить пакет к следующей партии, пока остальные ещё
  // дописывают разбор — questionId искался бы в чужом пакете (финальное
  // ревью ветки, п. 2).
  async function appendTagReasonToProfile(
    context: TagComplaintContext,
    reason: string | null,
    text: string,
  ): Promise<void> {
    if (!profilePath) return;
    const trimmed = text.trim();
    if (reason === null && trimmed === '') return;
    const complaint =
      reason === null
        ? `оценка игрока после партии: ${trimmed}`
        : trimmed === ''
          ? `${reason.toLowerCase()} (оценка игрока после партии)`
          : `${reason.toLowerCase()} (оценка игрока после партии): ${trimmed}`;
    const entry: ComplaintEntry = {
      date: new Date().toISOString().slice(0, 10),
      packFilename: context.packFilename,
      packTitle: context.packTitle,
      themeName: context.themeName,
      price: context.price,
      questionText: context.text,
      answer: context.answer,
      complaint,
    };
    try {
      await withProfileWriteLock(() => appendComplaint(profilePath, entry));
    } catch (err) {
      // Проглатываем: партия уже кончилась, показывать игроку ошибку
      // записи в файл профиля бессмысленно, а ронять сервер из-за неё
      // тем более. Цифра в базе при этом уже сохранена.
      console.error('Не удалось дописать оценку в профиль генератора:', err);
    }
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
          // не разобранному — в профиль генератора уходит только реально
          // существовавшая, ещё не записанная оценка, а не любой присланный
          // клиентом id (ревью задачи 4, Important 1: устаревший/подложный
          // questionId раньше долетал до appendTagReasonToProfile
          // безусловно) и не повторная отправка той же оценки (финальное
          // ревью ветки, п. 3: WHERE-условие recordTagReason теперь includes
          // reason IS NULL AND reason_text IS NULL). Возвращённый контекст —
          // вопрос той партии, в которой его реально играли, а не текущий
          // активный пакет (финальное ревью ветки, п. 2).
          const context = room.submitTagReason(
            participantId,
            message.questionId,
            message.reason,
            message.text,
          );
          if (context) {
            await appendTagReasonToProfile(
              context,
              message.reason,
              message.text,
            );
          }
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
