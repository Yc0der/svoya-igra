import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Question {
  id: string;
  price: number;
  text: string;
  answer: string;
  comment?: string;
  type: 'обычный' | 'кот' | 'аукцион';
  // docs/superpowers/specs/2026-08-16-photo-questions-design.md, «Правило» —
  // имя файла без пути; полный путь/URL собирает сервер (room.ts) как
  // `/media/<пак>/<image>`. Только основной раунд — финал
  // (FinalTheme.question) картинок не получает в этой вехе.
  image?: string;
  // docs/superpowers/specs/2026-08-18-video-questions-design.md, «Формат пакета» —
  // ничего не скачивается, только ссылка на публичный YouTube-ролик и таймкод.
  // audioOnly — не показывать сам ролик на табло, только звук (Board.tsx/VideoPlayer.tsx).
  video?: {
    youtubeId: string;
    startSeconds: number;
    durationSeconds: number;
    audioOnly?: boolean;
  };
}

export interface MissingMedia {
  questionId: string;
  image: string;
}

export interface UnreachableVideo {
  questionId: string;
  youtubeId: string;
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
  description?: string;
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
  let image: string | undefined;
  if (question.image !== undefined) {
    image = requireNonEmptyString(question.image, `${where}.image`);
    if (image.includes('/') || image.includes('\\')) {
      throw new Error(`${where}.image: должно быть именем файла без пути`);
    }
  }
  let video: Question['video'];
  if (question.video !== undefined) {
    const videoData = requireRecord(question.video, `${where}.video`);
    const youtubeId = requireNonEmptyString(
      videoData.youtubeId,
      `${where}.video.youtubeId`,
    );
    const startSeconds = videoData.startSeconds;
    if (
      typeof startSeconds !== 'number' ||
      !Number.isFinite(startSeconds) ||
      startSeconds < 0
    ) {
      throw new Error(
        `${where}.video.startSeconds: должно быть неотрицательным числом`,
      );
    }
    const durationSeconds = videoData.durationSeconds;
    if (
      typeof durationSeconds !== 'number' ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      throw new Error(
        `${where}.video.durationSeconds: должно быть положительным числом`,
      );
    }
    if (
      videoData.audioOnly !== undefined &&
      typeof videoData.audioOnly !== 'boolean'
    ) {
      throw new Error(
        `${where}.video.audioOnly: если есть, должно быть булевым`,
      );
    }
    video = {
      youtubeId,
      startSeconds,
      durationSeconds,
      audioOnly: videoData.audioOnly as boolean | undefined,
    };
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
    image,
    video,
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
  if (pack.description !== undefined && typeof pack.description !== 'string') {
    throw new Error('пакет.description: если есть, должно быть строкой');
  }
  const roundsData = requireArray(pack.rounds, 'пакет.rounds');
  const rounds = roundsData.map((r, i) =>
    validateRound(r, `пакет.rounds[${i}]`),
  );
  const final =
    pack.final !== undefined
      ? validateFinal(pack.final, 'пакет.final')
      : undefined;
  checkUniqueQuestionIds(rounds, final);
  return {
    title,
    author,
    createdAt,
    description: pack.description as string | undefined,
    rounds,
    final,
  };
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

/**
 * Для каждого вопроса с `image` — существует ли файл `<mediaDir>/<image>`.
 * Возвращает список вопросов, для которых файла нет. Не используется живым
 * игровым сервером — только генератором (см. `scripts/validate-pack.ts`,
 * design.md «Валидация при генерации»): лишний I/O на каждый вопрос каждого
 * пака при обычной загрузке не нужен.
 */
export async function findMissingMedia(
  pack: Pack,
  mediaDir: string,
): Promise<MissingMedia[]> {
  const missing: MissingMedia[] = [];
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        if (!question.image) continue;
        try {
          await access(join(mediaDir, question.image));
        } catch {
          missing.push({ questionId: question.id, image: question.image });
        }
      }
    }
  }
  return missing;
}

/**
 * Для каждого вопроса с `video` — доступен ли ролик через официальный
 * YouTube oEmbed (design.md 2026-08-18-video-questions-design.md, «Валидация
 * при генерации»). Возвращает список вопросов, чей ролик недоступен
 * (удалён, стал приватным, не встраивается). Не используется живым игровым
 * сервером — только генератором (`scripts/validate-pack.ts`): сетевой
 * запрос на каждый вопрос при каждой загрузке пака живым сервером
 * недопустим, тот же принцип, что и у findMissingMedia выше.
 */
export async function findUnreachableVideos(
  pack: Pack,
): Promise<UnreachableVideo[]> {
  const unreachable: UnreachableVideo[] = [];
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        if (!question.video) continue;
        const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
          `https://www.youtube.com/watch?v=${question.video.youtubeId}`,
        )}&format=json`;
        try {
          const res = await fetch(url);
          if (!res.ok) {
            unreachable.push({
              questionId: question.id,
              youtubeId: question.video.youtubeId,
            });
          }
        } catch {
          unreachable.push({
            questionId: question.id,
            youtubeId: question.video.youtubeId,
          });
        }
      }
    }
  }
  return unreachable;
}
