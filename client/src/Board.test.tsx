import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from './Board';
import { useRoomConnection } from './useRoomConnection';

vi.mock('./useRoomConnection', () => ({
  useRoomConnection: vi.fn(),
}));

const mockedUseRoomConnection = vi.mocked(useRoomConnection);

describe('Board', () => {
  it('lists connected and disconnected participants', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'connecting',
      participants: [
        { id: '1', name: 'Ваня', connected: true },
        { id: '2', name: 'Катя', connected: false },
      ],
      selfId: null,
      lanUrl: 'http://192.168.1.42:8080/',
      join: vi.fn(),
    });

    render(<Board />);

    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText(/Катя/)).toHaveTextContent('отключён');
  });

  it('shows the LAN url as text and a QR code once known', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'connecting',
      participants: [],
      selfId: null,
      lanUrl: 'http://192.168.1.42:8080/',
      join: vi.fn(),
    });

    render(<Board />);

    expect(screen.getByText('http://192.168.1.42:8080/')).toBeInTheDocument();
    expect(screen.getByTitle('QR-код для входа')).toBeInTheDocument();
  });

  it('renders neither URL nor QR code before the LAN url is known', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'connecting',
      participants: [],
      selfId: null,
      lanUrl: null,
      join: vi.fn(),
    });

    render(<Board />);

    expect(screen.queryByTitle('QR-код для входа')).not.toBeInTheDocument();
  });
});
