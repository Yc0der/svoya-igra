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
    join: vi.fn(),
    startGame: vi.fn(),
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
    expect(screen.getByText(/Ваня: 100/)).toBeInTheDocument();
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
    expect(screen.getByText(/Ваня: 100/)).toBeInTheDocument();
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
    expect(screen.getByText(/Я: 300/)).toBeInTheDocument();
    expect(screen.getByText(/Другой: 100/)).toBeInTheDocument();
    expect(screen.queryByText('me')).not.toBeInTheDocument();
  });
});
