import { useState, type FormEvent } from 'react';
import { useRoomConnection } from './useRoomConnection';

export function Player() {
  const { status, join } = useRoomConnection();
  const [name, setName] = useState('');

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) {
      join(name.trim());
    }
  }

  if (status === 'joined') {
    return <p>Ты в игре. Жди начала.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="name">Имя</label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <button type="submit" disabled={status === 'joining'}>
        Войти
      </button>
      {status === 'name-taken' && (
        <p role="alert">Это имя уже занято, выбери другое</p>
      )}
    </form>
  );
}
