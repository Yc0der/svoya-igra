// server/src/room.ts
import { randomUUID } from 'node:crypto';
import {
  createInitialState,
  reduce,
  QUESTION_TIMER_MS,
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

// Сколько секунд ответивший неверно не может нажать повторно — не игровое
// правило движка (тот вообще не знает, кто и когда переоткрыл вопрос), а
// транспортное ограничение Комнаты, тем же паттерном, что и фальстарт
// (design.md, «Комната», «СУДЕЙСТВО», 2026-08-05). Идёт **параллельно** с
// возобновившимся отсчётом вопроса, а не перед ним — общее время на вопрос
// от этого не растёт.
const GRACE_EXCLUSION_MS = 5_000;

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

  constructor(
    initial?: RoomState,
    pack?: Pack,
    lan?: LanInfo,
    initialPackFilename?: string,
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
    const counterIds = counters.map((p) => p.id);
    this.game = createInitialState(this.pack, counterIds, hostId);
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

  selectQuestion(
    participantId: string,
    themeIndex: number,
    questionId: string,
  ): void {
    this.dispatch({
      type: 'select-question',
      counterId: participantId,
      themeIndex,
      questionId,
    });
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

  getState(): RoomState {
    return {
      participants: this.participants.map((p) => ({ ...p })),
      game: this.game ? { ...this.game } : null,
      hostParticipantId: this.hostParticipantId,
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
      currentQuestion: currentQuestionData
        ? { text: currentQuestionData.text, price: currentQuestionData.price }
        : null,
      buzzedParticipantId: game.buzzedCounterId,
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

  private stillGraceExcluded(): boolean {
    return (
      this.graceExcludedUntil !== null && Date.now() < this.graceExcludedUntil
    );
  }

  private dispatch(event: EngineEvent): void {
    if (!this.game) return;
    const buzzedBefore = this.game.buzzedCounterId;
    const phaseBefore = this.game.phase;
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
        this.gameTimerDeadline = Date.now() + ms;
        this.gameTimeoutHandle = setTimeout(() => {
          this.dispatch({ type: 'timer-expired', timer: effect.timer });
        }, ms);
      }
    }
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
