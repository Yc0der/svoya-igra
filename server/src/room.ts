// server/src/room.ts
import { randomUUID } from 'node:crypto';
import {
  createInitialState,
  reduce,
  findQuestion,
  QUESTION_TIMER_MS,
  MEDIA_TIMER_MS,
  TEXT_REVEAL_FALLBACK_MS,
  TEXT_REVEAL_MIN_MS,
  CAT_HANDOFF_TIMER_MS,
  AUCTION_BID_TIMER_MS,
  SAID_ANSWER_TIMER_MS,
  VOTE_TIMER_MS,
  REVEAL_TIMER_MS,
  ROUND_END_TIMER_MS,
  FINAL_ELIM_TIMER_MS,
  FINAL_WAGER_TIMER_MS,
  FINAL_ANSWER_TIMER_MS,
  FINAL_JUDGING_TIMER_MS,
  FINAL_REVEAL_TIMER_MS,
  type EngineState,
  type EngineEvent,
  type Effect,
  type Phase,
  type TimerName,
} from './engine.js';
import type { Pack } from './pack.js';
import type { GameStateView } from './protocol.js';
import type { LanCandidate } from './network.js';
import type { PackSummary } from './packs.js';
import type { HistoryRecorder, PlayedQuestionInput, Thumb } from './history.js';

export interface Participant {
  id: string;
  name: string;
  token: string;
  connected: boolean;
}

export interface RoomState {
  participants: Participant[];
  game: EngineState | null;
  // Кто отмечен ведущим в лобби. Не counterId — ведущий не входит в scores
  // (design.md, «Ведущий»). Живёт на Room, а не в EngineState, потому что
  // это выбирается ДО того, как EngineState вообще существует; при
  // startGame() копируется в EngineState.hostId и на время партии больше не
  // меняется (см. toggleHost()).
  hostParticipantId: string | null;
  // Id строки этой партии в истории (history.ts). Часть RoomState, а не
  // эфемерное поле, именно потому, что снапшот переживает перезапуск
  // сервера: без этого после перезапуска посреди партии в базе появилась бы
  // ВТОРАЯ строка games для той же самой партии. null означает «эта партия
  // не пишется» — в том числе для снапшотов, записанных до появления фичи.
  historyGameId: number | null;
}

// Не часть RoomState/снапшота: кандидаты — это факт текущего окружения
// (сетевые адаптеры этого запуска процесса), а не игровое состояние, и
// пересчитывать их из старого снапшота после перезапуска было бы неверно —
// адаптеры могли уже поменяться. Только выбранный address переживает
// перезапуск, и то через отдельный файл (lan-host.ts), не через снапшот.
export interface LanInfo {
  candidates: LanCandidate[];
  address: string | null;
}

// Тот же принцип, что и LanInfo выше: список пакетов на диске и текущий
// выбор — факт окружения, не игровое состояние, не часть RoomState/снапшота.
export interface PackInfo {
  available: PackSummary[];
  activeFilename: string | null;
}

export type JoinResult = { participant: Participant } | { error: 'name-taken' };
export type ReconnectResult =
  { participant: Participant } | { error: 'invalid-token' };
export type StartGameResult =
  | { ok: true }
  | {
      error:
        | 'not-enough-players'
        | 'no-pack'
        | 'game-in-progress'
        | 'host-required'
        | 'host-only';
    };
