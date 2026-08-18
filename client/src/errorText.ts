import type {
  SelectQuestionErrorReason,
  StartGameErrorReason,
} from './useRoomConnection';

export const START_GAME_ERROR_TEXT: Record<StartGameErrorReason, string> = {
  'not-enough-players': 'Нужно минимум два игрока.',
  'no-pack': 'На сервере нет пакета вопросов.',
  'game-in-progress': 'Партия уже идёт.',
  'host-required':
    'Нужен ведущий, чтобы играть втроём и больше — кто-то должен нажать «Стать ведущим».',
  'host-only': 'Начать игру может только ведущий.',
};

// Текст намеренно не называет причину («кот») — design.md вехи
// 2026-08-12-cat-in-bag: только пикер и должен знать, что вопрос
// специальный, и то не раньше, чем получатель назначен.
export const SELECT_QUESTION_ERROR_TEXT: Record<
  SelectQuestionErrorReason,
  string
> = {
  'no-recipient':
    'Нельзя выбрать этот вопрос сейчас: не хватает игроков онлайн. Попробуй другой вопрос или подожди, пока все вернутся на связь.',
};
