// Хранилище истории сыгранных партий (design.md,
// 2026-08-20-game-history-design.md). Единственное место в сервере, знающее
// про SQL. Игровой движок сюда не заглядывает вообще — пишет только Room.
import { DatabaseSync } from 'node:sqlite';

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
  id          INTEGER PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  question_id TEXT NOT NULL,
  round_index INTEGER NOT NULL,
  theme_name  TEXT NOT NULL,
  price       INTEGER NOT NULL,
  type        TEXT NOT NULL,
  text        TEXT NOT NULL,
  answer      TEXT NOT NULL,
  answered_by TEXT,
  correct     INTEGER,
  contested   INTEGER
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
              text, answer, answered_by, correct, contested)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      return rows.map((row) => ({
        gameId: Number(row.game_id),
        questionId: row.question_id as string,
        roundIndex: Number(row.round_index),
        themeName: row.theme_name as string,
        price: Number(row.price),
        type: row.type as string,
        text: row.text as string,
        answer: row.answer as string,
        answeredBy: (row.answered_by as string | null) ?? null,
        correct: toBool(row.correct),
        contested: toBool(row.contested),
      }));
    } catch (err) {
      console.error('История: не удалось прочитать сыгранные вопросы —', err);
      return [];
    }
  }
}
