import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Player } from './Player';
import { useRoomConnection } from './useRoomConnection';
import type { GameStateView, RoomConnection } from './useRoomConnection';

vi.mock('./useRoomConnection', () => ({
  useRoomConnection: vi.fn(),
}));

const mockedUseRoomConnection = vi.mocked(useRoomConnection);

function baseGame(overrides: Partial<GameStateView> = {}): GameStateView {
  return {
    phase: 'selecting',
    hostId: null,
    roundIndex: 0,
    grid: [],
    turnParticipantId: '',
    currentQuestion: null,
    questionTags: null,
    buzzedParticipantId: null,
    exclusiveAnswererParticipantId: null,
    auctionTurnParticipantId: null,
    auctionHighestBid: null,
    auctionHighestBidderParticipantId: null,
    auctionPassedParticipantIds: null,
    correctAnswer: null,
    graceExcludedParticipantId: null,
    graceExcludedUntil: null,
    timerDeadline: null,
    scores: [],
    finalThemes: null,
    finalElimParticipantId: null,
    finalQuestion: null,
    finalWagers: null,
    finalAnswers: null,
    finalVerdicts: null,
    finalCorrectAnswer: null,
    ...overrides,
  };
}

function connection(overrides: Partial<RoomConnection> = {}): RoomConnection {
  return {
    status: 'joined',
    participants: [],
    selfId: null,
    lanUrl: null,
    game: null,
    falsestart: false,
    selectQuestionBlocked: false,
    hostParticipantId: null,
    isHost: false,
    startGameError: null,
    join: vi.fn(),
    startGame: vi.fn(),
    toggleHost: vi.fn(),
    selectQuestion: vi.fn(),
    placeBid: vi.fn(),
    passBid: vi.fn(),
    assignCat: vi.fn(),
    buzz: vi.fn(),
    tagQuestion: vi.fn(),
    mediaFinished: vi.fn(),
    saidAnswer: vi.fn(),
    vote: vi.fn(),
    adjustScore: vi.fn(),
    cancelQuestion: vi.fn(),
    resetGame: vi.fn(),
    eliminateFinalTheme: vi.fn(),
    submitWager: vi.fn(),
    submitFinalAnswer: vi.fn(),
    finalVote: vi.fn(),
    availablePacks: [],
    activePackFilename: null,
    selectPackError: null,
    refreshPacks: vi.fn(),
    selectPack: vi.fn(),
    ...overrides,
  };
}

function renderPlayer(
  game: Partial<GameStateView>,
  conn: Partial<RoomConnection> = {},
): void {
  mockedUseRoomConnection.mockReturnValue(
    connection({ selfId: 'p1', game: baseGame(game), ...conn }),
  );
  render(<Player />);
}

