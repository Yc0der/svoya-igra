import { readFile } from 'node:fs/promises';

export interface Question {
  id: string;
  price: number;
  text: string;
  answer: string;
  comment?: string;
  type: 'обычный' | 'кот' | 'аукцион';
}

export interface Theme {
  name: string;
  questions: Question[];
}

export interface Round {
  themes: Theme[];
}

export interface FinalTheme {
  name: string;
  question: {
    id: string;
    text: string;
    answer: string;
    comment?: string;
  };
}

export interface Pack {
  title: string;
  author: string;
  createdAt: string;
  rounds: Round[];
  final?: { themes: FinalTheme[] };
}

const QUESTION_TYPES = new Set(['обычный', 'кот', 'аукцион']);

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${where}: должно быть строкой`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, where: string): string {
  const str = requireString(value, where);
  if (str.length === 0) {
    throw new Error(`${where}: не должно быть пустой строкой`);
  }
  return str;
}

function requireArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${where}: должно быть непустым массивом`);
  }
  return value;
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${where}: должно быть объектом`);
  }
  return value as Record<string, unknown>;
}

function validateQuestion(data: unknown, where: string): Question {
  const question = requireRecord(data, where);
  const id = requireNonEmptyString(question.id, `${where}.id`);
  const price = question.price;
  if (typeof price !== 'number' || price <= 0) {
    throw new Error(`${where}.price: должно быть положительным числом`);
  }
  const text = requireNonEmptyString(question.text, `${where}.text`);
  const answer = requireNonEmptyString(question.answer, `${where}.answer`);
  if (question.comment !== undefined && typeof question.comment !== 'string') {
    throw new Error(`${where}.comment: если есть, должно быть строкой`);
  }
  const type = question.type;
  if (typeof type !== 'string' || !QUESTION_TYPES.has(type)) {
    throw new Error(
      `${where}.type: должно быть одним из: обычный, кот, аукцион`,
    );
  }
  return {
    id,
    price,
    text,
    answer,
    comment: question.comment as string | undefined,
    type: type as Question['type'],
  };
}

function validateFinalQuestion(
  data: unknown,
  where: string,
): FinalTheme['question'] {
  const question = requireRecord(data, where);
  const id = requireNonEmptyString(question.id, `${where}.id`);
  const text = requireNonEmptyString(question.text, `${where}.text`);
  const answer = requireNonEmptyString(question.answer, `${where}.answer`);
  if (question.comment !== undefined && typeof question.comment !== 'string') {
    throw new Error(`${where}.comment: если есть, должно быть строкой`);
  }
  return { id, text, answer, comment: question.comment as string | undefined };
}

function validateFinalTheme(data: unknown, where: string): FinalTheme {
  const theme = requireRecord(data, where);
  const name = requireNonEmptyString(theme.name, `${where}.name`);
  const question = validateFinalQuestion(theme.question, `${where}.question`);
  return { name, question };
}

function validateFinal(data: unknown, where: string): { themes: FinalTheme[] } {
  const final = requireRecord(data, where);
  const themesData = requireArray(final.themes, `${where}.themes`);
  if (themesData.length < 2) {
    throw new Error(`${where}.themes: должно быть минимум две темы`);
  }
  const themes = themesData.map((t, i) =>
    validateFinalTheme(t, `${where}.themes[${i}]`),
  );
  return { themes };
}

function validateTheme(data: unknown, where: string): Theme {
  const theme = requireRecord(data, where);
  const name = requireNonEmptyString(theme.name, `${where}.name`);
  const questionsData = requireArray(theme.questions, `${where}.questions`);
  const questions = questionsData.map((q, i) =>
    validateQuestion(q, `${where}.questions[${i}]`),
  );
  return { name, questions };
}

function validateRound(data: unknown, where: string): Round {
  const round = requireRecord(data, where);
  const themesData = requireArray(round.themes, `${where}.themes`);
  const themes = themesData.map((t, i) =>
    validateTheme(t, `${where}.themes[${i}]`),
  );
  return { themes };
}

function checkUniqueQuestionIds(
  rounds: Round[],
  final: { themes: FinalTheme[] } | undefined,
): void {
  // Движок использует `id` вопроса как глобальный ключ на весь пакет
  // (answeredQuestionIds, grid[].answered, findQuestion) — дубль id в
  // написанном руками пакете иначе тихо портит партию (вопрос показывается
  // уже отвеченным ещё до того, как его вообще открыли) вместо явной ошибки
  // валидации на загрузке.
  const seen = new Set<string>();
  for (const round of rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        if (seen.has(question.id)) {
          throw new Error(
            `пакет: повторяющийся id вопроса "${question.id}" — id должны быть уникальны на весь пакет`,
          );
        }
        seen.add(question.id);
      }
    }
  }
  if (final) {
    for (const theme of final.themes) {
      if (seen.has(theme.question.id)) {
        throw new Error(
          `пакет: повторяющийся id вопроса "${theme.question.id}" — id должны быть уникальны на весь пакет`,
        );
      }
      seen.add(theme.question.id);
    }
  }
}

export function validatePack(data: unknown): Pack {
  const pack = requireRecord(data, 'пакет');
  const title = requireString(pack.title, 'пакет.title');
  const author = requireString(pack.author, 'пакет.author');
  const createdAt = requireString(pack.createdAt, 'пакет.createdAt');
  const roundsData = requireArray(pack.rounds, 'пакет.rounds');
  const rounds = roundsData.map((r, i) =>
    validateRound(r, `пакет.rounds[${i}]`),
  );
  const final =
    pack.final !== undefined
      ? validateFinal(pack.final, 'пакет.final')
      : undefined;
  checkUniqueQuestionIds(rounds, final);
  return { title, author, createdAt, rounds, final };
}

export async function loadPack(path: string): Promise<Pack> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Пакет ${path} — невалидный JSON: ${(err as Error).message}`,
    );
  }
  return validatePack(parsed);
}
