import { render, screen, within } from '@testing-library/react';
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
    questionTags: null,
    tagReview: [],
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
    textRevealWordsPerSecond: 2.5,
    setTextRevealWordsPerSecond: vi.fn(),
    textRevealEnabled: true,
    setTextRevealEnabled: vi.fn(),
    textRevealFadeMs: 270,
    setTextRevealFadeMs: vi.fn(),
    historyEnabled: true,
    setHistoryEnabled: vi.fn(),
    historyRecording: true,
    availablePacks: [],
    activePackFilename: null,
    selectPackError: null,
    refreshPacks: vi.fn(),
    selectPack: vi.fn(),
    editedPack: null,
    editedPackFilename: null,
    editedPackError: null,
    editedPackVersion: 0,
    clearPackError: vi.fn(),
    resetPackEditor: vi.fn(),
    getPack: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    reportError: null,
    reportAckVersion: 0,
    clearReportError: vi.fn(),
    reportQuestion: vi.fn(),
    players: [],
    playerError: null,
    playerConflictName: null,
    playerCard: null,
    clearPlayerFeedback: vi.fn(),
    savePlayer: vi.fn(),
    getPlayer: vi.fn(),
    clearPlayerCard: vi.fn(),
    deletePlayerCard: vi.fn(),
    people: [],
    peopleError: null,
    clearPeopleError: vi.fn(),
    mergePeople: vi.fn(),
    forgetPerson: vi.fn(),
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

  // ВРЕМЕННО — см. server/src/protocol.ts, StateMessage.textRevealFadeMs.
  it('ввод и «Применить» в секции длительности проявления буквы вызывает setTextRevealFadeMs с введённым числом', async () => {
    const setTextRevealFadeMs = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ textRevealFadeMs: 270, setTextRevealFadeMs }),
    );
    render(<Admin />);

    const input = screen.getByLabelText('Длительность проявления буквы, мс');
    const section = input.closest('section')!;
    await userEvent.clear(input);
    await userEvent.type(input, '350');
    await userEvent.click(
      within(section).getByRole('button', { name: 'Применить' }),
    );

    expect(setTextRevealFadeMs).toHaveBeenCalledWith(350);
  });

  // ВРЕМЕННО — см. server/src/protocol.ts, StateMessage.textRevealFadeMs. 0
  // должно оставаться допустимым: возврат к мгновенному появлению буквы —
  // сознательная точка сравнения, не ошибка ввода (design.md,
  // 2026-08-19-gradual-text-reveal-design.md).
  it('позволяет применить 0 мс (мгновенное появление буквы)', async () => {
    const setTextRevealFadeMs = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ textRevealFadeMs: 270, setTextRevealFadeMs }),
    );
    render(<Admin />);

    const input = screen.getByLabelText('Длительность проявления буквы, мс');
    const section = input.closest('section')!;
    await userEvent.clear(input);
    await userEvent.type(input, '0');
    await userEvent.click(
      within(section).getByRole('button', { name: 'Применить' }),
    );

    expect(setTextRevealFadeMs).toHaveBeenCalledWith(0);
  });

  it('переключение записи истории вызывает setHistoryEnabled', async () => {
    const setHistoryEnabled = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ historyEnabled: true, setHistoryEnabled }),
    );
    render(<Admin />);

    await userEvent.click(
      screen.getByLabelText('Записывать эту партию в историю'),
    );

    expect(setHistoryEnabled).toHaveBeenCalledWith(false);
  });

  it('не показывает чекбокс включённым, когда партия уже выброшена из истории', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        game: baseGame(),
        historyEnabled: true,
        historyRecording: false,
      }),
    );
    render(<Admin />);

    expect(
      screen.getByLabelText('Записывать эту партию в историю'),
    ).not.toBeChecked();
  });

  it('показывает чекбокс включённым до старта партии по historyEnabled', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        game: null,
        historyEnabled: true,
        historyRecording: false,
      }),
    );
    render(<Admin />);

    expect(
      screen.getByLabelText('Записывать эту партию в историю'),
    ).toBeChecked();
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

