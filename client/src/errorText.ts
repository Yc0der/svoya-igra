import type { StartGameErrorReason } from './useRoomConnection';

export const START_GAME_ERROR_TEXT: Record<StartGameErrorReason, string> = {
  'not-enough-players': 'Нужно минимум два игрока.',
  'no-pack': 'На сервере нет пакета вопросов.',
  'game-in-progress': 'Партия уже идёт.',
  'host-required':
    'Нужен ведущий, чтобы играть втроём и больше — кто-то должен нажать «Стать ведущим».',
  'host-only': 'Начать игру может только ведущий.',
};
