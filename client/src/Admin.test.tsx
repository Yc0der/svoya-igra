import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Admin } from './Admin';
import { useAdminConnection } from './useAdminConnection';
import type { AdminConnection } from './useAdminConnection';
import type { GameStateView, ParticipantView } from './useRoomConnection';

vi.mock('./useAdminConnection', () => ({
  useAdminConnection: vi.fn(),
}));

const mockedUseAdminConnection = vi.mocked(useAdminConnection);

function baseGame(overrides: Partial<GameStateView> = {}): GameStateView {
  return {
    phase: 'selecting',
    hostId: null,
    roundIndex: 0,
    grid: [],
    turnParticipantId: '',
    currentQuestion: null,
    buzzedParticipantId: null,
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

function connection(overrides: Partial<AdminConnection> = {}): AdminConnection {
  return {
    connected: true,
    lanUrl: null,
    lanCandidates: [],
    participants: [],
    hostParticipantId: null,
    game: null,
    startGameError: null,
    startGame: vi.fn(),
    resetGame: vi.fn(),
    resetRoom: vi.fn(),
    kick: vi.fn(),
    setHost: vi.fn(),
    skipToFinal: vi.fn(),
    setLanAddress: vi.fn(),
    availablePacks: [],
    activePackFilename: null,
    selectPackError: null,
    refreshPacks: vi.fn(),
    selectPack: vi.fn(),
    ...overrides,
  };
}

describe('Admin', () => {
  it('shows the connection status', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ connected: false }));
    render(<Admin />);
    expect(screen.getByText(/переподключение/i)).toBeInTheDocument();
  });

  it('shows the LAN url when known', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({ lanUrl: 'http://192.168.1.5:8080/' }),
    );
    render(<Admin />);
    expect(screen.getByText(/192\.168\.1\.5:8080/)).toBeInTheDocument();
  });

  // Ловушка «Выбор локального IP на Windows» (svoya-igra-dev).
  it('shows a message instead of a candidate list when none were found', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ lanCandidates: [] }));
    render(<Admin />);
    expect(screen.getByText(/адреса не найдены/i)).toBeInTheDocument();
  });

  it('lists LAN candidates and marks the currently selected one', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        lanUrl: 'http://192.168.56.1:8080/',
        lanCandidates: [
          { address: '192.168.56.1', interfaceName: 'Ethernet 2' },
          { address: '192.168.31.179', interfaceName: 'Беспроводная сеть' },
        ],
      }),
    );
    render(<Admin />);
    const selected = screen.getByRole('button', {
      name: /192\.168\.56\.1.*Ethernet 2/,
    });
    const other = screen.getByRole('button', {
      name: /192\.168\.31\.179.*Беспроводная сеть/,
    });
    expect(selected).toBeDisabled();
    expect(other).toBeEnabled();
  });

  it('calls setLanAddress when picking a different candidate', async () => {
    const setLanAddress = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        lanUrl: 'http://192.168.56.1:8080/',
        lanCandidates: [
          { address: '192.168.56.1', interfaceName: 'Ethernet 2' },
          { address: '192.168.31.179', interfaceName: 'Беспроводная сеть' },
        ],
        setLanAddress,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /192\.168\.31\.179/ }),
    );
    expect(setLanAddress).toHaveBeenCalledWith('192.168.31.179');
  });

  it('shows a message instead of a pack list when none were found', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({ availablePacks: [] }),
    );
    render(<Admin />);
    expect(screen.getByText(/пакеты не найдены/i)).toBeInTheDocument();
  });

  it('lists packs with titles and descriptions, marking the active one', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: 'Про спорт' },
          { filename: 'b.json', title: 'Пак Б', description: null },
        ],
      }),
    );
    render(<Admin />);
    expect(screen.getByText('Пак А')).toBeInTheDocument();
    expect(screen.getByText('Про спорт')).toBeInTheDocument();
    const active = screen.getByRole('button', { name: /Пак А/ });
    const other = screen.getByRole('button', { name: /Пак Б/ });
    expect(active).toBeDisabled();
    expect(other).toBeEnabled();
  });

  it('calls selectPack when picking a different pack', async () => {
    const selectPack = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
          { filename: 'b.json', title: 'Пак Б', description: null },
        ],
        selectPack,
      }),
    );
    render(<Admin />);
    await userEvent.click(screen.getByRole('button', { name: /Пак Б/ }));
    expect(selectPack).toHaveBeenCalledWith('b.json');
  });

  it('calls refreshPacks when clicking "Обновить"', async () => {
    const refreshPacks = vi.fn();
    mockedUseAdminConnection.mockReturnValue(connection({ refreshPacks }));
    render(<Admin />);
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(refreshPacks).toHaveBeenCalledOnce();
  });

  it('shows an alert when selectPackError is set', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({ selectPackError: 'unknown-file' }),
    );
    render(<Admin />);
    expect(screen.getByRole('alert')).toHaveTextContent(/не удалось выбрать/i);
  });

  it('shows "нет партии" and offers to start one when the room is an empty lobby', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ game: null }));
    render(<Admin />);
    expect(screen.getByText(/нет партии/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Начать игру' }),
    ).toBeInTheDocument();
  });

  it('shows the current phase and a restart button once a game exists', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({ game: baseGame({ phase: 'question-open' }) }),
    );
    render(<Admin />);
    expect(screen.getByText('question-open')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Начать заново' }),
    ).toBeInTheDocument();
  });

  it('calls startGame when the start button is clicked', async () => {
    const startGame = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ game: null, startGame }),
    );
    render(<Admin />);
    await userEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    expect(startGame).toHaveBeenCalledOnce();
  });

  it('shows a translated start-game error', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({ startGameError: 'not-enough-players' }),
    );
    render(<Admin />);
    expect(screen.getByRole('alert')).toHaveTextContent(/минимум два игрока/i);
  });

  it('disables "завершить партию" when there is no game, and calls resetGame when there is one', async () => {
    const resetGame = vi.fn();
    mockedUseAdminConnection.mockReturnValue(connection({ game: null }));
    const { rerender } = render(<Admin />);
    expect(
      screen.getByRole('button', { name: /завершить партию/i }),
    ).toBeDisabled();

    mockedUseAdminConnection.mockReturnValue(
      connection({ game: baseGame(), resetGame }),
    );
    rerender(<Admin />);
    const button = screen.getByRole('button', { name: /завершить партию/i });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(resetGame).toHaveBeenCalledOnce();
  });

  it('requires clicking "снести всё" twice before it actually wipes the room', async () => {
    const resetRoom = vi.fn();
    mockedUseAdminConnection.mockReturnValue(connection({ resetRoom }));
    render(<Admin />);
    const button = screen.getByRole('button', { name: /снести всё/i });

    await userEvent.click(button);
    expect(resetRoom).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /точно/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /точно/i }));
    expect(resetRoom).toHaveBeenCalledOnce();
  });

  it('disables "перейти к финалу" when there is no game', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ game: null }));
    render(<Admin />);
    expect(
      screen.getByRole('button', { name: /перейти к финалу/i }),
    ).toBeDisabled();
  });

  it('disables "перейти к финалу" once already in the final round or after game-end', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({ game: baseGame({ phase: 'final-wager' }) }),
    );
    render(<Admin />);
    expect(
      screen.getByRole('button', { name: /перейти к финалу/i }),
    ).toBeDisabled();
  });

  it('calls skipToFinal when "перейти к финалу" is clicked during a normal round', async () => {
    const skipToFinal = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ game: baseGame({ phase: 'selecting' }), skipToFinal }),
    );
    render(<Admin />);
    const button = screen.getByRole('button', { name: /перейти к финалу/i });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(skipToFinal).toHaveBeenCalledOnce();
  });

  it('shows a message instead of a table when nobody has joined yet', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ participants: [] }));
    render(<Admin />);
    expect(screen.getByText(/никто не подключился/i)).toBeInTheDocument();
  });

  function withParticipants(
    participants: ParticipantView[],
    overrides: Partial<AdminConnection> = {},
  ): AdminConnection {
    return connection({ participants, ...overrides });
  }

  it('lists participants with their online status', () => {
    mockedUseAdminConnection.mockReturnValue(
      withParticipants([
        { id: 'p1', name: 'Ваня', connected: true },
        { id: 'p2', name: 'Катя', connected: false },
      ]),
    );
    render(<Admin />);
    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText('онлайн')).toBeInTheDocument();
    expect(screen.getByText('Катя')).toBeInTheDocument();
    expect(screen.getByText('офлайн')).toBeInTheDocument();
  });

  it('shows the lobby host role for whoever is the marked host before a game starts', () => {
    mockedUseAdminConnection.mockReturnValue(
      withParticipants([{ id: 'p1', name: 'Ваня', connected: true }], {
        hostParticipantId: 'p1',
      }),
    );
    render(<Admin />);
    expect(screen.getByText(/ведущий \(лобби\)/i)).toBeInTheDocument();
  });

  it('shows the frozen game host and playing-with-score roles once a game exists', () => {
    mockedUseAdminConnection.mockReturnValue(
      withParticipants(
        [
          { id: 'host-id', name: 'Петя', connected: true },
          { id: 'p1', name: 'Ваня', connected: true },
          { id: 'p2', name: 'Катя', connected: true },
        ],
        {
          game: baseGame({
            hostId: 'host-id',
            scores: [
              { participantId: 'p1', score: 300 },
              { participantId: 'p2', score: -100 },
            ],
          }),
        },
      ),
    );
    render(<Admin />);
    expect(screen.getByText('Ведущий')).toBeInTheDocument();
    expect(screen.getByText(/играет.*300/i)).toBeInTheDocument();
    expect(screen.getByText(/играет.*-100/i)).toBeInTheDocument();
  });

  it('shows "не в партии" for a participant who joined after the game already started', () => {
    mockedUseAdminConnection.mockReturnValue(
      withParticipants(
        [{ id: 'latecomer', name: 'Опоздавший', connected: true }],
        {
          game: baseGame({ scores: [] }),
        },
      ),
    );
    render(<Admin />);
    expect(screen.getByText(/не в партии/i)).toBeInTheDocument();
  });

  it('calls setHost with the participant id when "сделать ведущим" is clicked', async () => {
    const setHost = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      withParticipants([{ id: 'p1', name: 'Ваня', connected: true }], {
        setHost,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /сделать ведущим/i }),
    );
    expect(setHost).toHaveBeenCalledWith('p1');
  });

  it('calls setHost with null when "снять ведущего" is clicked for the current host', async () => {
    const setHost = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      withParticipants([{ id: 'p1', name: 'Ваня', connected: true }], {
        hostParticipantId: 'p1',
        setHost,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /снять ведущего/i }),
    );
    expect(setHost).toHaveBeenCalledWith(null);
  });

  it('calls kick with the participant id, immediately, no confirmation needed', async () => {
    const kick = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      withParticipants([{ id: 'p1', name: 'Ваня', connected: true }], { kick }),
    );
    render(<Admin />);
    await userEvent.click(screen.getByRole('button', { name: /кикнуть/i }));
    expect(kick).toHaveBeenCalledWith('p1');
  });
});