describe('Admin — редактор пакета', () => {
  const PACK = {
    title: 'Пак А',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                id: 'q1',
                price: 100,
                text: 'Вопрос?',
                answer: 'Ответ',
                type: 'обычный' as const,
              },
            ],
          },
        ],
      },
    ],
  };

  it('shows the pack grid after clicking "Редактировать"', async () => {
    const getPack = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        getPack,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    expect(getPack).toHaveBeenCalledWith('a.json');
  });

  it('shows a single "Редактировать" button regardless of how many packs are listed, editing whichever pack is active', async () => {
    const getPack = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'b.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
          { filename: 'b.json', title: 'Пак Б', description: null },
        ],
        getPack,
      }),
    );
    render(<Admin />);
    expect(
      screen.getAllByRole('button', { name: /редактировать/i }),
    ).toHaveLength(1);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    expect(getPack).toHaveBeenCalledWith('b.json');
  });

  it('disables "Редактировать" when no pack is currently active', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: null,
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
      }),
    );
    render(<Admin />);
    expect(
      screen.getByRole('button', { name: /редактировать/i }),
    ).toBeDisabled();
  });

  it('renders the grid once the pack arrives, with a button per question price', async () => {
    const getPack = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        getPack,
      }),
    );
    const { rerender } = render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );

    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        getPack,
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    rerender(<Admin />);
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    expect(screen.getByText('Тема')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100' })).toBeInTheDocument();
  });

  it('opens the edit form with the question’s current values on price click', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));
    expect(screen.getByDisplayValue('Вопрос?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ответ')).toBeInTheDocument();
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });

  it('calls updateQuestion with the edited values and the fixed questionId on save', async () => {
    const updateQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        updateQuestion,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    const priceInput = screen.getByDisplayValue('100');
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, '300');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(updateQuestion).toHaveBeenCalledWith('a.json', 'q1', {
      price: 300,
      text: 'Вопрос?',
      answer: 'Ответ',
      comment: undefined,
      questionType: 'обычный',
    });
  });

  it('disables "Сохранить" for an invalid price or empty text', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    const priceInput = screen.getByDisplayValue('100');
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, '0');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('shows the error from editedPackError and keeps the form open', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        editedPackError: 'цена должна быть положительным числом',
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /цена должна быть положительным числом/i,
    );
  });

  it('requires clicking "Удалить" twice before it actually deletes the question', async () => {
    const deleteQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        deleteQuestion,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    const del = screen.getByRole('button', { name: /^удалить$/i });
    await userEvent.click(del);
    expect(deleteQuestion).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /точно/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /точно/i }));
    expect(deleteQuestion).toHaveBeenCalledWith('a.json', 'q1');
  });

  it('closes the form without saving when "Отменить изменения" is clicked', async () => {
    const updateQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        updateQuestion,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    const priceInput = screen.getByDisplayValue('100');
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, '300');
    await userEvent.click(
      screen.getByRole('button', { name: /отменить изменения/i }),
    );

    expect(updateQuestion).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('300')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100' })).toBeInTheDocument();
  });

  it('closes the form after a successful delete, once editedPack no longer contains the question', async () => {
    const deleteQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        editedPackVersion: 0,
        deleteQuestion,
      }),
    );
    const { rerender } = render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));
    expect(screen.getByDisplayValue('Вопрос?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^удалить$/i }));
    await userEvent.click(screen.getByRole('button', { name: /точно/i }));
    expect(deleteQuestion).toHaveBeenCalledWith('a.json', 'q1');

    // Сервер ответил новым admin-pack без удалённого вопроса — тема
    // осталась пустой (design.md допускает временно пустую тему в редакторе;
    // сам сервер такое удаление и не разрешил бы, но для этого теста важна
    // только реакция формы на исчезновение вопроса из editedPack).
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: {
          ...PACK,
          rounds: [{ themes: [{ name: 'Тема', questions: [] }] }],
        },
        editedPackFilename: 'a.json',
        editedPackVersion: 1,
        deleteQuestion,
      }),
    );
    rerender(<Admin />);

    expect(
      screen.queryByRole('button', { name: '100' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Вопрос?')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Сохранить' }),
    ).not.toBeInTheDocument();
  });

  it('closes the form after a successful save, once a new editedPackVersion arrives', async () => {
    const updateQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        editedPackVersion: 0,
        updateQuestion,
      }),
    );
    const { rerender } = render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    const priceInput = screen.getByDisplayValue('100');
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, '300');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(updateQuestion).toHaveBeenCalledOnce();

    // Сервер ответил новым admin-pack с сохранённым вопросом — версия
    // увеличилась, форма должна закрыться сама (design.md, «При успехе —
    // форма закрывается»).
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: {
          ...PACK,
          rounds: [
            {
              themes: [
                {
                  name: 'Тема',
                  questions: [
                    { ...PACK.rounds[0].themes[0].questions[0], price: 300 },
                  ],
                },
              ],
            },
          ],
        },
        editedPackFilename: 'a.json',
        editedPackVersion: 1,
        updateQuestion,
      }),
    );
    rerender(<Admin />);

    expect(
      screen.queryByRole('button', { name: 'Сохранить' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '300' })).toBeInTheDocument();
  });

  it('does not close the form when editedPackError arrives without a new editedPackVersion', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        editedPackVersion: 0,
      }),
    );
    const { rerender } = render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    // Тот же editedPack, версия не выросла — только пришла ошибка (напр.
    // невалидная цена). Форма должна остаться открытой с текстом ошибки.
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        editedPackVersion: 0,
        editedPackError: 'цена должна быть положительным числом',
      }),
    );
    rerender(<Admin />);

    expect(screen.getByDisplayValue('Вопрос?')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /цена должна быть положительным числом/i,
    );
  });

  it('returns to the pack list when "Готово" is clicked, resetting the pack editor state', async () => {
    const resetPackEditor = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        resetPackEditor,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /готово/i }));
    expect(
      screen.queryByRole('button', { name: '100' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /редактировать/i }),
    ).toBeInTheDocument();
    expect(resetPackEditor).toHaveBeenCalledOnce();
  });

  it('clears the stale error from a previous question when opening a different one', async () => {
    const clearPackError = vi.fn();
    const PACK_TWO_QUESTIONS = {
      ...PACK,
      rounds: [
        {
          themes: [
            {
              name: 'Тема',
              questions: [
                ...PACK.rounds[0].themes[0].questions,
                {
                  id: 'q2',
                  price: 200,
                  text: 'Второй вопрос?',
                  answer: 'Второй ответ',
                  type: 'обычный' as const,
                },
              ],
            },
          ],
        },
      ],
    };
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK_TWO_QUESTIONS,
        editedPackFilename: 'a.json',
        editedPackError: 'цена должна быть положительным числом',
        clearPackError,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    await userEvent.click(screen.getByRole('button', { name: '100' }));
    expect(clearPackError).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: '200' }));
    expect(clearPackError).toHaveBeenCalledTimes(2);
  });
});

