import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from './Board';
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

describe('Board', () => {
  it('lists connected and disconnected participants', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        status: 'connecting',
        participants: [
          { id: '1', name: 'Ваня', connected: true },
          { id: '2', name: 'Катя', connected: false },
        ],
        selfId: null,
        lanUrl: 'http://192.168.1.42:8080/',
      }),
    );

    render(<Board />);

    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText(/Катя/)).toHaveTextContent('отключён');
  });

  it('shows the LAN url as text and a QR code once known', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        status: 'connecting',
        participants: [],
        selfId: null,
        lanUrl: 'http://192.168.1.42:8080/',
      }),
    );

    render(<Board />);

    expect(screen.getByText('http://192.168.1.42:8080/')).toBeInTheDocument();
    expect(screen.getByTitle('QR-код для входа')).toBeInTheDocument();
  });

  it('renders neither URL nor QR code before the LAN url is known', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        status: 'connecting',
        participants: [],
        selfId: null,
        lanUrl: null,
      }),
    );

    render(<Board />);

    expect(screen.queryByTitle('QR-код для входа')).not.toBeInTheDocument();
  });

  it('shows the lobby (QR + participants) when no game exists yet', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        lanUrl: 'http://x/',
        participants: [{ id: '1', name: 'Ваня', connected: true }],
        game: null,
      }),
    );
    render(<Board />);
    expect(screen.getByText('Ваня')).toBeInTheDocument();
  });

  it('shows whose turn it is to pick during selecting', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({ phase: 'selecting', turnParticipantId: '1' }),
        participants: [{ id: '1', name: 'Ваня', connected: true }],
      }),
    );
    render(<Board />);
    expect(screen.getByText(/выбирает Ваня/i)).toBeInTheDocument();
  });

  it('shows the grid with answered cells greyed out once the game has started', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          grid: [
            {
              themeName: 'Тема',
              questions: [
                { id: 'q1', price: 100, answered: true },
                { id: 'q2', price: 200, answered: false },
              ],
            },
          ],
        }),
      }),
    );
    render(<Board />);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('shows the open question text', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-open',
          currentQuestion: { text: 'Столица Франции?', price: 100 },
        }),
      }),
    );
    render(<Board />);
    expect(screen.getByText('Столица Франции?')).toBeInTheDocument();
  });

  it('shows who buzzed', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({ phase: 'buzzed', buzzedParticipantId: '1' }),
        participants: [{ id: '1', name: 'Ваня', connected: true }],
      }),
    );
    render(<Board />);
    expect(screen.getByText(/Ваня/)).toBeInTheDocument();
  });

  it('shows the correct answer and updated score by name on reveal', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'reveal',
          correctAnswer: { text: 'Париж' },
          scores: [{ participantId: '1', score: 100 }],
        }),
        participants: [{ id: '1', name: 'Ваня', connected: true }],
      }),
    );
    render(<Board />);
    expect(screen.getByText('Париж')).toBeInTheDocument();
    expect(screen.getByText(/Ваня: 100/)).toBeInTheDocument();
  });

  it('shows the correct answer during judging too, not only reveal', () => {
    // Room.toGameStateView() задаёт correctAnswer и на judging, и на reveal
    // (server/src/room.ts, showAnswer = phase === 'judging' || phase ===
    // 'reveal') — табло не должно завязывать показ ответа именно на фазу
    // 'reveal', только на наличие самого correctAnswer.
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'judging',
          correctAnswer: { text: 'Париж' },
        }),
      }),
    );
    render(<Board />);
    expect(screen.getByText('Париж')).toBeInTheDocument();
  });

  it('shows final standings at game-end', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'game-end',
          scores: [
            { participantId: '1', score: 300 },
            { participantId: '2', score: 100 },
          ],
        }),
        participants: [
          { id: '1', name: 'Ваня', connected: true },
          { id: '2', name: 'Катя', connected: true },
        ],
      }),
    );
    render(<Board />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ваня');
  });
});