describe('Player', () => {
  it('calls join with the entered name on submit', async () => {
    const join = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        status: 'connecting',
        join,
      }),
    );

    const user = userEvent.setup();
    render(<Player />);
    await user.type(screen.getByLabelText('Имя'), 'Ваня');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(join).toHaveBeenCalledWith('Ваня');
  });

  it('shows a message once joined instead of the form', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        status: 'joined',
        selfId: 'p1',
      }),
    );

    render(<Player />);

    expect(screen.getByText('Ты в игре. Жди начала.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument();
  });

  it('shows an error when the name is taken', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        status: 'name-taken',
      }),
    );

    render(<Player />);

    expect(screen.getByRole('alert')).toHaveTextContent('уже занято');
  });

  it('shows a start-game button in the lobby once joined, before any game exists', () => {
    mockedUseRoomConnection.mockReturnValue(connection({ game: null }));
    render(<Player />);
    expect(
      screen.getByRole('button', { name: /начать игру/i }),
    ).toBeInTheDocument();
  });

  it('calls startGame when the lobby button is clicked', async () => {
    const startGame = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({ game: null, startGame }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: /начать игру/i }));
    expect(startGame).toHaveBeenCalledOnce();
  });

  it('calls toggleHost when the lobby host button is clicked', async () => {
    const toggleHost = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({ game: null, toggleHost }),
    );
    render(<Player />);
    await userEvent.click(
      screen.getByRole('button', { name: /стать ведущим/i }),
    );
    expect(toggleHost).toHaveBeenCalledOnce();
  });

  it('shows who is currently host to everyone else, and marks it for the host themselves', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: null,
        selfId: 'me',
        participants: [{ id: 'host-id', name: 'Петя', connected: true }],
        hostParticipantId: 'host-id',
      }),
    );
    render(<Player />);
    expect(screen.getByText(/ведущий: Петя/i)).toBeInTheDocument();
  });

  it('hides the start-game button from anyone but the marked host once a host is designated', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: null,
        selfId: 'me',
        isHost: false,
        participants: [{ id: 'host-id', name: 'Петя', connected: true }],
        hostParticipantId: 'host-id',
      }),
    );
    render(<Player />);
    expect(
      screen.queryByRole('button', { name: /начать игру/i }),
    ).not.toBeInTheDocument();
  });

  it('still shows the start-game button to the marked host once one is designated', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: null,
        selfId: 'host-id',
        isHost: true,
        participants: [{ id: 'host-id', name: 'Петя', connected: true }],
        hostParticipantId: 'host-id',
      }),
    );
    render(<Player />);
    expect(
      screen.getByRole('button', { name: /начать игру/i }),
    ).toBeInTheDocument();
  });

  it("shows a translated error and doesn't crash when start-game fails", () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({ game: null, startGameError: 'host-required' }),
    );
    render(<Player />);
    expect(screen.getByRole('alert')).toHaveTextContent(/нужен ведущий/i);
  });

  it('does not show the pack picker in the lobby when not the host', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: null,
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
      }),
    );
    render(<Player />);
    expect(screen.queryByText('Пак А')).not.toBeInTheDocument();
  });

  it('shows the pack picker in the lobby when the host', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        game: null,
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: 'Описание' },
        ],
        activePackFilename: 'a.json',
      }),
    );
    render(<Player />);
    expect(screen.getByText('Пак А')).toBeInTheDocument();
    expect(screen.getByText('Описание')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Пак А/ })).toBeDisabled();
  });

  it('calls selectPack when the host picks a different pack', async () => {
    const selectPack = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        game: null,
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
          { filename: 'b.json', title: 'Пак Б', description: null },
        ],
        activePackFilename: 'a.json',
        selectPack,
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: /Пак Б/ }));
    expect(selectPack).toHaveBeenCalledWith('b.json');
  });

  it('calls refreshPacks when the host clicks "Обновить" in the lobby', async () => {
    const refreshPacks = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        game: null,
        refreshPacks,
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(refreshPacks).toHaveBeenCalledOnce();
  });

  it('shows the question grid when it is my turn to select', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          turnParticipantId: 'me',
          grid: [
            {
              themeName: 'Тема',
              questions: [{ id: 'q1', price: 100, answered: false }],
            },
          ],
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByRole('button', { name: /100/ })).toBeInTheDocument();
  });

  it('sizes the grid to the actual number of questions per theme, not a hardcoded count', () => {
    // Та же регрессия, что и в Board.test.tsx: сетка была захардкожена на
    // 4 цены в теме, а генератор пакетов (Веха 3) делает по 5.
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          turnParticipantId: 'me',
          grid: [
            {
              themeName: 'Тема',
              questions: [
                { id: 'q1', price: 100, answered: false },
                { id: 'q2', price: 200, answered: false },
                { id: 'q3', price: 300, answered: false },
                { id: 'q4', price: 400, answered: false },
                { id: 'q5', price: 500, answered: false },
              ],
            },
          ],
        }),
      }),
    );
    render(<Player />);
    const grid = document.querySelector('.player-grid') as HTMLElement;
    expect(grid.style.getPropertyValue('--price-columns')).toBe('5');
  });

  it("shows whose turn it is by name when it isn't mine", () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [{ id: 'other', name: 'Катя', connected: true }],
        game: baseGame({ turnParticipantId: 'other' }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/сейчас выбирает Катя/i)).toBeInTheDocument();
  });

  it('calls selectQuestion with the right ids when a grid cell is clicked', async () => {
    const selectQuestion = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        selectQuestion,
        game: baseGame({
          turnParticipantId: 'me',
          grid: [
            {
              themeName: 'Тема',
              questions: [{ id: 'q1', price: 100, answered: false }],
            },
          ],
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: /100/ }));
    expect(selectQuestion).toHaveBeenCalledWith(0, 'q1');
  });

  it('offers no buzz button while the clip is still playing — everyone watches it through first', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-media',
          timerDeadline: Date.now() + 45000,
        }),
      }),
    );
    render(<Player />);
    expect(
      screen.queryByRole('button', { name: /^ответ$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/идёт ролик/i)).toBeInTheDocument();
    // Отсчёт на экране — это страховочный таймер медиа, а не время на ответ.
    expect(screen.queryByText(/^\d+с$/)).not.toBeInTheDocument();
  });

  it('offers no buzz button while the question text is still being revealed', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-reveal',
          timerDeadline: Date.now() + 1600,
        }),
      }),
    );
    render(<Player />);
    expect(
      screen.queryByRole('button', { name: /^ответ$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/читаем вопрос/i)).toBeInTheDocument();
  });

  it('shows the buzz button while the question is open', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({ game: baseGame({ phase: 'question-open' }) }),
    );
    render(<Player />);
    expect(
      screen.getByRole('button', { name: /^ответ$/i }),
    ).toBeInTheDocument();
  });

  it('shows a countdown while the question is open', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-open',
          timerDeadline: Date.now() + 12000,
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/^\d+с$/)).toBeInTheDocument();
  });

  it('does not show a buzz button to the host while the question is open — the host is not a counter', async () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        game: baseGame({ phase: 'question-open' }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(
      screen.queryByRole('button', { name: /^ответ$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/ждём, кто нажмёт/i)).toBeInTheDocument();
  });

  it('disables the buzz button and explains why for the just-excluded answerer during reopen grace, using its own countdown', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'question-open',
          graceExcludedParticipantId: 'me',
          // Два независимых дедлайна: общий отсчёт вопроса (уже
          // возобновившийся, идёт параллельно) и личная блокировка — они
          // намеренно разные числа здесь, чтобы тест не мог случайно
          // пройти при перепутанном дедлайне.
          timerDeadline: Date.now() + 20_000,
          graceExcludedUntil: Date.now() + 4_000,
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByRole('button', { name: /^ответ$/i })).toBeDisabled();
    expect(screen.getByText(/уже пробовал.*4с/i)).toBeInTheDocument();
    // Общий отсчёт вопроса тоже показан, отдельно и с другим числом.
    expect(screen.getByText('20с')).toBeInTheDocument();
  });

  it('keeps the buzz button enabled for everyone else during another player’s reopen grace', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'question-open',
          graceExcludedParticipantId: 'other',
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByRole('button', { name: /^ответ$/i })).toBeEnabled();
  });

  it('disables the buzz button for 2 seconds after a falsestart', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({ phase: 'question-open' }),
        falsestart: true,
      }),
    );
    render(<Player />);
    expect(screen.getByRole('button', { name: /^ответ$/i })).toBeDisabled();
  });

  it('shows a toast explaining why a question could not be selected, without naming the reason as a cat question', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({ phase: 'selecting', turnParticipantId: 'me' }),
        selectQuestionBlocked: true,
      }),
    );
    render(<Player />);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent(/не хватает игроков онлайн/i);
    expect(toast).not.toHaveTextContent(/кот/i);
  });

  it('shows a list of online participants to pick a cat recipient from, when it is my turn', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
          { id: 'offline', name: 'Оффлайн', connected: false },
        ],
        game: baseGame({
          phase: 'cat-handoff',
          turnParticipantId: 'me',
          scores: [
            { participantId: 'me', score: 0 },
            { participantId: 'other', score: 0 },
          ],
        }),
      }),
    );
    render(<Player />);
    expect(
      screen.getByRole('button', { name: 'Соперник' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Оффлайн' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Я' })).not.toBeInTheDocument();
  });

  it('calls assignCat with the chosen recipient', async () => {
    const assignCat = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
        ],
        game: baseGame({
          phase: 'cat-handoff',
          turnParticipantId: 'me',
          scores: [
            { participantId: 'me', score: 0 },
            { participantId: 'other', score: 0 },
          ],
        }),
        assignCat,
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Соперник' }));
    expect(assignCat).toHaveBeenCalledWith('other');
  });

  it('shows a waiting message to everyone else during cat-handoff', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'other',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
        ],
        game: baseGame({ phase: 'cat-handoff', turnParticipantId: 'me' }),
      }),
    );
    render(<Player />);
    expect(
      screen.getByText(/я выбирает, кому отдать кота/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Соперник' }),
    ).not.toBeInTheDocument();
  });

  it('hides the buzz button and shows who has the cat, for a non-recipient during a cat question', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'recipient', name: 'Получатель', connected: true },
        ],
        game: baseGame({
          phase: 'question-open',
          exclusiveAnswererParticipantId: 'recipient',
        }),
      }),
    );
    render(<Player />);
    expect(
      screen.queryByRole('button', { name: /^ответ$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/право ответа у получатель/i)).toBeInTheDocument();
  });

  it('shows the normal buzz button to the cat recipient', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'recipient',
        game: baseGame({
          phase: 'question-open',
          exclusiveAnswererParticipantId: 'recipient',
        }),
      }),
    );
    render(<Player />);
    expect(
      screen.getByRole('button', { name: /^ответ$/i }),
    ).toBeInTheDocument();
  });

  it('shows the cancel-question button to the host during cat-handoff', async () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        game: baseGame({ phase: 'cat-handoff', hostId: 'host-id' }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(
      screen.getByRole('button', { name: 'Отменить вопрос' }),
    ).toBeInTheDocument();
  });

  it('shows the question theme and price while picking a cat recipient', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
        ],
        game: baseGame({
          phase: 'cat-handoff',
          turnParticipantId: 'me',
          currentQuestion: { text: null, price: 300, themeName: 'История' },
          scores: [
            { participantId: 'me', score: 0 },
            { participantId: 'other', score: 0 },
          ],
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/история за 300/i)).toBeInTheDocument();
  });

  it('shows the question theme and price to everyone else waiting during cat-handoff', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'other',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
        ],
        game: baseGame({
          phase: 'cat-handoff',
          turnParticipantId: 'me',
          currentQuestion: { text: null, price: 300, themeName: 'История' },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/история за 300/i)).toBeInTheDocument();
  });

  it('shows the question theme and price to the cat recipient alongside the buzz button', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'recipient',
        game: baseGame({
          phase: 'question-open',
          exclusiveAnswererParticipantId: 'recipient',
          currentQuestion: {
            text: 'Вопрос-кот?',
            price: 300,
            themeName: 'История',
          },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/история за 300/i)).toBeInTheDocument();
  });

  it('shows the question theme and price to a non-recipient waiting during a cat question', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'recipient', name: 'Получатель', connected: true },
        ],
        game: baseGame({
          phase: 'question-open',
          exclusiveAnswererParticipantId: 'recipient',
          currentQuestion: {
            text: 'Вопрос-кот?',
            price: 300,
            themeName: 'История',
          },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/история за 300/i)).toBeInTheDocument();
  });

  it('does not show a theme/price for an ordinary (non-cat) question-open', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'question-open',
          exclusiveAnswererParticipantId: null,
          currentQuestion: {
            text: 'Обычный вопрос?',
            price: 300,
            themeName: 'История',
          },
        }),
      }),
    );
    render(<Player />);
    expect(screen.queryByText(/история за 300/i)).not.toBeInTheDocument();
  });

  it('prompts the buzzed player to say the answer aloud and confirm', async () => {
    const saidAnswer = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        saidAnswer,
        game: baseGame({ phase: 'buzzed', buzzedParticipantId: 'me' }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/скажи ответ вслух/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /я ответил/i }));
    expect(saidAnswer).toHaveBeenCalledOnce();
  });

  it('shows the answering opponent by name to everyone else', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [{ id: 'other', name: 'Катя', connected: true }],
        game: baseGame({ phase: 'buzzed', buzzedParticipantId: 'other' }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/Катя отвечает/i)).toBeInTheDocument();
  });

  it('shows judging buttons for everyone except the answerer', async () => {
    const vote = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        vote,
        game: baseGame({ phase: 'judging', buzzedParticipantId: 'other' }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: /^зачёт$/i }));
    expect(vote).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: /^незачёт$/i }));
    expect(vote).toHaveBeenCalledWith(false);
  });

  it('does not show judging buttons to the answerer themselves, showing a waiting message instead', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({ phase: 'judging', buzzedParticipantId: 'me' }),
      }),
    );
    render(<Player />);
    expect(
      screen.queryByRole('button', { name: /^зачёт$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/ждём решения/i)).toBeInTheDocument();
  });

  it('marks the clicked vote with a visible confirmation, in open-mode judging', async () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({ phase: 'judging', buzzedParticipantId: 'other' }),
      }),
    );
    render(<Player />);
    const yesButton = screen.getByRole('button', { name: /^зачёт/i });
    expect(yesButton).not.toHaveTextContent('✓');
    await userEvent.click(yesButton);
    expect(yesButton).toHaveTextContent('✓');
    expect(screen.getByText(/голос принят/i)).toBeInTheDocument();
  });

  it('shows the answer and judging buttons only to the host during host-mode judging', async () => {
    const vote = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        vote,
        game: baseGame({
          phase: 'judging',
          buzzedParticipantId: 'other',
          correctAnswer: { text: 'Ответ' },
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.getByText('Ответ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^зачёт$/i }));
    expect(vote).toHaveBeenCalledWith(true);
  });

  it("highlights the host's own verdict during host-mode judging, so a click is visibly registered", async () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        vote: vi.fn(),
        game: baseGame({
          phase: 'judging',
          buzzedParticipantId: 'other',
          correctAnswer: { text: 'Ответ' },
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    const yes = screen.getByRole('button', { name: /^зачёт/i });
    const no = screen.getByRole('button', { name: /^незачёт/i });
    expect(yes).not.toHaveClass('is-selected');

    await userEvent.click(yes);
    expect(yes).toHaveClass('is-selected');
    expect(no).not.toHaveClass('is-selected');
  });

  it('shows a waiting-for-host message, without the answer, to non-host players during host-mode judging', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        isHost: false,
        hostParticipantId: 'host-id',
        game: baseGame({
          phase: 'judging',
          buzzedParticipantId: 'other',
          correctAnswer: null,
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/ждём решения ведущего/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /зачёт/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the reveal result, comment, and updated scores by name', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        participants: [{ id: 'me', name: 'Ваня', connected: true }],
        game: baseGame({
          phase: 'reveal',
          correctAnswer: { text: 'Ответ', comment: 'Комментарий' },
          scores: [{ participantId: 'me', score: 100 }],
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText('Ответ')).toBeInTheDocument();
    expect(screen.getByText('Комментарий')).toBeInTheDocument();
    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('shows the intermediate score by name at round-end', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        participants: [{ id: 'me', name: 'Ваня', connected: true }],
        game: baseGame({
          phase: 'round-end',
          scores: [{ participantId: 'me', score: 100 }],
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/следующий раунд/i)).toBeInTheDocument();
    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('показывает пальцы, когда окно оценки открыто, и шлёт оценку', async () => {
    const tagQuestion = vi.fn();
    renderPlayer(
      { phase: 'reveal', questionTags: { up: 0, down: 0, mine: null } },
      { tagQuestion },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Понравился' }));

    expect(tagQuestion).toHaveBeenCalledWith('up');
  });

  it('подсвечивает уже поставленную оценку', () => {
    renderPlayer({
      phase: 'reveal',
      questionTags: { up: 1, down: 0, mine: 'up' },
    });

    expect(screen.getByRole('button', { name: 'Понравился' })).toHaveClass(
      'is-selected',
    );
  });

  it('не показывает пальцы, когда окно закрыто', () => {
    renderPlayer({ phase: 'question-open', questionTags: null });

    expect(
      screen.queryByRole('button', { name: 'Понравился' }),
    ).not.toBeInTheDocument();
  });

  it('не показывает пальцы тому, кто сейчас выбирает вопрос', () => {
    // «Выбирает сейчас» — это turnParticipantId === selfId; отдельного поля
    // isMyTurn в GameStateView нет, Player.tsx выводит его сам.
    renderPlayer({
      phase: 'selecting',
      turnParticipantId: 'p1',
      questionTags: { up: 0, down: 0, mine: null },
    });

    expect(
      screen.queryByRole('button', { name: 'Понравился' }),
    ).not.toBeInTheDocument();
  });

  it('shows the final standings at game-end by name, not raw id', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'game-end',
          scores: [
            { participantId: 'me', score: 300 },
            { participantId: 'other', score: 100 },
          ],
        }),
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Другой', connected: true },
        ],
      }),
    );
    render(<Player />);
    expect(screen.getByText(/итог/i)).toBeInTheDocument();
    expect(screen.getByText('Я')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('Другой')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByText('me')).not.toBeInTheDocument();
  });

  it('offers a "new game" button at game-end that restarts, when nobody was marked host', async () => {
    const startGame = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        startGame,
        game: baseGame({ phase: 'game-end', scores: [] }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: /новая игра/i }));
    expect(startGame).toHaveBeenCalledOnce();
  });

  it('hides the "new game" button at game-end from anyone but the currently marked host', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'other',
        isHost: false,
        hostParticipantId: 'host-id',
        game: baseGame({ phase: 'game-end', hostId: 'host-id', scores: [] }),
      }),
    );
    render(<Player />);
    expect(
      screen.queryByRole('button', { name: /новая игра/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the "new game" button at game-end to the currently marked host', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        game: baseGame({ phase: 'game-end', hostId: 'host-id', scores: [] }),
      }),
    );
    render(<Player />);
    expect(
      screen.getByRole('button', { name: /новая игра/i }),
    ).toBeInTheDocument();
  });

  it("uses the LIVE lobby host flag, not the game's frozen hostId, so the button stays reachable even if the original host disconnected", () => {
    // Regression: room.startGame()'s authorization is based on the live
    // hostParticipantId lobby flag, which toggleHost() may still change even
    // at game-end (room.ts: «'game-end' — исключение»). A button gated on
    // the frozen game.hostId instead can end up hidden from literally
    // everyone currently connected, with no way to restart short of an
    // admin-panel reset.
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'someone-else',
        isHost: false, // isHost is derived from the frozen game.hostId
        hostParticipantId: 'someone-else', // but the lobby flag has moved on
        game: baseGame({
          phase: 'game-end',
          hostId: 'original-host-who-left',
          scores: [],
        }),
      }),
    );
    render(<Player />);
    expect(
      screen.getByRole('button', { name: /новая игра/i }),
    ).toBeInTheDocument();
  });

  it("shows the host admin panel with per-player score buttons, on top of the phase's own screen", async () => {
    const adjustScore = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        adjustScore,
        participants: [
          { id: 'p1', name: 'Ваня', connected: true },
          { id: 'p2', name: 'Катя', connected: true },
        ],
        game: baseGame({
          phase: 'selecting',
          turnParticipantId: 'p1',
          scores: [
            { participantId: 'p1', score: 100 },
            { participantId: 'p2', score: 0 },
          ],
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    // Фазовый экран (не мой ход) остаётся на месте.
    expect(screen.getByText(/сейчас выбирает Ваня/i)).toBeInTheDocument();
    // ...и панель управления показана поверх него.
    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();

    const minusButtons = screen.getAllByRole('button', { name: '−100' });
    await userEvent.click(minusButtons[0]);
    expect(adjustScore).toHaveBeenCalledWith('p1', -100);

    const plusButtons = screen.getAllByRole('button', { name: '+100' });
    await userEvent.click(plusButtons[1]);
    expect(adjustScore).toHaveBeenCalledWith('p2', 100);
  });

  it('does not show the host admin panel to a regular player', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        isHost: false,
        hostParticipantId: 'host-id',
        game: baseGame({ phase: 'selecting', turnParticipantId: 'other' }),
      }),
    );
    render(<Player />);
    expect(screen.queryByText('Управление')).not.toBeInTheDocument();
  });

  it('shows "cancel question" only while a question is actually open, not while merely selecting', async () => {
    const cancelQuestion = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        cancelQuestion,
        game: baseGame({ phase: 'selecting', turnParticipantId: 'p1' }),
      }),
    );
    const { rerender } = render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(
      screen.queryByRole('button', { name: /отменить вопрос/i }),
    ).not.toBeInTheDocument();

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        cancelQuestion,
        game: baseGame({ phase: 'question-open' }),
      }),
    );
    rerender(<Player />);
    await userEvent.click(
      screen.getByRole('button', { name: /отменить вопрос/i }),
    );
    expect(cancelQuestion).toHaveBeenCalledOnce();
  });

  it('final-elim: highlights my turn and eliminates a theme on click', async () => {
    const eliminateFinalTheme = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'self',
        eliminateFinalTheme,
        game: baseGame({
          phase: 'final-elim',
          finalThemes: [
            { name: 'Финал A', eliminated: false },
            { name: 'Финал B', eliminated: false },
          ],
          finalElimParticipantId: 'self',
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByText('Финал A'));
    expect(eliminateFinalTheme).toHaveBeenCalledWith(0);
  });

  it('final-elim: shows a countdown', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'self',
        game: baseGame({
          phase: 'final-elim',
          finalThemes: [{ name: 'Финал A', eliminated: false }],
          finalElimParticipantId: 'other',
          timerDeadline: Date.now() + 12000,
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/^\d+с$/)).toBeInTheDocument();
  });

  it('final-elim: shows whose turn it is when it is not mine', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'self',
        participants: [{ id: 'other', name: 'Катя', connected: true }],
        game: baseGame({
          phase: 'final-elim',
          finalThemes: [{ name: 'Финал A', eliminated: false }],
          finalElimParticipantId: 'other',
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/Катя/)).toBeInTheDocument();
  });

  it('final-wager: submits a clamped wager', async () => {
    const submitWager = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'self',
        submitWager,
        game: baseGame({
          phase: 'final-wager',
          finalThemes: [{ name: 'Финал A', eliminated: false }],
          scores: [{ participantId: 'self', score: 200 }],
        }),
      }),
    );
    render(<Player />);
    await userEvent.type(screen.getByLabelText('Ставка'), '150');
    await userEvent.click(screen.getByText('Готово'));
    expect(submitWager).toHaveBeenCalledWith(150);
  });

  it('final-wager: shows a confirmation instead of the form once my own wager is already submitted', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'self',
        game: baseGame({
          phase: 'final-wager',
          finalThemes: [{ name: 'Финал A', eliminated: false }],
          finalWagers: [{ participantId: 'self', amount: 150 }],
          timerDeadline: Date.now() + 8000,
        }),
      }),
    );
    render(<Player />);
    expect(screen.queryByLabelText('Ставка')).not.toBeInTheDocument();
    expect(
      screen.getByText(/ставка принята.*150.*ждём остальных/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^\d+с$/)).toBeInTheDocument();
  });

  it('final-wager: the host sees a waiting message, not a wager form', async () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host',
        isHost: true,
        hostParticipantId: 'host',
        game: baseGame({
          phase: 'final-wager',
          finalThemes: [{ name: 'Финал A', eliminated: false }],
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.queryByLabelText('Ставка')).not.toBeInTheDocument();
    expect(screen.getByText(/Игроки делают ставки/)).toBeInTheDocument();
  });

  it('final-answer: submits the typed answer', async () => {
    const submitFinalAnswer = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'self',
        submitFinalAnswer,
        game: baseGame({
          phase: 'final-answer',
          finalQuestion: { text: 'Вопрос финала?' },
        }),
      }),
    );
    render(<Player />);
    await userEvent.type(screen.getByLabelText('Ответ'), 'мой ответ');
    await userEvent.click(screen.getByText('Готово'));
    expect(submitFinalAnswer).toHaveBeenCalledWith('мой ответ');
  });

  it('final-answer: shows a confirmation instead of the form once my own answer is already submitted', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'self',
        game: baseGame({
          phase: 'final-answer',
          finalQuestion: { text: 'Вопрос финала?' },
          finalAnswers: [{ participantId: 'self', text: 'мой ответ' }],
        }),
      }),
    );
    render(<Player />);
    expect(screen.queryByLabelText('Ответ')).not.toBeInTheDocument();
    expect(
      screen.getByText(/ответ принят.*ждём остальных/i),
    ).toBeInTheDocument();
  });

  it('final-answer: the host sees a waiting message, not an answer form', async () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host',
        isHost: true,
        hostParticipantId: 'host',
        game: baseGame({
          phase: 'final-answer',
          finalQuestion: { text: 'Вопрос финала?' },
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.queryByLabelText('Ответ')).not.toBeInTheDocument();
    expect(screen.getByText(/Игроки пишут ответы/)).toBeInTheDocument();
  });

  it('final-judging: host sees every wager and answer with verdict buttons', async () => {
    const finalVote = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host',
        isHost: true,
        hostParticipantId: 'host',
        finalVote,
        participants: [
          { id: 'p1', name: 'Ваня', connected: true },
          { id: 'p2', name: 'Катя', connected: true },
        ],
        game: baseGame({
          phase: 'final-judging',
          finalWagers: [
            { participantId: 'p1', amount: 50 },
            { participantId: 'p2', amount: 20 },
          ],
          finalAnswers: [
            { participantId: 'p1', text: 'ответ 1' },
            { participantId: 'p2', text: 'ответ 2' },
          ],
          finalCorrectAnswer: { text: 'Правильный ответ', comment: 'Коммент' },
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.getByText('Правильный ответ')).toBeInTheDocument();
    expect(screen.getByText('Коммент')).toBeInTheDocument();
    const yesButtons = screen.getAllByText('Верно');
    await userEvent.click(yesButtons[0]);
    expect(finalVote).toHaveBeenCalledWith('p1', true);
  });

  it("final-judging: highlights each counter's own verdict independently, so a click is visibly registered", async () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host',
        isHost: true,
        hostParticipantId: 'host',
        finalVote: vi.fn(),
        participants: [
          { id: 'p1', name: 'Ваня', connected: true },
          { id: 'p2', name: 'Катя', connected: true },
        ],
        game: baseGame({
          phase: 'final-judging',
          finalWagers: [
            { participantId: 'p1', amount: 50 },
            { participantId: 'p2', amount: 20 },
          ],
          finalAnswers: [
            { participantId: 'p1', text: 'ответ 1' },
            { participantId: 'p2', text: 'ответ 2' },
          ],
        }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    const yesButtons = screen.getAllByRole('button', { name: /^верно/i });
    const noButtons = screen.getAllByRole('button', { name: /^неверно/i });

    // Отмечаем p1 верно, p2 неверно — каждая отметка независима от другой.
    await userEvent.click(yesButtons[0]);
    await userEvent.click(noButtons[1]);

    expect(yesButtons[0]).toHaveClass('is-selected');
    expect(noButtons[0]).not.toHaveClass('is-selected');
    expect(yesButtons[1]).not.toHaveClass('is-selected');
    expect(noButtons[1]).toHaveClass('is-selected');
  });

  it('final-judging: non-host waits, with a countdown', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'p1',
        hostParticipantId: 'host',
        game: baseGame({
          phase: 'final-judging',
          timerDeadline: Date.now() + 12000,
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/Ведущий проверяет/)).toBeInTheDocument();
    expect(screen.getByText(/^\d+с$/)).toBeInTheDocument();
  });

  it('final-reveal: does not show a countdown — it is a passive pause, not a timed decision', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'p1',
        game: baseGame({
          phase: 'final-reveal',
          finalWagers: [],
          finalAnswers: [],
          finalVerdicts: [],
          timerDeadline: Date.now() + 12000,
        }),
      }),
    );
    render(<Player />);
    expect(screen.queryByText(/^\d+с$/)).not.toBeInTheDocument();
  });

  it('final-reveal: shows wagers, answers, verdicts, the correct answer, and updated scores', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'p1',
        participants: [{ id: 'p1', name: 'Ваня', connected: true }],
        game: baseGame({
          phase: 'final-reveal',
          finalWagers: [{ participantId: 'p1', amount: 50 }],
          finalAnswers: [{ participantId: 'p1', text: 'ответ 1' }],
          finalVerdicts: [{ participantId: 'p1', correct: true }],
          finalCorrectAnswer: { text: 'Правильный ответ', comment: 'Коммент' },
          scores: [{ participantId: 'p1', score: 150 }],
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText('ответ 1')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Правильный ответ')).toBeInTheDocument();
    expect(screen.getByText('Коммент')).toBeInTheDocument();
  });

  describe('resume-choice prompt (avoids manually clearing server state to test)', () => {
    it('shows the host a resume-choice prompt when a game is already in progress on first render, e.g. restored from a snapshot after a restart', () => {
      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'host-id',
          isHost: true,
          game: baseGame({ phase: 'selecting', turnParticipantId: 'other' }),
        }),
      );
      render(<Player />);
      expect(screen.getByText('Незавершённая партия')).toBeInTheDocument();
      expect(screen.queryByText(/сейчас выбирает/i)).not.toBeInTheDocument();
    });

    it('does not show the prompt to non-host participants, even with a game already in progress', () => {
      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'me',
          isHost: false,
          game: baseGame({ phase: 'selecting', turnParticipantId: 'me' }),
        }),
      );
      render(<Player />);
      expect(
        screen.queryByText('Незавершённая партия'),
      ).not.toBeInTheDocument();
    });

    it('does not show the prompt for a game the host just started themselves in this same session', () => {
      mockedUseRoomConnection.mockReturnValue(
        connection({ selfId: 'host-id', isHost: true, game: null }),
      );
      const { rerender } = render(<Player />);

      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'host-id',
          isHost: true,
          game: baseGame({ phase: 'selecting', turnParticipantId: 'other' }),
        }),
      );
      rerender(<Player />);

      expect(
        screen.queryByText('Незавершённая партия'),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/сейчас выбирает/i)).toBeInTheDocument();
    });

    it('dismisses the prompt and shows the game once "Продолжить" is clicked', async () => {
      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'host-id',
          isHost: true,
          game: baseGame({ phase: 'selecting', turnParticipantId: 'other' }),
        }),
      );
      render(<Player />);
      await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
      expect(
        screen.queryByText('Незавершённая партия'),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/сейчас выбирает/i)).toBeInTheDocument();
    });

    it('resets the game on the server when "Новая игра" is clicked', async () => {
      const resetGame = vi.fn();
      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'host-id',
          isHost: true,
          resetGame,
          game: baseGame({ phase: 'selecting', turnParticipantId: 'other' }),
        }),
      );
      render(<Player />);
      await userEvent.click(screen.getByRole('button', { name: 'Новая игра' }));
      expect(resetGame).toHaveBeenCalledOnce();
    });

    it('does not show the prompt once the game has reached game-end — that screen offers its own "new game" button instead', () => {
      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'host-id',
          isHost: true,
          game: baseGame({ phase: 'game-end', scores: [] }),
        }),
      );
      render(<Player />);
      expect(
        screen.queryByText('Незавершённая партия'),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/итог/i)).toBeInTheDocument();
    });
  });

  it('shows the current bid and a form to place a higher one, when it is my turn to bid', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionTurnParticipantId: 'me',
          auctionHighestBid: 150,
          auctionHighestBidderParticipantId: 'other',
          currentQuestion: { text: null, price: 100, themeName: 'История' },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /поставить/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /пас/i })).toBeInTheDocument();
  });

  it('shows "no bids yet" when it is my turn and nobody has bid', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionTurnParticipantId: 'me',
          auctionHighestBid: 0,
          auctionHighestBidderParticipantId: null,
          currentQuestion: { text: null, price: 100, themeName: 'История' },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/ставок ещё не было/i)).toBeInTheDocument();
  });

  it('calls placeBid with the entered amount', async () => {
    const placeBid = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionTurnParticipantId: 'me',
          auctionHighestBid: 100,
          auctionHighestBidderParticipantId: 'other',
          currentQuestion: { text: null, price: 100, themeName: 'История' },
          // Повышение ставки ограничено собственным счётом — без него
          // кнопка «Поставить» справедливо заблокирована.
          scores: [{ participantId: 'me', score: 1000 }],
        }),
        placeBid,
      }),
    );
    render(<Player />);
    await userEvent.type(screen.getByLabelText(/ставка/i), '150');
    await userEvent.click(screen.getByRole('button', { name: /поставить/i }));
    expect(placeBid).toHaveBeenCalledWith(150);
  });

  // Регрессия (финальное ревью, 2026-08-14): кнопка была кликабельна всегда,
  // а недопустимая сумма молча оборачивалась no-op'ом на сервере.
  describe('валидация ставки на клиенте', () => {
    function biddingConnection(
      overrides: Partial<GameStateView> = {},
      score = 1000,
    ) {
      return connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionTurnParticipantId: 'me',
          auctionHighestBid: 150,
          auctionHighestBidderParticipantId: 'other',
          currentQuestion: { text: null, price: 100, themeName: 'История' },
          scores: [{ participantId: 'me', score }],
          ...overrides,
        }),
      });
    }

    it('disables the bid button while the input is empty', () => {
      mockedUseRoomConnection.mockReturnValue(biddingConnection());
      render(<Player />);
      expect(screen.getByRole('button', { name: /поставить/i })).toBeDisabled();
    });

    it('disables the bid button for an amount below the minimum raise', async () => {
      mockedUseRoomConnection.mockReturnValue(biddingConnection());
      render(<Player />);
      await userEvent.type(screen.getByLabelText(/ставка/i), '150');
      expect(screen.getByRole('button', { name: /поставить/i })).toBeDisabled();
    });

    it('disables the bid button for an amount above my own score', async () => {
      mockedUseRoomConnection.mockReturnValue(biddingConnection({}, 200));
      render(<Player />);
      await userEvent.type(screen.getByLabelText(/ставка/i), '201');
      expect(screen.getByRole('button', { name: /поставить/i })).toBeDisabled();
    });

    it('enables the bid button for a valid raise', async () => {
      mockedUseRoomConnection.mockReturnValue(biddingConnection());
      render(<Player />);
      await userEvent.type(screen.getByLabelText(/ставка/i), '151');
      expect(screen.getByRole('button', { name: /поставить/i })).toBeEnabled();
    });

    // «Дневной дубль» через интерфейс: у игрока 0 очков, ставок ещё не было —
    // ровно цену пакета поставить можно, хоть сколько-нибудь больше — нет.
    it('enables the bid button for exactly the pack price as a first bid, even with a score of 0', async () => {
      mockedUseRoomConnection.mockReturnValue(
        biddingConnection(
          {
            auctionHighestBid: 0,
            auctionHighestBidderParticipantId: null,
          },
          0,
        ),
      );
      render(<Player />);
      await userEvent.type(screen.getByLabelText(/ставка/i), '100');
      expect(screen.getByRole('button', { name: /поставить/i })).toBeEnabled();
    });

    it('disables the bid button above the pack price as a first bid with a score of 0', async () => {
      mockedUseRoomConnection.mockReturnValue(
        biddingConnection(
          {
            auctionHighestBid: 0,
            auctionHighestBidderParticipantId: null,
          },
          0,
        ),
      );
      render(<Player />);
      await userEvent.type(screen.getByLabelText(/ставка/i), '101');
      expect(screen.getByRole('button', { name: /поставить/i })).toBeDisabled();
    });
  });

  // Регрессия (финальное ревью, 2026-08-14): экран отвечающего показывал цену
  // с сетки, хотя вопрос, выигранный на торгах, стоит выигрышную ставку.
  it('shows the winning bid, not the pack price, on the exclusive answerer screen after an auction', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'question-open',
          exclusiveAnswererParticipantId: 'me',
          auctionHighestBid: 350,
          auctionHighestBidderParticipantId: 'me',
          currentQuestion: {
            text: 'Вопрос?',
            price: 100,
            themeName: 'История',
          },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/за 350/)).toBeInTheDocument();
    expect(screen.queryByText(/за 100/)).not.toBeInTheDocument();
  });

  it('still shows the pack price on the exclusive answerer screen for a cat question', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'question-open',
          exclusiveAnswererParticipantId: 'me',
          currentQuestion: {
            text: 'Вопрос?',
            price: 100,
            themeName: 'История',
          },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/за 100/)).toBeInTheDocument();
  });

  it('calls passBid when the pass button is clicked', async () => {
    const passBid = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionTurnParticipantId: 'me',
          currentQuestion: { text: null, price: 100, themeName: 'История' },
        }),
        passBid,
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: /^пас$/i }));
    expect(passBid).toHaveBeenCalledOnce();
  });

  it('shows a waiting message with the current bid to everyone else during bidding', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'other',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
        ],
        game: baseGame({
          phase: 'auction-bidding',
          auctionTurnParticipantId: 'me',
          auctionHighestBid: 150,
          auctionHighestBidderParticipantId: 'me',
          currentQuestion: { text: null, price: 100, themeName: 'История' },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/ждём.*я/i)).toBeInTheDocument();
    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /поставить/i }),
    ).not.toBeInTheDocument();
  });

  it('shows that I have passed, without a bid form, once I am out of the bidding', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
        ],
        game: baseGame({
          phase: 'auction-bidding',
          auctionTurnParticipantId: 'other',
          auctionPassedParticipantIds: ['me'],
          currentQuestion: { text: null, price: 100, themeName: 'История' },
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByText(/вы спасовали/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /поставить/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the cancel-question button to the host during auction-bidding', async () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        isHost: true,
        hostParticipantId: 'host-id',
        game: baseGame({ phase: 'auction-bidding', hostId: 'host-id' }),
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(
      screen.getByRole('button', { name: 'Отменить вопрос' }),
    ).toBeInTheDocument();
  });
});

