import { render, screen } from '@testing-library/react';
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
    roundIndex: 0,
    grid: [],
    turnParticipantId: '',
    currentQuestion: null,
    buzzedParticipantId: null,
    correctAnswer: null,
    graceExcludedParticipantId: null,
    timerDeadline: null,
    scores: [],
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
    hostParticipantId: null,
    isHost: false,
    startGameError: null,
    join: vi.fn(),
    startGame: vi.fn(),
    toggleHost: vi.fn(),
    selectQuestion: vi.fn(),
    buzz: vi.fn(),
    saidAnswer: vi.fn(),
    vote: vi.fn(),
    ...overrides,
  };
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

  it("shows a translated error and doesn't crash when start-game fails", () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({ game: null, startGameError: 'host-required' }),
    );
    render(<Player />);
    expect(screen.getByRole('alert')).toHaveTextContent(/нужен ведущий/i);
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

  it('shows the buzz button while the question is open', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({ game: baseGame({ phase: 'question-open' }) }),
    );
    render(<Player />);
    expect(screen.getByRole('button', { name: /жать/i })).toBeInTheDocument();
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

  it('disables the buzz button and explains why for the just-excluded answerer during reopen grace', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'question-open',
          graceExcludedParticipantId: 'me',
          timerDeadline: Date.now() + 7000,
        }),
      }),
    );
    render(<Player />);
    expect(screen.getByRole('button', { name: /жать/i })).toBeDisabled();
    expect(screen.getByText(/уже пробовал/i)).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /жать/i })).toBeEnabled();
  });

  it('disables the buzz button for 2 seconds after a falsestart', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({ phase: 'question-open' }),
        falsestart: true,
      }),
    );
    render(<Player />);
    expect(screen.getByRole('button', { name: /жать/i })).toBeDisabled();
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
    expect(screen.getByText('Ответ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^зачёт$/i }));
    expect(vote).toHaveBeenCalledWith(true);
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
});
