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
    hostId: null,
    roundIndex: 0,
    grid: [],
    turnParticipantId: '',
    currentQuestion: null,
    buzzedParticipantId: null,
    catRecipientParticipantId: null,
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
    hostParticipantId: null,
    isHost: false,
    startGameError: null,
    join: vi.fn(),
    startGame: vi.fn(),
    toggleHost: vi.fn(),
    selectQuestion: vi.fn(),
    assignCat: vi.fn(),
    buzz: vi.fn(),
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

function renderBoard(overrides: Partial<RoomConnection> = {}): void {
  mockedUseRoomConnection.mockReturnValue(connection(overrides));
  render(<Board />);
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
    expect(screen.getByText(/выбирает/i)).toBeInTheDocument();
    expect(screen.getByText('Ваня')).toBeInTheDocument();
  });

  it('removes answered questions from the visible grid', () => {
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

  it('sizes the grid to the actual number of questions per theme, not a hardcoded count', () => {
    // Регрессия: сетка была захардкожена на 4 цены в теме (под старый
    // packs/current.json), а генератор пакетов (Веха 3) делает по 5 —
    // из-за чего строки съезжали по диагонали начиная со второй темы.
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
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
    render(<Board />);
    const grid = document.querySelector('.board-grid') as HTMLElement;
    expect(grid.style.getPropertyValue('--price-columns')).toBe('5');
  });

  it('shows the open question text', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-open',
          currentQuestion: {
            text: 'Столица Франции?',
            price: 100,
            themeName: 'Тема',
          },
        }),
      }),
    );
    render(<Board />);
    expect(screen.getByText('Столица Франции?')).toBeInTheDocument();
  });

  it('shows a countdown while the question is open', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-open',
          currentQuestion: {
            text: 'Столица Франции?',
            price: 100,
            themeName: 'Тема',
          },
          timerDeadline: Date.now() + 12000,
        }),
      }),
    );
    render(<Board />);
    expect(screen.getByText(/^\d+с$/)).toBeInTheDocument();
  });

  it('shows the theme and price instead of the text during cat-handoff', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'cat-handoff',
          currentQuestion: { text: null, price: 300, themeName: 'История' },
        }),
      }),
    );
    render(<Board />);
    expect(screen.getByText(/история за 300/i)).toBeInTheDocument();
  });

  it('shows a countdown during cat-handoff too', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'cat-handoff',
          currentQuestion: { text: null, price: 300, themeName: 'История' },
          timerDeadline: Date.now() + 12000,
        }),
      }),
    );
    render(<Board />);
    expect(screen.getByText(/^\d+с$/)).toBeInTheDocument();
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
    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
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

  it('shows a waiting status instead of leaking the answer during host-mode judging', () => {
    // В режиме с ведущим Room.toGameStateView() не шлёт correctAnswer табло
    // вообще (server/src/room.ts) — именно ради этого ведущий и появился
    // (design.md, «СУДЕЙСТВО»). Табло должно отличать эту ситуацию от
    // открытого режима явным статусом, а не молчанием.
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({ phase: 'judging', correctAnswer: null }),
      }),
    );
    render(<Board />);
    expect(screen.getByText(/ведущий судит/i)).toBeInTheDocument();
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

  it('final-elim: shows the theme list with eliminated ones struck out', () => {
    renderBoard({
      game: {
        ...baseGame(),
        phase: 'final-elim',
        finalThemes: [
          { name: 'Финал A', eliminated: true },
          { name: 'Финал B', eliminated: false },
        ],
        finalElimParticipantId: 'p1',
      },
      participants: [{ id: 'p1', name: 'Ваня', connected: true }],
    });
    expect(screen.getByText('Финал A')).toHaveClass('is-eliminated');
    expect(screen.getByText(/Ваня/)).toBeInTheDocument();
  });

  it('final-wager and final-answer: shows the theme name and question without revealing wagers/answers', () => {
    renderBoard({
      game: {
        ...baseGame(),
        phase: 'final-answer',
        finalThemes: [{ name: 'Финал A', eliminated: false }],
        finalQuestion: { text: 'Вопрос финала?' },
      },
    });
    expect(screen.getByText('Вопрос финала?')).toBeInTheDocument();
    expect(screen.queryByText(/ответ/)).not.toBeInTheDocument();
  });

  it('final-reveal: shows the full wager/answer/verdict table, the correct answer, and updated scores', () => {
    renderBoard({
      game: {
        ...baseGame(),
        phase: 'final-reveal',
        finalWagers: [{ participantId: 'p1', amount: 50 }],
        finalAnswers: [{ participantId: 'p1', text: 'ответ 1' }],
        finalVerdicts: [{ participantId: 'p1', correct: true }],
        finalCorrectAnswer: { text: 'Правильный ответ', comment: 'Коммент' },
        scores: [{ participantId: 'p1', score: 150 }],
      },
      participants: [{ id: 'p1', name: 'Ваня', connected: true }],
    });
    expect(screen.getByText('ответ 1')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Правильный ответ')).toBeInTheDocument();
    expect(screen.getByText('Коммент')).toBeInTheDocument();
  });

  it('final-elim: shows a countdown', () => {
    renderBoard({
      game: {
        ...baseGame(),
        phase: 'final-elim',
        finalThemes: [{ name: 'Финал A', eliminated: false }],
        finalElimParticipantId: 'p1',
        timerDeadline: Date.now() + 12000,
      },
      participants: [{ id: 'p1', name: 'Ваня', connected: true }],
    });
    expect(screen.getByText(/^\d+с$/)).toBeInTheDocument();
  });

  it('final-wager/final-answer/final-judging: shows a countdown', () => {
    renderBoard({
      game: {
        ...baseGame(),
        phase: 'final-answer',
        finalThemes: [{ name: 'Финал A', eliminated: false }],
        finalQuestion: { text: 'Вопрос финала?' },
        timerDeadline: Date.now() + 12000,
      },
    });
    expect(screen.getByText(/^\d+с$/)).toBeInTheDocument();
  });

  it('final-reveal: does not show a countdown — it is a passive pause, not a timed decision', () => {
    renderBoard({
      game: {
        ...baseGame(),
        phase: 'final-reveal',
        finalWagers: [],
        finalAnswers: [],
        finalVerdicts: [],
        timerDeadline: Date.now() + 12000,
      },
    });
    expect(screen.queryByText(/^\d+с$/)).not.toBeInTheDocument();
  });
});