describe('Admin — список и жалобы', () => {
  const PACK = {
    title: 'Пак А',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                id: 'q1',
                price: 100,
                text: 'Вопрос?',
                answer: 'Ответ',
                type: 'обычный' as const,
              },
              {
                id: 'q2',
                price: 200,
                text: 'Второй вопрос?',
                answer: 'Второй ответ',
                type: 'обычный' as const,
              },
            ],
          },
        ],
      },
    ],
  };

  async function openEditor() {
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
  }

  it('shows the list view by default, with a "Пожаловаться" button per question', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    expect(screen.getByText('Вопрос?')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /пожаловаться/i }),
    ).toHaveLength(2);
  });

  it('switches to the grid when the "Сетка" radio is picked, hiding "Пожаловаться"', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    expect(
      screen.queryByRole('button', { name: /пожаловаться/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100' })).toBeInTheDocument();
  });

  it('opens the edit form from a list row click, not the complaint button', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    await userEvent.click(screen.getByText('Вопрос?'));
    expect(screen.getByDisplayValue('Вопрос?')).toBeInTheDocument();
  });

  it('opens the complaint panel and closes any open edit form', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    await userEvent.click(screen.getByText('Вопрос?'));
    expect(screen.getByDisplayValue('Вопрос?')).toBeInTheDocument();

    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    expect(screen.queryByDisplayValue('Вопрос?')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/что не понравилось/i)).toBeInTheDocument();
  });

  it('shows the target question price and text inside the complaint panel', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    // Второй вопрос (q2, «200 — Второй вопрос?») — чтобы проверка не
    // прошла случайно из-за того, что первый вопрос пакета и так везде
    // виден на экране.
    await userEvent.click(complainButtons[1]);
    expect(screen.getByText(/«200 — Второй вопрос\?»/)).toBeInTheDocument();
  });

  it('disables "Отправить" on empty text and calls reportQuestion with the typed complaint', async () => {
    const reportQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportQuestion,
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);

    const sendButton = screen.getByRole('button', { name: /отправить/i });
    expect(sendButton).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/что не понравилось/i),
      'слишком просто',
    );
    expect(sendButton).toBeEnabled();
    await userEvent.click(sendButton);
    expect(reportQuestion).toHaveBeenCalledWith(
      'a.json',
      'q1',
      'слишком просто',
    );
  });

  it('closes the complaint panel once a matching reportAckVersion arrives', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportAckVersion: 0,
      }),
    );
    const { rerender } = render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    await userEvent.type(screen.getByLabelText(/что не понравилось/i), 'текст');
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));

    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportAckVersion: 1,
      }),
    );
    rerender(<Admin />);
    expect(
      screen.queryByLabelText(/что не понравилось/i),
    ).not.toBeInTheDocument();
  });

  it('shows reportError as an alert and keeps the panel open', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportError: 'вопрос с таким id не найден',
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /вопрос с таким id не найден/i,
    );
    expect(screen.getByLabelText(/что не понравилось/i)).toBeInTheDocument();
  });

  it('"Отмена" closes the complaint panel without calling reportQuestion', async () => {
    const reportQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportQuestion,
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    await userEvent.click(screen.getByRole('button', { name: /отмена/i }));
    expect(
      screen.queryByLabelText(/что не понравилось/i),
    ).not.toBeInTheDocument();
    expect(reportQuestion).not.toHaveBeenCalled();
  });

  it('switching view mode closes an open complaint panel', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    expect(
      screen.queryByLabelText(/что не понравилось/i),
    ).not.toBeInTheDocument();
  });
});

