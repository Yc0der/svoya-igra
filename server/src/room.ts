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
  type EngineState,
  type EngineEvent,
  type Effect,
  type Phase,
  type TimerName,
} from './engine.js';
import type { Pack } from './pack.js';
import type { GameStateView } from './protocol.js';

export interface Participant {
  id: string;
  name: string;
  token: string;
  connected: boolean;
}

export interface RoomState {
  participants: Participant[];
  game: EngineState | null;
}

export type JoinResult = { participant: Participant } | { error: 'name-taken' };
export type ReconnectResult =
  { participant: Participant } | { error: 'invalid-token' };
export type StartGameResult =
  { ok: true } | { error: 'not-enough-players' | 'no-pack' };

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
};

export class Room {
  private participants: Participant[];
  private pack: Pack | undefined;
  private game: EngineState | null;
  private gameTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private gameTimerDeadline: number | null = null;
  private listeners = new Set<(state: RoomState) => void>();

  constructor(initial?: RoomState, pack?: Pack) {
    this.participants = initial
      ? initial.participants.map((p) => ({ ...p }))
      : [];
    this.pack = pack;
    this.game = initial?.game ? { ...initial.game } : null;
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

  startGame(): StartGameResult {
    if (!this.pack) {
      return { error: 'no-pack' };
    }
    // Только подключённые сейчас участники становятся счётчиками. Тот, кто
    // зашёл в лобби и ушёл (закрыл вкладку) до начала игры, не должен
    // остаться фантомным счётчиком с шансом на первый ход наравне с теми,
    // кто реально играет — он не участвует, и «минимум два игрока» тоже
    // должен считаться от реально присутствующих, а не от всех, кто когда-то
    // заходил за время жизни процесса.
    const present = this.participants.filter((p) => p.connected);
    if (present.length < 2) {
      return { error: 'not-enough-players' };
    }
    const counterIds = present.map((p) => p.id);
    this.game = createInitialState(this.pack, counterIds);
    this.notify();
    return { ok: true };
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
    this.dispatch({ type: 'buzz', counterId: participantId });
    return 'ok';
  }

  saidAnswer(participantId: string): void {
    this.dispatch({ type: 'said-answer', counterId: participantId });
  }

  vote(participantId: string, correct: boolean): void {
    this.dispatch({ type: 'vote', counterId: participantId, correct });
  }

  getState(): RoomState {
    return {
      participants: this.participants.map((p) => ({ ...p })),
      game: this.game ? { ...this.game } : null,
    };
  }

  toGameStateView(): GameStateView | null {
    if (!this.game) return null;
    const game = this.game;
    const round = game.pack.rounds[game.roundIndex];
    const currentQuestionData = game.currentQuestion
      ? round.themes[game.currentQuestion.themeIndex].questions.find(
          (q) => q.id === game.currentQuestion!.questionId,
        )
      : undefined;

    const showAnswer = game.phase === 'judging' || game.phase === 'reveal';

    return {
      phase: game.phase,
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
    };
  }

  onChange(listener: (state: RoomState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private dispatch(event: EngineEvent): void {
    if (!this.game) return;
    const { state, effects } = reduce(this.game, event);
    this.game = state;
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
        this.gameTimerDeadline = Date.now() + effect.ms;
        this.gameTimeoutHandle = setTimeout(() => {
          this.dispatch({ type: 'timer-expired', timer: effect.timer });
        }, effect.ms);
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
