import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Player } from './Player';
import { useRoomConnection } from './useRoomConnection';

vi.mock('./useRoomConnection', () => ({
  useRoomConnection: vi.fn(),
}));

const mockedUseRoomConnection = vi.mocked(useRoomConnection);

describe('Player', () => {
  it('calls join with the entered name on submit', async () => {
    const join = vi.fn();
    mockedUseRoomConnection.mockReturnValue({
      status: 'connecting',
      participants: [],
      selfId: null,
      lanUrl: null,
      join,
    });

    const user = userEvent.setup();
    render(<Player />);
    await user.type(screen.getByLabelText('Имя'), 'Ваня');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(join).toHaveBeenCalledWith('Ваня');
  });

  it('shows a message once joined instead of the form', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'joined',
      participants: [],
      selfId: 'p1',
      lanUrl: null,
      join: vi.fn(),
    });

    render(<Player />);

    expect(screen.getByText('Ты в игре. Жди начала.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument();
  });

  it('shows an error when the name is taken', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'name-taken',
      participants: [],
      selfId: null,
      lanUrl: null,
      join: vi.fn(),
    });

    render(<Player />);

    expect(screen.getByRole('alert')).toHaveTextContent('уже занято');
  });
});