describe('Admin — анкеты игроков', () => {
  it('shows "Анкет пока нет." when the list is empty', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ players: [] }));
    render(<Admin />);
    expect(screen.getByText('Анкет пока нет.')).toBeInTheDocument();
  });

  it('показывает список анкет и отправляет вставленный код', async () => {
    const savePlayer = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        players: [{ name: 'Ваня', date: '2026-08-26' }],
        savePlayer,
      }),
    );
    render(<Admin />);
    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText('от 2026-08-26')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/вставь код анкеты/i);
    await userEvent.type(textarea, '{{"version":1}');
    await userEvent.click(
      screen.getByRole('button', { name: /сохранить анкету/i }),
    );
    expect(savePlayer).toHaveBeenCalledWith('{"version":1}', false);
  });

  it('кнопка «Сохранить анкету» выключена, пока поле с кодом пустое', () => {
    mockedUseAdminConnection.mockReturnValue(connection());
    render(<Admin />);
    expect(
      screen.getByRole('button', { name: /сохранить анкету/i }),
    ).toBeDisabled();
  });

  it('на конфликт имени показывает вопрос и повторяет отправку с подтверждением', async () => {
    const savePlayer = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ playerConflictName: 'Ваня', savePlayer }),
    );
    render(<Admin />);
    const textarea = screen.getByPlaceholderText(/вставь код анкеты/i);
    await userEvent.type(textarea, '{{"version":1}');

    expect(screen.getByText(/уже есть/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /заменить/i }));
    expect(savePlayer).toHaveBeenLastCalledWith('{"version":1}', true);
  });

  it('«Отмена» на конфликте вызывает clearPlayerFeedback', async () => {
    const clearPlayerFeedback = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ playerConflictName: 'Ваня', clearPlayerFeedback }),
    );
    render(<Admin />);
    await userEvent.click(screen.getByRole('button', { name: /отмена/i }));
    expect(clearPlayerFeedback).toHaveBeenCalled();
  });

  it('показывает playerError под полем анкеты', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({ playerError: 'это не похоже на код анкеты' }),
    );
    render(<Admin />);
    expect(screen.getByText('это не похоже на код анкеты')).toBeInTheDocument();
  });

  it('ввод в поле кода сбрасывает обратную связь через clearPlayerFeedback', async () => {
    const clearPlayerFeedback = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ playerError: 'ошибка', clearPlayerFeedback }),
    );
    render(<Admin />);
    const textarea = screen.getByPlaceholderText(/вставь код анкеты/i);
    await userEvent.type(textarea, 'a');
    expect(clearPlayerFeedback).toHaveBeenCalled();
  });
});