export type SelectQuestionResult = { ok: true } | { error: 'no-recipient' };

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// При восстановлении из снапшота настоящий setTimeout процесса, который
// раньше двигал игру дальше, потерян вместе со старым процессом — движок сам
// об этом не знает, потому что он не знает о часах вообще. Комната обязана
// перезавести таймер, соответствующий восстановленной фазе, иначе игра
// зависнет в этой фазе навсегда. `selecting` — единственная фаза без
// таймера (спека не ограничивает время на выбор вопроса).
const PHASE_TIMER: Partial<Record<Phase, { timer: TimerName; ms: number }>> = {
  'question-open': { timer: 'question', ms: QUESTION_TIMER_MS },
  'question-media': { timer: 'media', ms: MEDIA_TIMER_MS },
  'question-reveal': { timer: 'text-reveal', ms: TEXT_REVEAL_FALLBACK_MS },
  'cat-handoff': { timer: 'cat-handoff', ms: CAT_HANDOFF_TIMER_MS },
  'auction-bidding': { timer: 'auction-bid', ms: AUCTION_BID_TIMER_MS },
  buzzed: { timer: 'said-answer', ms: SAID_ANSWER_TIMER_MS },
  judging: { timer: 'vote', ms: VOTE_TIMER_MS },
  reveal: { timer: 'reveal', ms: REVEAL_TIMER_MS },
  'round-end': { timer: 'round-end', ms: ROUND_END_TIMER_MS },
  'final-elim': { timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
  'final-wager': { timer: 'final-wager', ms: FINAL_WAGER_TIMER_MS },
  'final-answer': { timer: 'final-answer', ms: FINAL_ANSWER_TIMER_MS },
  'final-judging': { timer: 'final-judging', ms: FINAL_JUDGING_TIMER_MS },
  'final-reveal': { timer: 'final-reveal', ms: FINAL_REVEAL_TIMER_MS },
};

// Единая точка отказоустойчивости для рекордера истории (design.md,
// «Отказы не ломают партию»). Строится ОДИН раз в конструкторе Room —
// дальше все вызовы this.history.* внутри класса прямые, без try/catch и
// без локальных const-копий ради обхода TS-narrowing по `this`, которые
// раньше приходилось заводить в четырёх местах отдельно (startHistoryGame,
// safeHistoryCall и три вызова через него). Без переданного рекордера
// (тесты без истории, ранние стадии main()) подставляется no-op — тогда
// вызывающему коду не нужно помнить о `this.history?.`.
function wrapHistoryRecorder(recorder?: HistoryRecorder): HistoryRecorder {
  const target: HistoryRecorder = recorder ?? {
    startGame: () => null,
    recordQuestion: () => {},
    finishGame: () => {},
    discardGame: () => {},
    recordTag: () => {},
    clearTag: () => {},
    recordTagReason: () => {},
    downTagsForReview: () => [],
  };
  return {
    startGame(input) {
      try {
        return target.startGame(input);
      } catch (err) {
        console.error('История: рекордер бросил исключение (startGame) —', err);
        return null;
      }
    },
    recordQuestion(gameId, row) {
      try {
        target.recordQuestion(gameId, row);
      } catch (err) {
        console.error(
          'История: рекордер бросил исключение (recordQuestion) —',
          err,
        );
      }
    },
    finishGame(gameId, finalScores) {
      try {
        target.finishGame(gameId, finalScores);
      } catch (err) {
        console.error(
          'История: рекордер бросил исключение (finishGame) —',
          err,
        );
      }
    },
    discardGame(gameId) {
      try {
        target.discardGame(gameId);
      } catch (err) {
        console.error(
          'История: рекордер бросил исключение (discardGame) —',
          err,
        );
      }
    },
    recordTag(gameId, tag) {
      try {
        target.recordTag(gameId, tag);
      } catch (err) {
        console.error('История: рекордер бросил исключение (recordTag) —', err);
      }
    },
    clearTag(gameId, questionId, participantId) {
      try {
        target.clearTag(gameId, questionId, participantId);
      } catch (err) {
        console.error('История: рекордер бросил исключение (clearTag) —', err);
      }
    },
    recordTagReason(gameId, questionId, participantId, reason, reasonText) {
      try {
        target.recordTagReason(
          gameId,
          questionId,
          participantId,
          reason,
          reasonText,
        );
      } catch (err) {
        console.error(
          'История: рекордер бросил исключение (recordTagReason) —',
          err,
        );
      }
    },
    downTagsForReview(gameId, participantId, limit) {
      try {
        return target.downTagsForReview(gameId, participantId, limit);
      } catch (err) {
        console.error(
          'История: рекордер бросил исключение (downTagsForReview) —',
          err,
        );
        return [];
      }
    },
  };
}

// Сколько секунд ответивший неверно не может нажать повторно — не игровое
// правило движка (тот вообще не знает, кто и когда переоткрыл вопрос), а
// транспортное ограничение Комнаты, тем же паттерном, что и фальстарт
// (design.md, «Комната», «СУДЕЙСТВО», 2026-08-05). Идёт **параллельно** с
// возобновившимся отсчётом вопроса, а не перед ним — общее время на вопрос
// от этого не растёт.
const GRACE_EXCLUSION_MS = 5_000;

// Потолок разбора: больше пяти вопросов подряд гарантированно бросят на
// третьем, и не будет разобрано ни одного. Число условное, подлежит
// калибровке на живых партиях (design.md,
// 2026-08-21-question-tags-design.md, «Потолок в пять вопросов»).
const TAG_REVIEW_LIMIT = 5;

export class Room {
  private participants: Participant[];
  private pack: Pack | undefined;
  private game: EngineState | null;
  private hostParticipantId: string | null;
  private gameTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private gameTimerDeadline: number | null = null;
  // Сколько реального времени оставалось на вопрос в момент, когда по нему в
  // последний раз нажали — используется, чтобы после неверного ответа с
  // ведущим вопрос переоткрывался с ОСТАВШИМСЯ временем, а не с полным
  // свежим таймером: движок сам не знает часов и эмитит одинаковый
  // start-timer в обоих случаях (первый выбор вопроса и переоткрытие
  // выглядят для него одинаково), различить их и подставить остаток может
  // только Комната — она и так уже единственная, кто вообще знает текущее
  // время (design.md, «Комната»: «вся сетевая грязь и все настоящие таймеры
  // живут здесь»). questionId в паре — защита от применения остатка к
  // таймеру уже ДРУГОГО вопроса, если что-то в последовательности событий
  // пойдёт не так, как ожидается.
  private pendingReopenBudget: {
    questionId: string;
    remainingMs: number;
  } | null = null;
  // Кто временно (GRACE_EXCLUSION_MS) не может жать «Ответ» после
  // собственной неверной попытки — не состояние движка (design.md,
  // «СУДЕЙСТВО», 2026-08-05: это транспортное ограничение, как фальстарт, а
  // не игровое правило), поэтому живёт только здесь и не переживает
  // перезапуск сервера — цена этого приемлема (максимум несколько секунд
  // одной короткой блокировки, не влияющих на исход партии).
  private graceExcludedCounterId: string | null = null;
  private graceExcludedUntil: number | null = null;
  // Настоящий таймер (тот же принцип, что и gameTimeoutHandle) — без него
  // graceExcludedParticipantId технически "истекает" в toGameStateView()
  // (stillGraceExcluded() честно сравнивает с Date.now()), но клиенты узнают
  // об этом только со СЛЕДУЮЩЕЙ рассылкой состояния. Если до неё ничего не
  // происходит (никто больше не жмёт, вопрос просто ждёт), у исключённого
  // кнопка «Ответ» так и останется задизейбленной вечно, хотя счётчик на
  // экране уже показывает 0с — баг, пойманный на живой проверке 2026-08-06.
  private graceExclusionTimeoutHandle: ReturnType<typeof setTimeout> | null =
    null;
  private listeners = new Set<(state: RoomState) => void>();
  private lanCandidates: LanCandidate[];
  private lanAddress: string | null;
  private lanListeners = new Set<(address: string | null) => void>();
  private availablePacks: PackSummary[] = [];
  private activePackFilename: string | null;
  private packListeners = new Set<(info: PackInfo) => void>();
  // Скорость показа текста вопроса, слов/сек — ВРЕМЕННЫЙ настраиваемый
  // параметр (design.md, 2026-08-19-gradual-text-reveal-design.md,
  // «Временная скорость показа»), не часть RoomState по тому же принципу,
  // что lanAddress/availablePacks: транспортная настройка табло, не игровое
  // состояние, сбрасывается при перезапуске сервера. Убрать вместе с полем и
  // UI в админке, как только число зафиксируется в спеке.
  private textRevealWordsPerSecond = 2.5;
  private textRevealRateListeners = new Set<(wordsPerSecond: number) => void>();
  // Живое вкл/выкл постепенного показа — тот же ВРЕМЕННЫЙ статус и тот же
  // принцип, что у textRevealWordsPerSecond выше: транспортная настройка
  // табло для подбора на живых партиях, не часть игровых правил. true —
  // текст появляется по буквам (обычное поведение); false — computeTextRevealMs
  // ниже возвращает 0, вопрос открывается сразу.
  private textRevealEnabled = true;
  private textRevealEnabledListeners = new Set<(enabled: boolean) => void>();
  // Настоящая длительность показа текущего вопроса — то самое число, которое
  // applyEffects только что подставило в таймер (Step 3 ниже). Не null,
  // только пока идёт question-reveal; отдаётся в toGameStateView, чтобы
  // табло считало прогресс показа по тому же значению, что и реальный
  // серверный таймер — иначе смена скорости админкой прямо посреди показа
  // рассинхронила бы клиент и сервер.
  private currentTextRevealMs: number | null = null;
  // Писать ли эту партию в историю (design.md,
  // 2026-08-20-game-history-design.md, «Тумблер»). Эфемерный, как
  // textRevealEnabled: не часть RoomState, после перезапуска сервера
  // возвращается во «включено». Значит «эта партия в истории?», а не «пишем
  // ли прямо сейчас» — выключение выбрасывает уже записанное.
  private historyEnabled = true;
  private historyEnabledListeners = new Set<(enabled: boolean) => void>();
  // Всегда определён (wrapHistoryRecorder подставляет no-op вместо
  // отсутствующего аргумента конструктора) — тело класса дальше вызывает
  // this.history.* напрямую, без `?.`.
  private history: HistoryRecorder;
  private historyGameId: number | null;
  // Вопрос, который только что доиграли, и оценки по нему. Эфемерные: окно
  // оценки живёт секунды и переживать перезапуск сервера не обязано (design.md,
  // 2026-08-21-question-tags-design.md, «Движок не трогаем»). null — окно
  // закрыто.
  private taggableQuestionId: string | null = null;
  // participantId -> палец. Из неё считается счёт для табло и работает
  // «передумал». В базу пишется отдельно, сквозняком: при выключенном
  // тумблере остаётся только эта память, и всё видимое ведёт себя как в
  // настоящей партии, просто не оставляет следа.
  private currentTags = new Map<string, Thumb>();

  constructor(
    initial?: RoomState,
    pack?: Pack,
    lan?: LanInfo,
    initialPackFilename?: string,
    history?: HistoryRecorder,
  ) {
    this.participants = initial
      ? initial.participants.map((p) => ({ ...p }))
      : [];
    this.pack = pack;
    this.game = initial?.game ? { ...initial.game } : null;
    this.hostParticipantId = initial?.hostParticipantId ?? null;
    this.lanCandidates = lan?.candidates ?? [];
    this.lanAddress = lan?.address ?? null;
    this.activePackFilename = initialPackFilename ?? null;
    this.history = wrapHistoryRecorder(history);
    this.historyGameId = initial?.historyGameId ?? null;
    if (this.game) {
      const restart = PHASE_TIMER[this.game.phase];
      if (restart) {
        this.applyEffects([{ type: 'start-timer', ...restart }]);
      }
    }
  }

  join(name: string): JoinResult {
    const trimmed = name.trim();
    const normalized = normalizeName(trimmed);
    const taken = this.participants.some(
      (p) => normalizeName(p.name) === normalized,
    );
    if (taken) {
      return { error: 'name-taken' };
    }
    const participant: Participant = {
      id: randomUUID(),
      name: trimmed,
      token: randomUUID(),
      connected: true,
    };
    this.participants.push(participant);
    this.notify();
    return { participant: { ...participant } };
  }

  reconnect(token: string): ReconnectResult {
    const participant = this.participants.find((p) => p.token === token);
    if (!participant) {
      return { error: 'invalid-token' };
    }
    participant.connected = true;
    this.notify();
    return { participant: { ...participant } };
  }

  disconnect(participantId: string): void {
    const participant = this.participants.find((p) => p.id === participantId);
    if (!participant || !participant.connected) {
      return;
    }
    participant.connected = false;
    this.notify();
  }

  // Только в лобби — во время партии роль ведущего зафиксирована в
  // EngineState.hostId (design.md, «Ведущий», «во время партии роль
  // зафиксирована»), менять её здесь на лету значило бы разойтись с уже
  // идущей партией, ничего в ней при этом не поменяв.
  toggleHost(participantId: string): void {
    if (this.game && this.game.phase !== 'game-end') return;
    if (!this.participants.some((p) => p.id === participantId)) return;
    this.hostParticipantId =
      this.hostParticipantId === participantId ? null : participantId;
    this.notify();
  }

  // requesterId === null — обход авторизации для админ-панели (design.md,
  // «Админ-панель»): у нештатной комнаты (осиротевший ведущий, токен
  // которого ни у кого из присутствующих нет) иначе нет способа сдвинуть
  // партию с места вообще ничем, кроме удаления файла снапшота руками.
  startGame(requesterId: string | null): StartGameResult {
    if (!this.pack) {
      return { error: 'no-pack' };
    }
    // Повторный запуск во время уже идущей партии штатно недостижим (кнопка
    // «Начать игру» рендерится в Player.tsx только при game === null), но
    // если бы это случилось, unconditional overwrite ниже потерял бы текущую
    // партию, а таймер только что погашенного (или ещё не погашенного без
    // этой проверки) состояния мог бы сработать против нового this.game.
    // 'game-end' — исключение: это единственный способ сыграть вторую
    // партию без удаления файла снапшота.
    //
    // Эта проверка обязана идти РАНЬШЕ сброса таймера ниже: для фаз
    // 'reveal'/'round-end' таймер — единственное, что вообще продвигает
    // партию (нет действия игрока, которое бы это сделало), так что
    // отклонённый здесь вызов не должен его касаться — иначе он погасит
    // работающий таймер и партия зависнет навсегда без перезапуска процесса.
    if (this.game && this.game.phase !== 'game-end') {
      return { error: 'game-in-progress' };
    }
    // Только подключённые сейчас участники становятся счётчиками. Тот, кто
    // зашёл в лобби и ушёл (закрыл вкладку) до начала игры, не должен
    // остаться фантомным счётчиком с шансом на первый ход наравне с теми,
    // кто реально играет — он не участвует, и «минимум два игрока» тоже
    // должен считаться от реально присутствующих, а не от всех, кто когда-то
    // заходил за время жизни процесса.
    const present = this.participants.filter((p) => p.connected);
    // Ведущий берётся из лобби, только если он всё ещё реально подключён —
    // отметка, оставшаяся от кого-то, кто успел уйти, не должна тихо
    // заблокировать старт партии с ошибкой host-required, когда на самом
    // деле в комнате просто нет ведущего.
    const hostId =
      this.hostParticipantId &&
      present.some((p) => p.id === this.hostParticipantId)
        ? this.hostParticipantId
        : null;
    // Стартовать партию может кто угодно, пока никто не взял на себя роль
    // ведущего (design.md не требует ведущего вдвоём) — но как только он
    // назначен, запуск (и повторный запуск после game-end) — его решение,
    // не любого игрока за столом.
    if (requesterId !== null && hostId !== null && requesterId !== hostId) {
      return { error: 'host-only' };
    }
    const counters = present.filter((p) => p.id !== hostId);
    if (counters.length < 2) {
      return { error: 'not-enough-players' };
    }
    // Трое и больше счётчиков без ведущего — открытое судейство голосованием
    // при таком составе не работает честно (design.md, «СУДЕЙСТВО»): партия
    // не начнётся, пока кто-то не отметит себя ведущим в лобби.
    if (counters.length >= 3 && !hostId) {
      return { error: 'host-required' };
    }
    // Гасим только здесь, непосредственно перед тем, как реально перезаписать
    // this.game: таймер от ПРЕДЫДУЩЕЙ партии (например, оставшийся от
    // 'game-end', у которого таймера и так нет, но на всякий случай) не
    // должен продолжать тикать против нового this.game — тот же паттерн, что
    // и в applyEffects.
    this.clearGameTimer();
    this.clearGraceExclusion();
    this.taggableQuestionId = null;
    this.currentTags.clear();
    const counterIds = counters.map((p) => p.id);
    this.game = createInitialState(this.pack, counterIds, hostId);
    this.historyGameId = this.historyEnabled
      ? this.history.startGame({
          startedAt: new Date().toISOString(),
          packFilename: this.activePackFilename ?? 'неизвестный-пакет',
          packTitle: this.pack.title,
          participants: counters.map((p) => ({
            counterId: p.id,
            name: p.name,
          })),
        })
      : null;
    this.notify();
    return { ok: true };
  }

  // Отбрасывает текущую партию (в том числе восстановленную из снапшота
  // после перезапуска процесса) и возвращает комнату в пустое лобби — без
  // этого единственным способом сбросить состояние было вручную удалить файл
  // снапшота и перезапустить сервер. Та же авторизация, что и у startGame()
  // (requesterId === null — обход для админ-панели): пока ведущий назначен,
  // решение отбросить партию — его, не любого игрока.
  resetGame(requesterId: string | null): void {
    if (!this.game) return;
    if (
      requesterId !== null &&
      this.hostParticipantId !== null &&
      requesterId !== this.hostParticipantId
    ) {
      return;
    }
    this.clearGameTimer();
    this.clearGraceExclusion();
    this.game = null;
    this.taggableQuestionId = null;
    this.currentTags.clear();
    // Партия брошена, но её вопросы игроки видели — из истории они не
    // удаляются. Обнуляем только ссылку, чтобы следующая партия завела свою
    // строку, а не дописывалась в брошенную.
    this.historyGameId = null;
    this.notify();
  }

  // Полный сброс комнаты — участники, ведущий и партия одновременно, как при
  // ручном удалении room-snapshot.json и перезапуске процесса, но без
  // перезапуска. Только для админ-панели (design.md, «Админ-панель»):
  // никакого понятия «кто вправе» тут нет — это единственное действие,
  // которое разгребает по-настоящему нештатную комнату (осиротевший
  // ведущий, мусорные тестовые участники и т.п.), когда ни у кого из
  // реально присутствующих нет токена, чтобы исправить это игровыми
  // средствами.
  resetRoom(): void {
    this.clearGameTimer();
    this.clearGraceExclusion();
    this.participants = [];
    this.hostParticipantId = null;
    this.game = null;
    this.taggableQuestionId = null;
    this.currentTags.clear();
    // Партия брошена, но её вопросы игроки видели — из истории они не
    // удаляются. Обнуляем только ссылку, чтобы следующая партия завела свою
    // строку, а не дописывалась в брошенную.
    this.historyGameId = null;
    this.notify();
  }

  // Только для админ-панели. Убирает участника из комнаты насовсем (не то
  // же самое, что disconnect() — тот лишь помечает временное отсутствие,
  // сохраняя место и токен для reconnect). Если участник участвует в
  // текущей партии (ведущий или счётчик — то есть присутствует в
  // game.scores), партия сбрасывается вместе с ним: движок не умеет
  // вычеркнуть счётчика из уже идущей партии, не оставив висячих ссылок
  // (turnCounterId, голоса и т.д.), а частично исправленное состояние хуже
  // явного возврата в лобби.
  kickParticipant(participantId: string): 'ok' | 'not-found' {
    const index = this.participants.findIndex((p) => p.id === participantId);
    if (index === -1) return 'not-found';
    this.participants.splice(index, 1);
    if (this.hostParticipantId === participantId) {
      this.hostParticipantId = null;
    }
    if (
      this.game &&
      (this.game.hostId === participantId || participantId in this.game.scores)
    ) {
      this.clearGameTimer();
      this.clearGraceExclusion();
      this.game = null;
    }
    this.notify();
    return 'ok';
  }

  // Только для админ-панели — прямое назначение/снятие ведущего в лобби, в
  // обход toggleHost()'а (тот требует реального клика САМОГО назначаемого и
  // не срабатывает во время идущей партии). Нужен именно для нештатного
  // случая: роль ведущего застряла на токене, которого ни у кого из
  // присутствующих сейчас нет под рукой.
  setHost(participantId: string | null): 'ok' | 'not-found' {
    if (
      participantId !== null &&
      !this.participants.some((p) => p.id === participantId)
    ) {
      return 'not-found';
    }
    this.hostParticipantId = participantId;
    this.notify();
    return 'ok';
  }

  private clearGameTimer(): void {
    if (this.gameTimeoutHandle) {
      clearTimeout(this.gameTimeoutHandle);
      this.gameTimeoutHandle = null;
      this.gameTimerDeadline = null;
    }
  }

  // Гасит и таймер, и сами поля — вызывается везде, где this.game исчезает
  // или перезаписывается (тот же список мест, что и clearGameTimer()), иначе
  // таймер от СТАРОЙ партии рано или поздно сработает и обнулит
  // исключение уже НОВОЙ (graceExcludedCounterId скалярное — одно на
  // комнату, не привязано к конкретной партии).
  private clearGraceExclusion(): void {
    if (this.graceExclusionTimeoutHandle) {
      clearTimeout(this.graceExclusionTimeoutHandle);
      this.graceExclusionTimeoutHandle = null;
    }
    this.graceExcludedCounterId = null;
    this.graceExcludedUntil = null;
  }

  // Тем же способом, что и buzz() ниже решает falsestart до движка: движок
  // не знает об онлайн-статусе (инвариант 1), поэтому «отдать кота некому»
  // отклоняется здесь, ДО dispatch — docs/superpowers/specs/
  // 2026-08-12-cat-in-bag-design.md, «Комната». Ведущий тоже не годится в
  // получатели — он participant, но никогда не counter (не входит в
  // this.game.scores), поэтому кандидатность дополнительно проверяется
  // членством в scores, а не только участием в комнате.
  //
  // Возвращает результат (а не void), чтобы server.ts мог сообщить именно
  // тому, кто выбирал, почему клик ничего не сделал — до этой правки отказ
  // был полностью безмолвным для игрока (обратная связь, живая партия
  // 2026-08-17): пикер видел, что ничего не произошло, и не мог понять,
  // сломано что-то или нет.
  selectQuestion(
    participantId: string,
    themeIndex: number,
    questionId: string,
  ): SelectQuestionResult {
    if (this.game?.phase === 'selecting') {
      const question = findQuestion(
        this.game.pack,
        this.game.roundIndex,
        themeIndex,
        questionId,
      );
      if (question?.type === 'кот') {
        const hasRecipient = this.participants.some(
          (p) =>
            p.connected && p.id !== participantId && p.id in this.game!.scores,
        );
        if (!hasRecipient) return { error: 'no-recipient' };
      }
    }
    this.dispatch({
      type: 'select-question',
      counterId: participantId,
      themeIndex,
      questionId,
    });
    return { ok: true };
  }

  // Шлёт табло, доигравшее клип. Без participantId: табло не участник партии
  // и никогда не делает join — авторизация здесь такая же, как у админских
  // вызовов, по самому факту типа сообщения. Всю проверку осмысленности
  // (та ли фаза, тот ли вопрос) делает движок, чтобы правило жило в одном
  // месте (design.md, 2026-08-18-video-questions-design.md, «Фаза
  // проигрывания медиа»).
  mediaFinished(questionId: string): void {
    if (!this.game) return;
    this.dispatch({ type: 'media-finished', questionId });
  }

  // Тот же принцип, что у selectQuestion() выше — офлайн-получателя движок
  // сам отклонить не может, отклоняем здесь. И тот же нюанс с ведущим: он
  // participant, но не counter, поэтому кандидатность дополнительно
  // проверяется членством в this.game.scores.
  assignCat(participantId: string, recipientParticipantId: string): void {
    if (
      this.game?.phase === 'cat-handoff' &&
      !this.participants.some(
        (p) =>
          p.connected &&
          p.id === recipientParticipantId &&
          p.id in this.game!.scores,
      )
    ) {
      return;
    }
    this.dispatch({
      type: 'assign-cat',
      counterId: participantId,
      recipientCounterId: recipientParticipantId,
    });
  }

  // В отличие от selectQuestion()/assignCat() выше, здесь нет собственной
  // проверки — движок сам знает, чей ход (auctionTurnCounterId), а онлайн-
  // статус для аукциона не нужен (design.md, «Тайм-аут хода торгов»):
  // бездействие уже само по себе штатный исход (авто-пас по таймеру), а не
  // тупик, который надо было бы предотвратить заранее.
  placeBid(participantId: string, amount: number): void {
    this.dispatch({ type: 'place-bid', counterId: participantId, amount });
  }

  passBid(participantId: string): void {
    this.dispatch({ type: 'pass-bid', counterId: participantId });
  }

  // Возвращает 'falsestart', когда нажатие пришло вне фазы «вопрос открыт» —
  // движок о таких нажатиях никогда не узнаёт (design.md, «Комната»),
  // потому что здесь для них нет смысла ни в каком состоянии.
  buzz(participantId: string): 'ok' | 'falsestart' {
    if (!this.game || this.game.phase !== 'question-open') {
      return 'falsestart';
    }
    // Тот же паттерн, что и фальстарт (design.md, «Комната») — временное
    // исключение после своей же неверной попытки не игровое правило, до
    // движка это нажатие вообще не доходит. Не 'falsestart' в ответе
    // намеренно: это не тот же случай (не включает клиентскую блокировку на
    // 2с) — клиент уже знает про свой отсчёт из общего состояния
    // (graceExcludedParticipantId/graceExcludedUntil).
    if (
      this.graceExcludedCounterId === participantId &&
      this.stillGraceExcluded()
    ) {
      return 'ok';
    }
    // Захватываем остаток времени ДО диспатча — именно в этот момент вопрос
    // «ставится на паузу» с точки зрения игрока (движок сейчас погасит
    // текущий 'question'-таймер эффектом cancel-timer). Если после этого
    // нажатия ответ окажется неверным и вопрос честно переоткроется (режим
    // с ведущим), досмотреть его должны с тем же остатком, а не с чистого
    // листа — и сразу же, без какой-либо паузы (design.md, «СУДЕЙСТВО»,
    // 2026-08-05).
    if (this.game.currentQuestion && this.gameTimerDeadline !== null) {
      this.pendingReopenBudget = {
        questionId: this.game.currentQuestion.questionId,
        remainingMs: Math.max(0, this.gameTimerDeadline - Date.now()),
      };
    }
    this.dispatch({ type: 'buzz', counterId: participantId });
    return 'ok';
  }

  saidAnswer(participantId: string): void {
    this.dispatch({ type: 'said-answer', counterId: participantId });
  }

  vote(participantId: string, correct: boolean): void {
    this.dispatch({ type: 'vote', counterId: participantId, correct });
  }

  // Панель ведущего (design.md, «Ведущий») — движок сам перепроверяет
  // requesterId === hostId, здесь достаточно передать реального отправителя
  // сообщения, не доверяя утверждению клиента о своей роли.
  adjustScore(
    requesterId: string,
    targetParticipantId: string,
    delta: number,
  ): void {
    this.dispatch({
      type: 'adjust-score',
      requesterId,
      targetCounterId: targetParticipantId,
      delta,
    });
  }

  cancelQuestion(requesterId: string): void {
    this.dispatch({ type: 'cancel-question', requesterId });
  }

  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в engine.ts.
  // Только с админ-панели, поэтому без параметра — там нет личности
  // отправителя, которую можно было бы передать.
  skipToFinal(): void {
    this.dispatch({ type: 'skip-to-final' });
  }

  eliminateFinalTheme(participantId: string, themeIndex: number): void {
    this.dispatch({
      type: 'eliminate-final-theme',
      counterId: participantId,
      themeIndex,
    });
  }

  submitWager(participantId: string, amount: number): void {
    this.dispatch({ type: 'submit-wager', counterId: participantId, amount });
  }

  submitFinalAnswer(participantId: string, text: string): void {
    this.dispatch({
      type: 'submit-final-answer',
      counterId: participantId,
      text,
    });
  }

  // Панель ведущего в финале — тем же паттерном, что adjustScore/
  // cancelQuestion: requesterId настоящий отправитель, не то, что клиент о
  // себе заявляет; движок сам сверяет requesterId === hostId.
  finalVote(
    requesterId: string,
    targetParticipantId: string,
    correct: boolean,
  ): void {
    this.dispatch({
      type: 'final-vote',
      requesterId,
      counterId: targetParticipantId,
      correct,
    });
  }

  /**
   * Оценка только что сыгранного вопроса. Не правило игры: ничего не решает,
   * ни на что не влияет, фазу не меняет — поэтому живёт здесь, а не в движке.
   *
   * Повторный тап по тому же пальцу снимает оценку, тап по другому — меняет.
   */
  tagQuestion(participantId: string, thumb: Thumb): void {
    if (this.taggableQuestionId === null) return;
    if (!this.participants.some((p) => p.id === participantId)) return;
    const questionId = this.taggableQuestionId;
    if (this.currentTags.get(participantId) === thumb) {
      this.currentTags.delete(participantId);
      if (this.historyGameId !== null) {
        this.history.clearTag(this.historyGameId, questionId, participantId);
      }
    } else {
      this.currentTags.set(participantId, thumb);
      if (this.historyGameId !== null) {
        this.history.recordTag(this.historyGameId, {
          questionId,
          participantId,
          participantName: this.nameOf(participantId) ?? '',
          thumb,
        });
      }
    }
    this.notify();
  }

  /**
   * Причина, по которой игрок пометил вопрос пальцем вниз. Приходит с экрана
   * разбора в конце партии.
   */
  submitTagReason(
    participantId: string,
    questionId: string,
    reason: string | null,
    text: string,
  ): void {
    if (this.historyGameId === null) return;
    this.history.recordTagReason(
      this.historyGameId,
      questionId,
      participantId,
      reason,
      text,
    );
    this.notify();
  }

  getState(): RoomState {
    return {
      participants: this.participants.map((p) => ({ ...p })),
      game: this.game ? { ...this.game } : null,
      hostParticipantId: this.hostParticipantId,
      historyGameId: this.historyGameId,
    };
  }

  getLanInfo(): LanInfo {
    return { candidates: [...this.lanCandidates], address: this.lanAddress };
  }

  // Только для админ-панели (design.md, «Ловушки этого проекта», «Выбор
  // локального IP на Windows») — автовыбор первого адреса иногда указывает
  // на виртуальный адаптер, недостижимый с телефона. Здесь человек выбирает
  // сам из реально найденных кандидатов; неизвестный address — тихий no-op,
  // а не ошибка (тот же паттерн, что у admin-kick с неизвестным id).
  setLanAddress(address: string): void {
    if (!this.lanCandidates.some((c) => c.address === address)) {
      return;
    }
    this.lanAddress = address;
    for (const listener of this.lanListeners) {
      listener(this.lanAddress);
    }
  }

  getPackInfo(): PackInfo {
    return {
      available: [...this.availablePacks],
      activeFilename: this.activePackFilename,
    };
  }

  // ВРЕМЕННО — см. Room.textRevealWordsPerSecond.
  getTextRevealWordsPerSecond(): number {
    return this.textRevealWordsPerSecond;
  }

  // ВРЕМЕННО — см. Room.textRevealWordsPerSecond.
  // Без проверки отправителя, как и остальные admin-* настройки этого
  // класса — админ-панель не проверяет личность (server.ts).
  setTextRevealWordsPerSecond(wordsPerSecond: number): void {
    if (!Number.isFinite(wordsPerSecond) || wordsPerSecond <= 0) return;
    this.textRevealWordsPerSecond = wordsPerSecond;
    for (const listener of this.textRevealRateListeners) {
      listener(this.textRevealWordsPerSecond);
    }
  }

  // ВРЕМЕННО — см. Room.textRevealEnabled.
  getTextRevealEnabled(): boolean {
    return this.textRevealEnabled;
  }

  // ВРЕМЕННО — см. Room.textRevealEnabled. Без проверки отправителя, тем же
  // паттерном, что setTextRevealWordsPerSecond выше.
  setTextRevealEnabled(enabled: boolean): void {
    this.textRevealEnabled = enabled;
    for (const listener of this.textRevealEnabledListeners) {
      listener(this.textRevealEnabled);
    }
  }

  getHistoryEnabled(): boolean {
    return this.historyEnabled;
  }

  // Правда о том, пишется ли ПРЯМО СЕЙЧАС конкретно идущая партия — в
  // отличие от historyEnabled (намерение на партию, которая начнётся
  // дальше), эти два расходятся именно после off→on посреди партии:
  // historyEnabled снова true, а historyGameId уже null (обратной операции
  // нет — см. комментарий у setHistoryEnabled). Админка (Admin.tsx) сверяет
  // чекбокс с этим полем, а не только с historyEnabled, чтобы не показывать
  // партию записываемой, когда она уже окончательно выброшена.
  isHistoryRecording(): boolean {
    return this.historyGameId !== null;
  }

  // Выключение не просто останавливает запись, а выбрасывает уже записанное
  // этой партией: тумблер отвечает на вопрос «эта партия в истории?».
  // Обратной операции нет — historyGameId обнуляется вместе с удалением, так
  // что повторное включение в той же партии записи не возобновляет. Это
  // намеренно (design.md, «Тумблер»), а не недосмотр.
  setHistoryEnabled(enabled: boolean): void {
    this.historyEnabled = enabled;
    if (!enabled && this.historyGameId !== null) {
      this.history.discardGame(this.historyGameId);
      this.historyGameId = null;
      // historyGameId — часть RoomState, а на диск снапшот пишется по
      // onChange (index.ts), не по onHistoryEnabledChange. Без notify()
      // здесь обнуление строкой выше не доезжает до снапшота: переживший
      // перезапуск сервера снапшот всё ещё указывает на партию, которую
      // history.ts уже удалила, и первая же запись следующего вопроса
      // пойдёт по FK в несуществующую строку games и молча провалится
      // (финальное ревью ветки, п. 1).
      this.notify();
    }
    for (const listener of this.historyEnabledListeners) {
      listener(this.historyEnabled);
    }
  }

  onHistoryEnabledChange(listener: (enabled: boolean) => void): () => void {
    this.historyEnabledListeners.add(listener);
    return () => this.historyEnabledListeners.delete(listener);
  }

  private isHostOrAdmin(requesterId: string | null): boolean {
    return requesterId === null || requesterId === this.hostParticipantId;
  }

  // requesterId === null — с админ-панели, без проверки личности (тот же
  // паттерн, что у setLanAddress/startGame). Иначе — только текущий
  // лобби-ведущий (hostParticipantId, не game.hostId: выбор пакета имеет
  // смысл до партии). Неавторизованный вызов — тихий no-op: сама кнопка не
  // должна была быть видна отправителю, осмысленный ответ ему не нужен.
  refreshAvailablePacks(
    requesterId: string | null,
    packs: PackSummary[],
  ): void {
    if (!this.isHostOrAdmin(requesterId)) return;
    this.availablePacks = packs;
    this.notifyPackChange();
  }

  // Не трогает диск сама — `pack` уже прочитан и провалидирован вызывающим
  // (server.ts). Проверяет только то, что `filename` входит в уже известный
  // `availablePacks` (тот же принцип, что setLanAddress с lanCandidates) —
  // защита от гонки между обновлением списка и выбором, не источник истины
  // о валидности содержимого файла.
  selectPack(
    requesterId: string | null,
    filename: string,
    pack: Pack,
  ): { ok: true } | { error: 'not-host' | 'unknown-file' } {
    if (!this.isHostOrAdmin(requesterId)) {
      return { error: 'not-host' };
    }
    if (!this.availablePacks.some((p) => p.filename === filename)) {
      return { error: 'unknown-file' };
    }
    this.pack = pack;
    this.activePackFilename = filename;
    this.notifyPackChange();
    return { ok: true };
  }

  private notifyPackChange(): void {
    const info = this.getPackInfo();
    for (const listener of this.packListeners) {
      listener(info);
    }
  }

  // `viewerId` — participantId сокета, которому строится это конкретное
  // состояние (null для ещё не залогиненного сокета и для табло — оно не
  // шлёт `join`). На judging с ведущим (game.hostId !== null) ответ обязан
  // видеть только он: это единственный смысл всей роли (design.md,
  // «СУДЕЙСТВО») — если разослать его всем как раньше, второй попытке при
  // переоткрытии вопроса опять будет грош цена, ровно тот дефект, ради
  // которого ведущий вообще появился.
  toGameStateView(viewerId: string | null = null): GameStateView | null {
    if (!this.game) return null;
    const game = this.game;
    const round = game.pack.rounds[game.roundIndex];
    const currentQuestionData = game.currentQuestion
      ? round.themes[game.currentQuestion.themeIndex].questions.find(
          (q) => q.id === game.currentQuestion!.questionId,
        )
      : undefined;
    const currentThemeName = game.currentQuestion
      ? round.themes[game.currentQuestion.themeIndex].name
      : undefined;

    const showAnswer =
      game.phase === 'reveal' ||
      (game.phase === 'judging' &&
        (game.hostId === null || viewerId === game.hostId));

    // Ведущему на final-judging нужно видеть ставки/ответы всех, чтобы
    // судить (design.md, финал-спека, «Комната») — та же причина, по которой
    // на judging только ему виден correctAnswer. На final-reveal видно всем,
    // ставка/ответ соперника уже не секрет — партия окончена.
    const showAllFinal =
      game.phase === 'final-reveal' ||
      (game.phase === 'final-judging' && viewerId === game.hostId);

    return {
      phase: game.phase,
      // Замороженный на время партии ведущий — НЕ то же самое, что
      // лобби-флаг hostParticipantId, который может ещё указывать на
      // кого-то, кто был отмечен ведущим, но на момент старта партии
      // оказался отключён (design.md, «Ведущий»: «во время партии роль
      // зафиксирована»). Клиент обязан считать себя ведущим по этому полю,
      // пока партия идёт, а не по лобби-флагу.
      hostId: game.hostId,
      roundIndex: game.roundIndex,
      grid: round.themes.map((theme) => ({
        themeName: theme.name,
        questions: theme.questions.map((q) => ({
          id: q.id,
          price: q.price,
          answered: game.answeredQuestionIds.includes(q.id),
        })),
      })),
      turnParticipantId: game.turnCounterId,
      // Цена и тема видны сразу — не секрет, те же данные уже были на сетке
      // до выбора. Текст скрыт, пока идёт cat-handoff или торги по аукциону
      // (design.md обеих вех, «Правило»: у аукциона та же видимость, что у
      // «кота» — торговаться, уже зная вопрос, значит не торговаться вовсе).
      currentQuestion: currentQuestionData
        ? {
            // Не секрет: тот же id уже лежит в grid выше. Табло возвращает
            // его в media-finished, чтобы опоздавший сигнал по прошлому
            // вопросу не оборвал клип следующего (инвариант 3 — стабильный
            // id вопроса — ровно для таких связей и заведён).
            id: currentQuestionData.id,
            text:
              game.phase === 'cat-handoff' || game.phase === 'auction-bidding'
                ? null
                : currentQuestionData.text,
            price: currentQuestionData.price,
            themeName: currentThemeName!,
            // Та же видимость, что у text выше — скрыта во время
            // cat-handoff/торгов. this.activePackFilename почти всегда
            // задан вместе с this.pack (constructor/selectPack всегда
            // присваивают их парой) — на случай расхождения фолбэк на
            // null безопаснее, чем бросать ошибку ради поля, которое и
            // так необязательно.
            image:
              game.phase === 'cat-handoff' ||
              game.phase === 'auction-bidding' ||
              !currentQuestionData.image ||
              !this.activePackFilename
                ? null
                : `/media/${this.activePackFilename.replace(/\.json$/, '')}/${currentQuestionData.image}`,
            video:
              game.phase === 'cat-handoff' ||
              game.phase === 'auction-bidding' ||
              !currentQuestionData.video
                ? null
                : {
                    youtubeId: currentQuestionData.video.youtubeId,
                    startSeconds: currentQuestionData.video.startSeconds,
                    durationSeconds: currentQuestionData.video.durationSeconds,
                    audioOnly: currentQuestionData.video.audioOnly ?? false,
                  },
            // Сколько всего мс займёт показ текущего вопроса — то самое
            // значение, что applyEffects только что подставило в таймер
            // (Step 3 выше). Не null только в question-reveal (design.md,
            // 2026-08-19-gradual-text-reveal-design.md, «Сервер и клиент»).
            revealMs: this.currentTextRevealMs,
          }
        : null,
      questionTags:
        this.taggableQuestionId === null
          ? null
          : {
              up: [...this.currentTags.values()].filter((t) => t === 'up')
                .length,
              down: [...this.currentTags.values()].filter((t) => t === 'down')
                .length,
              mine:
                viewerId === null
                  ? null
                  : (this.currentTags.get(viewerId) ?? null),
            },
      tagReview:
        game.phase === 'game-end' &&
        viewerId !== null &&
        this.historyGameId !== null
          ? this.history.downTagsForReview(
              this.historyGameId,
              viewerId,
              TAG_REVIEW_LIMIT,
            )
          : [],
      buzzedParticipantId: game.buzzedCounterId,
      exclusiveAnswererParticipantId: game.exclusiveAnswererCounterId,
      auctionTurnParticipantId: game.auctionTurnCounterId,
      // Гейт по auctionHighestBidderCounterId, а не по auctionOrder:
      // auctionOrder обнуляется в ту же секунду, когда победитель определён,
      // и по нему выигрышная сумма пропала бы с провода ровно на
      // question-open/buzzed/judging — то есть именно тогда, когда комнате
      // нужно видеть, что стоит на кону. Победитель же живёт до
      // revealQuestion() (финальное ревью, 2026-08-14).
      auctionHighestBid:
        game.auctionHighestBidderCounterId !== null
          ? game.auctionHighestBid
          : null,
      auctionHighestBidderParticipantId: game.auctionHighestBidderCounterId,
      auctionPassedParticipantIds: game.auctionOrder
        ? game.auctionPassedCounterIds
        : null,
      // Не поле движка — Room-состояние, лениво «истекает» по сравнению с
      // Date.now() здесь же, без отдельного сброса по таймеру (см. поля
      // класса выше).
      graceExcludedParticipantId: this.stillGraceExcluded()
        ? this.graceExcludedCounterId
        : null,
      graceExcludedUntil: this.stillGraceExcluded()
        ? this.graceExcludedUntil
        : null,
      correctAnswer:
        showAnswer && currentQuestionData
          ? {
              text: currentQuestionData.answer,
              comment: currentQuestionData.comment,
            }
          : null,
      timerDeadline: this.gameTimerDeadline,
      scores: Object.entries(game.scores).map(([participantId, score]) => ({
        participantId,
        score,
      })),
      finalThemes: game.finalRemainingThemeIndices
        ? game.pack.final!.themes.map((theme, i) => ({
            name: theme.name,
            eliminated: !game.finalRemainingThemeIndices!.includes(i),
          }))
        : null,
      finalElimParticipantId: game.finalElimCounterId,
      finalQuestion:
        game.finalThemeIndex !== null &&
        (game.phase === 'final-answer' ||
          game.phase === 'final-judging' ||
          game.phase === 'final-reveal')
          ? {
              text: game.pack.final!.themes[game.finalThemeIndex].question.text,
            }
          : null,
      finalWagers:
        game.finalThemeIndex === null
          ? null
          : Object.entries(game.finalWagers)
              .filter(([counterId]) => showAllFinal || counterId === viewerId)
              .map(([participantId, amount]) => ({ participantId, amount })),
      finalAnswers:
        game.finalThemeIndex === null
          ? null
          : Object.entries(game.finalAnswers)
              .filter(([counterId]) => showAllFinal || counterId === viewerId)
              .map(([participantId, text]) => ({ participantId, text })),
      finalVerdicts:
        game.phase === 'final-judging' || game.phase === 'final-reveal'
          ? Object.entries(game.finalVerdicts)
              .filter(() => showAllFinal)
              .map(([participantId, correct]) => ({ participantId, correct }))
          : null,
      finalCorrectAnswer:
        showAllFinal && game.finalThemeIndex !== null
          ? {
              text: game.pack.final!.themes[game.finalThemeIndex].question
                .answer,
              comment:
                game.pack.final!.themes[game.finalThemeIndex].question.comment,
            }
          : null,
    };
  }

  onChange(listener: (state: RoomState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Отдельно от onChange: смена LAN-адреса не часть RoomState (см. LanInfo),
  // поэтому и подписка на неё отдельная — иначе пришлось бы либо пихать
  // lanAddress в RoomState/снапшот не по смыслу, либо дёргать общий listener
  // без реального изменения состояния комнаты.
  onLanChange(listener: (address: string | null) => void): () => void {
    this.lanListeners.add(listener);
    return () => this.lanListeners.delete(listener);
  }

  // Отдельно от onChange/onLanChange по той же причине: список пакетов и
  // активный выбор не часть RoomState.
  onPackChange(listener: (info: PackInfo) => void): () => void {
    this.packListeners.add(listener);
    return () => this.packListeners.delete(listener);
  }

  // ВРЕМЕННО — см. Room.textRevealWordsPerSecond.
  onTextRevealRateChange(
    listener: (wordsPerSecond: number) => void,
  ): () => void {
    this.textRevealRateListeners.add(listener);
    return () => this.textRevealRateListeners.delete(listener);
  }

  // ВРЕМЕННО — см. Room.textRevealEnabled.
  onTextRevealEnabledChange(listener: (enabled: boolean) => void): () => void {
    this.textRevealEnabledListeners.add(listener);
    return () => this.textRevealEnabledListeners.delete(listener);
  }

  private stillGraceExcluded(): boolean {
    return (
      this.graceExcludedUntil !== null && Date.now() < this.graceExcludedUntil
    );
  }

  private dispatch(event: EngineEvent): void {
    if (!this.game) return;
    const buzzedBefore = this.game.buzzedCounterId;
    const phaseBefore = this.game.phase;
    const answeredCountBefore = this.game.answeredQuestionIds.length;
    const questionBefore = this.game.currentQuestion;
    const roundIndexBefore = this.game.roundIndex;
    const scoresBefore = this.game.scores;
    const hostIdBefore = this.game.hostId;
    // Выигрышная ставка аукциона на момент ДО этого dispatch. Захватывается
    // здесь же, рядом со scoresBefore/hostIdBefore, а не читается из state
    // ПОСЛЕ reduce() — resolveVote()/afterBidOrPass() в движке успевают
    // сбросить auctionHighestBid обратно в 0 в том же самом вызове reduce(),
    // где вопрос закрывается (engine.ts, resetAuctionFields). recordPlayedQuestion
    // ниже пишет её как настоящую цену вопроса-аукциона (design.md,
    // 2026-08-20-game-history-design.md, «Схема»).
    const auctionHighestBidBefore = this.game.auctionHighestBid;
    // Голоса из состояния «до» ПЛЮС текущее событие, если это голос. При
    // нынешней семантике движка (engine.ts::handleVote) это НИКОГДА не
    // меняет итог: 'vote' резолвит вопрос синхронно только когда
    // hostId !== null (голос ведущего решает сразу), а recordPlayedQuestion
    // ниже в этом случае и так пишет contested: null, не читая votes вовсе.
    // Без ведущего 'vote' лишь копится в state.votes и ничего не решает —
    // резолюция приходит только по 'timer-expired', и тогда состояние «до»
    // уже полное само по себе, без всякого мержа. Мерж оставлен как
    // страховка на случай, если синхронная резолюция голосом когда-нибудь
    // появится и без ведущего — тогда «до» станет неполным ровно так же,
    // как сейчас неполно для ведущего, и этот код нужно будет прочитать.
    const votesAtResolution =
      event.type === 'vote'
        ? { ...this.game.votes, [event.counterId]: event.correct }
        : this.game.votes;
    const { state, effects } = reduce(this.game, event);
    this.game = state;

    // Обнаруживаем честный реопен после «Незачёт» в режиме с ведущим по
    // самому переходу состояния, а не по типу события — 'vote' может прийти
    // и явным сообщением от ведущего, и по истечении VOTE_TIMER_MS
    // (handleTimerExpired), и в обоих случаях распознаётся одинаково:
    // buzzedCounterId был кем-то и стал null, а фаза при этом вернулась в
    // 'question-open' (не 'reveal', как при верном ответе). Больше никакой
    // переход состояния в этой комбинации не встречается. Персональное
    // исключение — не забота движка (design.md, «СУДЕЙСТВО», 2026-08-05),
    // поэтому заводится здесь, а не читается из EngineState.
    if (
      buzzedBefore &&
      phaseBefore === 'judging' &&
      state.phase === 'question-open' &&
      state.buzzedCounterId === null
    ) {
      // Гасим предыдущий таймер исключения (если кто-то другой уже был им
      // временно связан) ПЕРЕД тем, как завести новый — иначе более ранний
      // таймер рано или поздно сработает и обнулит только что заведённое здесь
      // исключение чужим callback'ом.
      this.clearGraceExclusion();
      this.graceExcludedCounterId = buzzedBefore;
      this.graceExcludedUntil = Date.now() + GRACE_EXCLUSION_MS;
      // Без настоящего таймера здесь исключение технически истекает в
      // toGameStateView() (stillGraceExcluded() честно сравнивает с
      // Date.now()), но клиенты узнают об этом только со СЛЕДУЮЩЕЙ рассылкой.
      // Если до неё ничего не происходит, кнопка «Ответ» у исключённого
      // остаётся задизейбленной вечно, хотя счётчик на экране уже показывает
      // 0с (живая проверка, 2026-08-06) — этот таймер и есть недостающая
      // рассылка ровно в момент, когда исключение реально кончается.
      this.graceExclusionTimeoutHandle = setTimeout(() => {
        this.graceExclusionTimeoutHandle = null;
        this.graceExcludedCounterId = null;
        this.graceExcludedUntil = null;
        this.notify();
      }, GRACE_EXCLUSION_MS);
    }

    this.applyEffects(effects, event.type === 'timer-expired');
    if (state.answeredQuestionIds.length > answeredCountBefore) {
      this.recordPlayedQuestion(
        state,
        questionBefore,
        roundIndexBefore,
        scoresBefore,
        hostIdBefore,
        votesAtResolution,
        buzzedBefore,
        auctionHighestBidBefore,
      );
      // Окно оценки открывается ровно здесь: вопрос доиграли, его текст и
      // ответ сейчас на экране.
      this.taggableQuestionId = questionBefore?.questionId ?? null;
      this.currentTags.clear();
    }
    // Окно закрывается, когда выбрали следующий вопрос. Именно переход
    // «было null, стало не-null», а не список фаз: revealQuestion оставляет
    // currentQuestion заполненным на время фазы reveal и обнуляет его только
    // переход в selecting, так что этот переход однозначно означает выбор
    // нового вопроса. Список фаз перечислять нельзя — он растёт от вехи к
    // вехе, и перечисление молча теряло бы окно (design.md,
    // 2026-08-21-question-tags-design.md, «Где и как долго»).
    if (questionBefore === null && state.currentQuestion !== null) {
      this.taggableQuestionId = null;
      this.currentTags.clear();
    }
    if (phaseBefore !== 'final-reveal' && state.phase === 'final-reveal') {
      this.recordFinalQuestion(state);
    }
    if (
      phaseBefore !== 'game-end' &&
      state.phase === 'game-end' &&
      this.historyGameId !== null
    ) {
      this.history.finishGame(this.historyGameId, state.scores);
    }
    this.notify();
  }

  private applyEffects(effects: Effect[], timerJustFired = false): void {
    // Пустой effects[] означает две РАЗНЫЕ вещи в зависимости от того, что
    // за событие его породило, и их нельзя путать:
    //
    // 1. Событие НЕ timer-expired (например, 'vote' во время судейства —
    //    голос просто копится в state.votes, разрешение приходит только по
    //    таймеру) — пустой effects[] означает «про таймер ничего не
    //    меняется», а не «таймера больше нет». Уже тикающий таймер (взведённый
    //    более ранним диспатчем — скажем, входом в 'judging') должен
    //    продолжать тикать как ни в чём не бывало. Сбросить его здесь значит
    //    убить единственный механизм, который вообще разрешает судейство —
    //    ни один будущий 'vote' его не переустановит, потому что handleVote
    //    в движке сам никогда не эмитит start-timer. Судейство подвисло бы
    //    навсегда после первого же голоса.
    // 2. Событие timer-expired — это значит, что ИМЕННО ТЕКУЩИЙ таймер только
    //    что сработал сам. Даже если новых эффектов нет (после РАСКРЫТИЯ фаза
    //    может стать 'selecting'/'game-end', у которых таймера вообще нет),
    //    бухгалтерию (gameTimeoutHandle/gameTimerDeadline) всё равно нужно
    //    обнулить — иначе toGameStateView() будет показывать устаревший, уже
    //    прошедший дедлайн (для 'game-end' — уже навсегда).
    //
    // Отсюда: трогаем bookkeeping только когда либо пришли новые эффекты,
    // либо только что сработал именно текущий таймер.
    if (effects.length === 0 && !timerJustFired) {
      return;
    }
    if (this.gameTimeoutHandle) {
      clearTimeout(this.gameTimeoutHandle);
      this.gameTimeoutHandle = null;
      this.gameTimerDeadline = null;
    }
    for (const effect of effects) {
      if (effect.type === 'start-timer') {
        // Движок эмитит один и тот же { timer: 'question', ms:
        // QUESTION_TIMER_MS } что для только что выбранного вопроса, что для
        // переоткрытия после неверного ответа — с его стороны это
        // неотличимые случаи, часов у него нет. Отличить их может только
        // Комната, по тому, совпадает ли текущий вопрос с тем, для которого
        // остаток был захвачен в buzz(). Совпал — досматриваем с остатком, а
        // не заново.
        let ms = effect.ms;
        if (
          effect.timer === 'question' &&
          this.pendingReopenBudget &&
          this.game?.currentQuestion?.questionId ===
            this.pendingReopenBudget.questionId
        ) {
          ms = this.pendingReopenBudget.remainingMs;
          this.pendingReopenBudget = null;
        }
        if (effect.timer === 'text-reveal') {
          ms = this.computeTextRevealMs();
          this.currentTextRevealMs = ms;
        } else {
          this.currentTextRevealMs = null;
        }
        this.gameTimerDeadline = Date.now() + ms;
        this.gameTimeoutHandle = setTimeout(() => {
          this.dispatch({ type: 'timer-expired', timer: effect.timer });
        }, ms);
      }
    }
  }

  // Число слов текущего вопроса делённое на текущую скорость, не ниже
  // TEXT_REVEAL_MIN_MS (design.md, 2026-08-19-gradual-text-reveal-design.md,
  // «Фаза question-reveal»). Вызывается из applyEffects в момент, когда
  // движок эмитит таймер 'text-reveal' — сам движок этого числа не знает
  // (инвариант 1, и скорость показа — настройка Комнаты, не игровое
  // правило).
  private computeTextRevealMs(): number {
    // Выключено админкой (Room.textRevealEnabled, ВРЕМЕННО) — 0 без учёта
    // TEXT_REVEAL_MIN_MS: вопрос должен открыться сразу, а не хотя бы на
    // минимальный порог. useTextReveal.ts на клиенте уже трактует
    // revealMs <= 0 как «показать текст целиком», отдельного случая на
    // клиенте не требуется.
    if (!this.textRevealEnabled) return 0;
    const question = findQuestion(
      this.game!.pack,
      this.game!.roundIndex,
      this.game!.currentQuestion!.themeIndex,
      this.game!.currentQuestion!.questionId,
    )!;
    const words = question.text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(
      TEXT_REVEAL_MIN_MS,
      Math.round((words / this.textRevealWordsPerSecond) * 1000),
    );
  }

  private recordPlayedQuestion(
    state: EngineState,
    questionBefore: EngineState['currentQuestion'],
    roundIndexBefore: number,
    scoresBefore: Record<string, number>,
    hostIdBefore: string | null,
    votes: Record<string, boolean>,
    buzzedBefore: string | null,
    auctionHighestBidBefore: number,
  ): void {
    if (this.historyGameId === null || !questionBefore) return;
    const gameId = this.historyGameId;
    const question = findQuestion(
      state.pack,
      roundIndexBefore,
      questionBefore.themeIndex,
      questionBefore.questionId,
    );
    if (!question) return;
    const themeName =
      state.pack.rounds[roundIndexBefore]?.themes[questionBefore.themeIndex]
        ?.name ?? '';
    // Верность выводится по знаку изменения счёта отвечавшего: верный ответ
    // добавляет цену (у аукциона — ставку), неверный вычитает её. Ровно ноль
    // означает, что вердикта не было вовсе — ведущий отменил вопрос.
    const delta =
      buzzedBefore === null
        ? 0
        : (state.scores[buzzedBefore] ?? 0) - (scoresBefore[buzzedBefore] ?? 0);
    const voteValues = Object.values(votes);
    // У аукциона номинал пакета (question.price) не был реальной ценой ни
    // секунды: игроки торгуются, и в счёт попадает выигравшая ставка, а не
    // номинал (docs/ideas.md, «Память и обучение генератора» — неявные
    // сигналы читаются только в паре с ценой, и эта пара обязана быть
    // честной). resolveVote() в движке начисляет/списывает у отвечавшего
    // именно auctionHighestBid, а не question.price — история пишет то же
    // число.
    //
    // Вырожденный случай: если аукцион закрылся без единой ставки (все
    // счётчики спасовали по кругу, не сделав хода — engine.ts,
    // afterBidOrPass(), active.length === 0), auctionHighestBidBefore
    // остаётся 0 — это не цена, а просто «никто не платил». Ноль в колонке
    // price увёл бы генератор в ложный вывод «вопрос ничего не стоил»,
    // поэтому в этом случае пишется номинал пакета — так же, как для
    // обычного вопроса.
    const price =
      question.type === 'аукцион'
        ? auctionHighestBidBefore > 0
          ? auctionHighestBidBefore
          : question.price
        : question.price;
    const row: PlayedQuestionInput = {
      questionId: question.id,
      roundIndex: roundIndexBefore,
      themeName,
      price,
      type: question.type,
      text: question.text,
      answer: question.answer,
      answeredBy: buzzedBefore === null ? null : this.nameOf(buzzedBefore),
      answeredByCounterId: buzzedBefore,
      correct: buzzedBefore === null || delta === 0 ? null : delta > 0,
      // Спорным считается несогласие голосующих между собой. При ведущем
      // голосования нет вовсе — тогда null, а не false: «не было спора» и
      // «не было голосования» это разные вещи, и слайс B не должен их путать.
      contested:
        hostIdBefore !== null || voteValues.length === 0
          ? null
          : voteValues.some((v) => v !== voteValues[0]),
    };
    this.history.recordQuestion(gameId, row);
  }

  // Финальный вопрос не проходит через answeredQuestionIds — он вообще не из
  // сетки раундов. Отвечают его все сразу и каждый со своей ставкой, поэтому
  // персональных полей у строки нет: для антиповтора важны текст и ответ, а
  // разбор вердиктов по игрокам — это уже слайс B/D.
  private recordFinalQuestion(state: EngineState): void {
    if (this.historyGameId === null) return;
    const gameId = this.historyGameId;
    const themeIndex = state.finalThemeIndex;
    if (themeIndex === null) return;
    const theme = state.pack.final?.themes[themeIndex];
    if (!theme) return;
    this.history.recordQuestion(gameId, {
      questionId: theme.question.id,
      roundIndex: -1,
      themeName: theme.name,
      price: 0,
      type: 'финал',
      text: theme.question.text,
      answer: theme.question.answer,
      answeredBy: null,
      answeredByCounterId: null,
      correct: null,
      contested: null,
    });
  }

  private nameOf(participantId: string): string | null {
    return this.participants.find((p) => p.id === participantId)?.name ?? null;
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
