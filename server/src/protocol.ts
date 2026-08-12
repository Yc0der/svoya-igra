import type { Phase } from './engine.js';
import type { LanCandidate } from './network.js';
import type { PackSummary } from './packs.js';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export interface GameStateView {
  phase: Phase;
  // Замороженный на время партии ведущий, НЕ то же самое, что лобби-флаг
  // StateMessage.hostParticipantId (см. Room.toGameStateView).
  hostId: string | null;
  roundIndex: number;
  grid: {
    themeName: string;
    questions: { id: string; price: number; answered: boolean }[];
  }[];
  turnParticipantId: string;
  currentQuestion: { text: string; price: number } | null;
  buzzedParticipantId: string | null;
  // Не null только для вопроса-«кота», пока фаза question-open/buzzed/
  // judging — единственный, кому в этот момент можно жать «Ответ» (см.
  // Room.toGameStateView).
  catRecipientParticipantId: string | null;
  // На judging непустой только для одного получателя за раз: при
  // hostParticipantId === null — для всех (двое, открытое судейство), иначе
  // — только для сокета с этим participantId (см. Room.toGameStateView).
  correctAnswer: { text: string; comment?: string } | null;
  // Не секрет ни от кого (в отличие от correctAnswer), одинаковы для всех
  // получателей. Не поле движка — Room-состояние (design.md, «СУДЕЙСТВО»,
  // 2026-08-05: временное исключение после неверного ответа — транспортное
  // ограничение, как фальстарт, не игровое правило). graceExcludedUntil —
  // ОТДЕЛЬНЫЙ от timerDeadline дедлайн: исключение идёт параллельно с уже
  // возобновившимся отсчётом вопроса, а не вместо него, поэтому у них разные
  // числа и client должен показывать оба независимо.
  graceExcludedParticipantId: string | null;
  graceExcludedUntil: number | null;
  timerDeadline: number | null;
  scores: { participantId: string; score: number }[];
  finalThemes: { name: string; eliminated: boolean }[] | null;
  finalElimParticipantId: string | null;
  finalQuestion: { text: string } | null;
  // Персональные поля, как correctAnswer: обычному игроку — только его
  // собственная запись (или пустой массив, пока не отправил); ведущему на
  // final-judging и всем на final-reveal — все (см. Room.toGameStateView).
  finalWagers: { participantId: string; amount: number }[] | null;
  finalAnswers: { participantId: string; text: string }[] | null;
  finalVerdicts: { participantId: string; correct: boolean }[] | null;
  // Тот же принцип видимости, что и у showAllFinal (см. finalWagers выше):
  // ведущему на final-judging, всем на final-reveal, иначе null.
  finalCorrectAnswer: { text: string; comment?: string } | null;
}

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'reconnect'; token: string }
  | { type: 'start-game' }
  | { type: 'toggle-host' }
  | { type: 'select-question'; themeIndex: number; questionId: string }
  | { type: 'assign-cat'; recipientParticipantId: string }
  | { type: 'buzz' }
  | { type: 'said-answer' }
  | { type: 'vote'; correct: boolean }
  // Панель ведущего — сервер сам проверяет, что отправитель и есть hostId,
  // клиентскому participantId в поле не доверяет.
  | { type: 'adjust-score'; participantId: string; delta: number }
  | { type: 'cancel-question' }
  // Сбрасывает текущую партию в пустое лобби — см. Room.resetGame().
  | { type: 'reset-game' }
  | { type: 'eliminate-final-theme'; themeIndex: number }
  | { type: 'submit-wager'; amount: number }
  | { type: 'submit-final-answer'; text: string }
  | { type: 'final-vote'; participantId: string; correct: boolean }
  // Админ-панель (design.md, «Админ-панель») — отдельный тип сообщений, не
  // привязанный к участнику: сокет админки не присоединяется к комнате
  // (никогда не шлёт 'join'), поэтому эти сообщения сервер обрабатывает без
  // поиска в connections/participants, в отличие от всего выше.
  | { type: 'admin-start-game' }
  | { type: 'admin-reset-game' }
  | { type: 'admin-reset-room' }
  | { type: 'admin-kick'; participantId: string }
  | { type: 'admin-set-host'; participantId: string | null }
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в engine.ts.
  | { type: 'admin-skip-to-final' }
  // Ловушка «Выбор локального IP на Windows» (svoya-igra-dev) — человек
  // выбирает из реально найденных кандидатов вместо угадывания сервером.
  | { type: 'admin-set-lan-address'; address: string }
  // Выбор пакета — от участника (сервер сверяет отправителя с
  // hostParticipantId) и с админ-панели (без проверки личности), тем же
  // способом, каким уже разделены skip-to-final/admin-skip-to-final.
  | { type: 'refresh-packs' }
  | { type: 'select-pack'; filename: string }
  | { type: 'admin-refresh-packs' }
  | { type: 'admin-select-pack'; filename: string };

export type StartGameErrorReason =
  | 'not-enough-players'
  | 'no-pack'
  | 'game-in-progress'
  | 'host-required'
  | 'host-only';

export type ServerMessage =
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
      // Живой, не разовый: пересчитывается на каждой рассылке (server.ts,
      // stateMessageFor) из room.getLanInfo(), а не отправляется один раз
      // при подключении — иначе уже подключённые табло/админка не увидели
      // бы смену адреса, выбранную через admin-set-lan-address.
      lanUrl: string;
      lanCandidates: LanCandidate[];
      // Живые, как lanUrl/lanCandidates — пересчитываются на каждой
      // рассылке из room.getPackInfo(), видны всем подключённым, но
      // действовать (refresh-packs/select-pack) могут только ведущий и
      // админка.
      availablePacks: PackSummary[];
      activePackFilename: string | null;
    }
  | { type: 'falsestart' }
  | { type: 'start-game-error'; reason: StartGameErrorReason }
  // Попытка select-pack/admin-select-pack на файл, ставший невалидным или
  // исчезнувший между обновлением списка и выбором.
  | { type: 'select-pack-error'; reason: 'unknown-file' };