// Слияние расщепившихся профилей (задача 4, sdd/2026-08-26-player-identity)
// — подраздел «Один и тот же человек» внутри «Анкеты игроков».
describe('Admin — слияние профилей', () => {
  const PEOPLE = [
    { id: 1, name: 'Ваня', games: 5 },
    { id: 2, name: 'Ваня (2)', games: 1 },
  ];

  it('кнопка «Слить» выключена, пока не выбраны двое разных', async () => {
    mockedUseAdminConnection.mockReturnValue(connection({ people: PEOPLE }));
    render(<Admin />);
    const button = screen.getByRole('button', { name: /слить/i });
    expect(button).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(/кого слить/i), '1');
    expect(button).toBeDisabled(); // выбран только один

    await userEvent.selectOptions(screen.getByLabelText(/в кого/i), '1');
    expect(button).toBeDisabled(); // один и тот же человек с обеих сторон

    await userEvent.selectOptions(screen.getByLabelText(/в кого/i), '2');
    expect(button).toBeEnabled();
  });

  it('подтверждение показывает, какое имя останется, а какое исчезнет, и вызывает mergePeople только после подтверждения', async () => {
    const mergePeople = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ people: PEOPLE, mergePeople }),
    );
    render(<Admin />);
    await userEvent.selectOptions(screen.getByLabelText(/кого слить/i), '1');
    await userEvent.selectOptions(screen.getByLabelText(/в кого/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /слить/i }));

    expect(mergePeople).not.toHaveBeenCalled();
    // Останется «Ваня (2)», исчезнет «Ваня» — оба имени должны быть видны,
    // иначе ведущий узнает направление только по результату (задача 4).
    const confirmText = screen.getByText(/останется/i);
    expect(confirmText.textContent).toContain('Ваня (2)');
    expect(confirmText.textContent).toMatch(/исчезнет/i);

    await userEvent.click(screen.getByRole('button', { name: /подтвердить/i }));
    expect(mergePeople).toHaveBeenCalledWith(1, 2);
  });

  it('«Отмена» на подтверждении не вызывает mergePeople', async () => {
    const mergePeople = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ people: PEOPLE, mergePeople }),
    );
    render(<Admin />);
    await userEvent.selectOptions(screen.getByLabelText(/кого слить/i), '1');
    await userEvent.selectOptions(screen.getByLabelText(/в кого/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /слить/i }));
    await userEvent.click(screen.getByRole('button', { name: /отмена/i }));

    expect(mergePeople).not.toHaveBeenCalled();
    expect(screen.queryByText(/останется/i)).not.toBeInTheDocument();
  });

  it('показывает peopleError, включая отказ во время идущей партии', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        people: PEOPLE,
        peopleError: 'нельзя сливать игроков, пока идёт партия',
      }),
    );
    render(<Admin />);
    expect(
      screen.getByText('нельзя сливать игроков, пока идёт партия'),
    ).toBeInTheDocument();
  });

  // Финальное ревью ветки, п. 7 (Minor): отказ слияния («нельзя сливать
  // игроков, пока идёт партия») не должен пережить смену выбора — иначе он
  // висит красным всю партию, хотя ведущий уже переключился на другую пару.
  it('гасит peopleError при смене выбора в любом из двух списков', async () => {
    const clearPeopleError = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        people: PEOPLE,
        peopleError: 'нельзя сливать игроков, пока идёт партия',
        clearPeopleError,
      }),
    );
    render(<Admin />);

    await userEvent.selectOptions(screen.getByLabelText(/кого слить/i), '1');
    expect(clearPeopleError).toHaveBeenCalledTimes(1);

    await userEvent.selectOptions(screen.getByLabelText(/в кого/i), '2');
    expect(clearPeopleError).toHaveBeenCalledTimes(2);
  });

  it('список людей истории показывает имя и число партий', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ people: PEOPLE }));
    render(<Admin />);
    expect(screen.getByText(/люди в истории/i)).toBeInTheDocument();
    expect(screen.getByText(/5 партий/)).toBeInTheDocument();
  });

  it('диалог удаления человека называет партии и удаляет только по подтверждению', async () => {
    const forgetPerson = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ people: PEOPLE, forgetPerson }),
    );
    render(<Admin />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Удалить человека: Ваня' }),
    );
    expect(screen.getByText(/анкета останется/i)).toBeInTheDocument();
    expect(forgetPerson).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: /удалить навсегда/i }),
    );
    expect(forgetPerson).toHaveBeenCalledWith(1);
  });

  it('«Не удалять» в диалоге человека ничего не удаляет', async () => {
    const forgetPerson = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({ people: PEOPLE, forgetPerson }),
    );
    render(<Admin />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Удалить человека: Ваня' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /не удалять/i }));
    expect(forgetPerson).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /удалить навсегда/i }),
    ).not.toBeInTheDocument();
  });

  it('без людей в истории раздел говорит об этом', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ people: [] }));
    render(<Admin />);
    expect(screen.getByText(/в истории пока никого/i)).toBeInTheDocument();
  });
});

