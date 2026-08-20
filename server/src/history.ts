// Хранилище истории сыгранных партий (design.md,
// 2026-08-20-game-history-design.md). Единственное место в сервере, знающее
// про SQL. Игровой движок сюда не заглядывает вообще — пишет только Room.
import { DatabaseSync } from 'node:sqlite';
import type { Pack } from './pack.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL,
  pack_filename TEXT NOT NULL,
  pack_title    TEXT NOT NULL,
  participants  TEXT NOT NULL,
  final_scores  TEXT
);
CREATE TABLE IF NOT EXISTS played_questions (
  id                    INTEGER PRIMARY KEY,
  game_id               INTEGER NOT NULL REFERENCES games(id),
  question_id           TEXT NOT NULL,
  round_index           INTEGER NOT NULL,
  theme_name            TEXT NOT NULL,
  price                 INTEGER NOT NULL,
  type                  TEXT NOT NULL,
  text                  TEXT NOT NULL,
  answer                TEXT NOT NULL,
  answered_by           TEXT,
  answered_by_counter_id TEXT,
  correct               INTEGER,
  contested             INTEGER
);
`;

export interface ParticipantRecord {
  counterId: string;
  name: string;
}

export interface StartGameInput {
  startedAt: string;
  packFilename: string;
  packTitle: string;
  participants: ParticipantRecord[];
}

export interface PlayedQuestionInput {
  questionId: string;
  // -1 у финального вопроса: он не принадлежит ни одному раунду сетки.
  roundIndex: number;
  themeName: string;
  // 0 у финального вопроса: цены у него нет, ставки делаются каждым отдельно.
  price: number;
  // 'обычный' | 'кот' | 'аукцион' из пакета, либо 'финал' — четвёртое
  // значение нашей колонки, в формате пакета его нет.
  type: string;
  text: string;
  answer: string;
  answeredBy: string | null;
  // Тот же отвечавший, что и answeredBy, но по counterId, а не по имени.
  // Имя остаётся отдельным полем — оно человекочитаемо и переживает смену
  // id, а counterId нужен, чтобы связать «кто отвечал» с games.participants
  // и games.final_scores без сопоставления строк по имени (design.md,
  // 2026-08-20-game-history-design.md). NULL там же, где и answeredBy.
  answeredByCounterId: string | null;
  correct: boolean | null;
  contested: boolean | null;
}

export interface PlayedQuestionRow extends PlayedQuestionInput {
  gameId: number;
}

export interface GameRow {
  id: number;
  startedAt: string;
  packFilename: string;
  packTitle: string;
  participants: ParticipantRecord[];
  finalScores: Record<string, number> | null;
}

/**
 * Узкий интерфейс, который видит Room. Специально не класс: в тестах комнаты
 * подставляется фейк, и ни один тест Room не открывает настоящую базу.
 */
export interface HistoryRecorder {
  startGame(input: StartGameInput): number | null;
  recordQuestion(gameId: number, row: PlayedQuestionInput): void;
  finishGame(gameId: number, finalScores: Record<string, number>): void;
  discardGame(gameId: number): void;
}

/**
 * Приводит текст к виду, в котором его можно сравнивать с другим текстом:
 * нижний регистр, `ё` → `е`, пунктуация → пробел, схлопнутые пробелы.
 *
 * Ловит буквальные и почти-буквальные совпадения. Смысловые повторы («тот же
 * факт другими словами») она не ловит и не должна — за них отвечает окно в
 * Шаге 0 генератора, где решает суждение, а не сравнение строк.
 */
export function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toInt(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function toBool(value: unknown): boolean | null {
  return value === null || value === undefined ? null : Number(value) === 1;
}

// Общий маппер строки played_questions → PlayedQuestionRow, вынесенный из
// allPlayedQuestions(), чтобы recentPlayed() ниже не заводил вторую копию
// той же логики распаковки колонок.
function mapPlayedQuestionRow(row: Record<string, unknown>): PlayedQuestionRow {
  return {
    gameId: Number(row.game_id),
    questionId: row.question_id as string,
    roundIndex: Number(row.round_index),
    themeName: row.theme_name as string,
    price: Number(row.price),
    type: row.type as string,
    text: row.text as string,
    answer: row.answer as string,
    answeredBy: (row.answered_by as string | null) ?? null,
    answeredByCounterId: (row.answered_by_counter_id as string | null) ?? null,
    correct: toBool(row.correct),
    contested: toBool(row.contested),
  };
}

export class GameHistory implements HistoryRecorder {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close(): void {
    try {
      this.db.close();
    } catch (err) {
      console.error('История: не удалось закрыть базу —', err);
    }
  }

  startGame(input: StartGameInput): number | null {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO games (started_at, pack_filename, pack_title, participants)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          input.startedAt,
          input.packFilename,
          input.packTitle,
          JSON.stringify(input.participants),
        );
      return Number(result.lastInsertRowid);
    } catch (err) {
      console.error('История: не удалось начать запись партии —', err);
      return null;
    }
  }

  recordQuestion(gameId: number, row: PlayedQuestionInput): void {
    try {
      this.db
        .prepare(
          `INSERT INTO played_questions
             (game_id, question_id, round_index, theme_name, price, type,
              text, answer, answered_by, answered_by_counter_id, correct,
              contested)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          gameId,
          row.questionId,
          row.roundIndex,
          row.themeName,
          row.price,
          row.type,
          row.text,
          row.answer,
          row.answeredBy,
          row.answeredByCounterId,
          toInt(row.correct),
          toInt(row.contested),
        );
    } catch (err) {
      console.error('История: не удалось записать вопрос —', err);
    }
  }

  finishGame(gameId: number, finalScores: Record<string, number>): void {
    try {
      this.db
        .prepare(`UPDATE games SET final_scores = ? WHERE id = ?`)
        .run(JSON.stringify(finalScores), gameId);
    } catch (err) {
      console.error('История: не удалось записать итог партии —', err);
    }
  }

  discardGame(gameId: number): void {
    try {
      this.db
        .prepare(`DELETE FROM played_questions WHERE game_id = ?`)
        .run(gameId);
      this.db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
    } catch (err) {
      console.error('История: не удалось выбросить партию —', err);
    }
  }

  allGames(): GameRow[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM games ORDER BY id`)
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        id: Number(row.id),
        startedAt: row.started_at as string,
        packFilename: row.pack_filename as string,
        packTitle: row.pack_title as string,
        participants: JSON.parse(
          row.participants as string,
        ) as ParticipantRecord[],
        finalScores:
          row.final_scores === null
            ? null
            : (JSON.parse(row.final_scores as string) as Record<
                string,
                number
              >),
      }));
    } catch (err) {
      console.error('История: не удалось прочитать список партий —', err);
      return [];
    }
  }

  allPlayedQuestions(): PlayedQuestionRow[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM played_questions ORDER BY id`)
        .all() as Record<string, unknown>[];
      return rows.map(mapPlayedQuestionRow);
    } catch (err) {
      console.error('История: не удалось прочитать сыгранные вопросы —', err);
      return [];
    }
  }

  /**
   * Вопросы последних `gameLimit` партий, в которых реально был сыгран хотя
   * бы один вопрос. Партии-фальстарты (кто-то отвалился, не тот пакет,
   * поздно подключился телефон) создают строку в `games`, но ни одного
   * вопроса в `played_questions` — окно намеренно набирается от вторых, а не
   * от первых: иначе пять фальстартов подряд вытеснили бы из окна всё, что
   * реально игралось (финальное ревью ветки, п. 3).
   *
   * Ограничение по партиям, а не по числу строк: окно не должно расти вместе
   * с базой. `DISTINCT game_id` в подзапросе и `LIMIT` в основном — один
   * запрос, а не чтение всей истории с фильтрацией в памяти (design.md,
   * 2026-08-20-game-history-design.md, «Окно не растёт вместе с историей»).
   */
  recentPlayed(gameLimit: number): PlayedQuestionRow[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM played_questions
             WHERE game_id IN (
               SELECT DISTINCT game_id FROM played_questions
               ORDER BY game_id DESC
               LIMIT ?
             )
             ORDER BY id`,
        )
        .all(gameLimit) as Record<string, unknown>[];
      return rows.map(mapPlayedQuestionRow);
    } catch (err) {
      console.error('История: не удалось прочитать последние партии —', err);
      return [];
    }
  }
}

/**
 * Окно для Шага 0 генератора: только ответы, сгруппированные по темам.
 *
 * Текст вопроса сюда намеренно не попадает — увидев «Тарантино» в теме про
 * кино, генератор и так не станет писать про Тарантино второй раз, а полный
 * текст стоил бы примерно вшестеро больше токенов без выигрыша в результате
 * (design.md, 2026-08-20-game-history-design.md, «Окно»).
 */
export function formatRecentWindow(rows: PlayedQuestionRow[]): string {
  // Дедупликация — по normalizeForCompare (та же функция, что и в
  // findRepeats): «Канберра» и «канберра» из разных партий не должны
  // занимать два места в окне. Печатается при этом ИСХОДНОЕ написание —
  // нормализованная строка нужна только для сравнения, попади она на
  // экран генератора, была бы менее узнаваемой (финальное ревью ветки, п.
  // 6).
  const byTheme = new Map<string, string[]>();
  const seenByTheme = new Map<string, Set<string>>();
  for (const row of rows) {
    const answers = byTheme.get(row.themeName) ?? [];
    const seen = seenByTheme.get(row.themeName) ?? new Set<string>();
    const normalized = normalizeForCompare(row.answer);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      answers.push(row.answer);
    }
    byTheme.set(row.themeName, answers);
    seenByTheme.set(row.themeName, seen);
  }
  return [...byTheme.entries()]
    .map(([theme, answers]) => `${theme}: ${answers.join(', ')}`)
    .join('\n');
}

export interface RepeatFinding {
  questionId: string;
  text: string;
  answer: string;
  previous: { text: string; answer: string };
}

export interface RepeatReport {
  sameQuestion: RepeatFinding[];
  sameAnswer: RepeatFinding[];
}

interface PackQuestion {
  id: string;
  text: string;
  answer: string;
}

// Все вопросы пакета одним списком — и сетка раундов, и финальные темы.
// Финал проверяется наравне с остальными: это самый памятный вопрос вечера,
// и повторить его было бы обиднее всего.
function eachQuestion(pack: Pack): PackQuestion[] {
  const questions: PackQuestion[] = [];
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        questions.push({
          id: question.id,
          text: question.text,
          answer: question.answer,
        });
      }
    }
  }
  for (const theme of pack.final?.themes ?? []) {
    questions.push({
      id: theme.question.id,
      text: theme.question.text,
      answer: theme.question.answer,
    });
  }
  return questions;
}

/**
 * Сверяет пакет со ВСЕЙ переданной историей.
 *
 * Правило «жёстко — вопрос, мягко — ответ» (design.md,
 * 2026-08-20-game-history-design.md, «Сверка»): совпадение вопроса —
 * безусловный брак, совпадение ответа — предупреждение. Жёсткий запрет на
 * повтор ответа не годится: 50 вопросов за партию, через двадцать партий
 * тысяча фактов оказалась бы выкошена, и генератор начал бы писать всё более
 * натянутые вопросы.
 *
 * Вопрос, попавший в sameQuestion, в sameAnswer уже не повторяется: одно и то
 * же место чинится один раз, а два сообщения про него только запутали бы.
 */
export function findRepeats(
  pack: Pack,
  history: PlayedQuestionRow[],
): RepeatReport {
  const byText = new Map<string, PlayedQuestionRow>();
  const byAnswer = new Map<string, PlayedQuestionRow>();
  for (const row of history) {
    const text = normalizeForCompare(row.text);
    const answer = normalizeForCompare(row.answer);
    if (!byText.has(text)) byText.set(text, row);
    if (!byAnswer.has(answer)) byAnswer.set(answer, row);
  }
  const report: RepeatReport = { sameQuestion: [], sameAnswer: [] };
  for (const question of eachQuestion(pack)) {
    const previousByText = byText.get(normalizeForCompare(question.text));
    if (previousByText) {
      report.sameQuestion.push({
        questionId: question.id,
        text: question.text,
        answer: question.answer,
        previous: {
          text: previousByText.text,
          answer: previousByText.answer,
        },
      });
      continue;
    }
    const previousByAnswer = byAnswer.get(normalizeForCompare(question.answer));
    if (previousByAnswer) {
      report.sameAnswer.push({
        questionId: question.id,
        text: question.text,
        answer: question.answer,
        previous: {
          text: previousByAnswer.text,
          answer: previousByAnswer.answer,
        },
      });
    }
  }
  return report;
}