describe('Player — уведомление о перебитой ставке', () => {
  it('shows a toast when my bid gets outbid during auction-bidding', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'me',
          auctionHighestBid: 150,
          auctionTurnParticipantId: 'other',
        }),
      }),
    );
    const { rerender } = render(<Player />);
    expect(screen.queryByText(/вашу ставку перебили/i)).not.toBeInTheDocument();

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
        ],
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'other',
          auctionHighestBid: 300,
          auctionTurnParticipantId: 'me',
        }),
      }),
    );
    rerender(<Player />);
    expect(
      screen.getByText(/вашу ставку перебили — соперник поставил 300/i),
    ).toBeInTheDocument();
  });

  it('hides the toast automatically after 4 seconds', () => {
    vi.useFakeTimers();
    try {
      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'me',
          game: baseGame({
            phase: 'auction-bidding',
            auctionHighestBidderParticipantId: 'me',
            auctionHighestBid: 150,
          }),
        }),
      );
      const { rerender } = render(<Player />);

      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'me',
          participants: [{ id: 'other', name: 'Соперник', connected: true }],
          game: baseGame({
            phase: 'auction-bidding',
            auctionHighestBidderParticipantId: 'other',
            auctionHighestBid: 300,
          }),
        }),
      );
      rerender(<Player />);
      expect(screen.getByText(/вашу ставку перебили/i)).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(4000));
      expect(
        screen.queryByText(/вашу ставку перебили/i),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show the toast for the very first bid in the auction (transition from no bidder)', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: null,
        }),
      }),
    );
    const { rerender } = render(<Player />);

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [{ id: 'other', name: 'Соперник', connected: true }],
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'other',
          auctionHighestBid: 100,
        }),
      }),
    );
    rerender(<Player />);
    expect(screen.queryByText(/вашу ставку перебили/i)).not.toBeInTheDocument();
  });

  it('does not show the toast for the very first bid when I have not joined yet (selfId null)', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: null,
        }),
      }),
    );
    const { rerender } = render(<Player />);

    mockedUseRoomConnection.mockReturnValue(
      connection({
        participants: [{ id: 'other', name: 'Соперник', connected: true }],
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'other',
          auctionHighestBid: 100,
        }),
      }),
    );
    rerender(<Player />);
    expect(screen.queryByText(/вашу ставку перебили/i)).not.toBeInTheDocument();
  });

  it('does not show the toast when I was not the previous leader (watching two others bid)', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'a',
          auctionHighestBid: 100,
        }),
      }),
    );
    const { rerender } = render(<Player />);

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [{ id: 'b', name: 'Б', connected: true }],
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'b',
          auctionHighestBid: 200,
        }),
      }),
    );
    rerender(<Player />);
    expect(screen.queryByText(/вашу ставку перебили/i)).not.toBeInTheDocument();
  });

  it('does not show the toast when I become the new leader myself', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'other',
          auctionHighestBid: 100,
        }),
      }),
    );
    const { rerender } = render(<Player />);

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'me',
          auctionHighestBid: 150,
        }),
      }),
    );
    rerender(<Player />);
    expect(screen.queryByText(/вашу ставку перебили/i)).not.toBeInTheDocument();
  });
});