describe('Admin — правка и удаление анкеты', () => {
  const VANYA = {
    name: 'Ваня',
    interests: [{ area: 'Спорт', examples: ['Формула-1', 'хоккей'] }],
    boring: ['Мода'],
  };

  it('«Редактировать» запрашивает анкету у сервера', async () => {
    const getPlayer = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        players: [{ name: 'Ваня', date: '2026-08-26' }],
        getPlayer,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать анкету/i }),
    );
    expect(getPlayer).toHaveBeenCalledWith('Ваня');
  });

  it('форма открывается заполненной и сохраняет правку с originalName', async () => {
    const savePlayer = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        players: [{ name: 'Ваня', date: '2026-08-26' }],
        playerCard: { card: VANYA, extraLines: [] },
        savePlayer,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать анкету/i }),
    );

    expect(screen.getByLabelText('Имя')).toHaveValue('Ваня');
    expect(screen.getByLabelText('Спорт')).toHaveValue('Формула-1, хоккей');
    expect(screen.getByLabelText('Скучно')).toHaveValue('Мода');

    await userEvent.clear(screen.getByLabelText('Спорт'));
    await userEvent.type(screen.getByLabelText('Спорт'), 'биатлон');
    await userEvent.click(
      screen.getByRole('button', { name: /сохранить правку/i }),
    );

    expect(savePlayer).toHaveBeenCalledTimes(1);
    const [code, replace, originalName] = savePlayer.mock.calls[0];
    expect(replace).toBe(true);
    expect(originalName).toBe('Ваня');
    expect(JSON.parse(code as string)).toEqual({
      version: 1,
      name: 'Ваня',
      interests: [{ area: 'Спорт', examples: ['биатлон'] }],
      boring: ['Мода'],
    });
  });

  it('предупреждает про строки не из формы', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        players: [{ name: 'Ваня', date: '2026-08-26' }],
        playerCard: { card: VANYA, extraLines: ['Пометка ведущего.'] },
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать анкету/i }),
    );
    expect(screen.getByText(/строки не из формы/i)).toBeInTheDocument();
  });

  it('диалог удаления анкеты обещает только анкету и удаляет по подтверждению', async () => {
    const deletePlayerCard = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        players: [{ name: 'Ваня', date: '2026-08-26' }],
        deletePlayerCard,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /удалить анкету/i }),
    );

    expect(screen.getByText(/записи о партиях останутся/i)).toBeInTheDocument();
    expect(deletePlayerCard).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Убрать анкету' }),
    );
    expect(deletePlayerCard).toHaveBeenCalledWith('Ваня');
  });

  it('«Не убирать» в диалоге анкеты ничего не удаляет', async () => {
    const deletePlayerCard = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        players: [{ name: 'Ваня', date: '2026-08-26' }],
        deletePlayerCard,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /удалить анкету/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /не убирать/i }));
    expect(deletePlayerCard).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Убрать анкету' }),
    ).not.toBeInTheDocument();
  });
});
