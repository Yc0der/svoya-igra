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
CREATE TABLE IF NOT EXISTS question_tags (
  id               INTEGER PRIMARY KEY,
  game_id          INTEGER NOT NULL REFERENCES games(id),
  question_id      TEXT NOT NULL,
  participant_id   TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  thumb            INTEGER NOT NULL,
  reason           TEXT,
  reason_text      TEXT,
  UNIQUE (game_id, question_id, participant_id)
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

export type Thumb = 'up' | 'down';

export interface QuestionTagInput {
  questionId: string;
  participantId: string;
  // Имя лежит копией рядом с id по той же причине, что и в played_questions:
  // оно человекочитаемо и переживает смену id.
  participantName: string;
  thumb: Thumb;
}

export interface QuestionTagRow extends QuestionTagInput {
  gameId: number;
  // Готовый вариант причины; null — игрок не разбирал этот вопрос в конце.
  reason: string | null;
  // Свободный текст; null — не писал.
  reasonText: string | null;
}

export interface ReviewItem {
  questionId: string;
  themeName: string;
  price: number;
  text: string;
  answer: string;
}

/**
 * Вопрос таким, каким его реально видели на экране в СЫГРАННОЙ партии, а не
 * содержимое файла пакета прямо сейчас — то, из чего собирается жалоба в
 * профиль генератора за разбор в конце игры (финальное ревью ветки, п. 2).
 *
 * До этой правки жалоба собиралась через room.getPackInfo().activeFilename —
 * то есть привязывалась к пакету, который активен ПРЯМО СЕЙЧАС, а не к тому,
 * на котором реально играли. На game-end ведущий волен переключить пакет к
 * следующей партии, пока остальные ещё дописывают разбор; тогда questionId
 * искался бы в чужом пакете — либо совпал бы по slug'у с другим вопросом
 * (id вида `r1-<slug>-<price>`, slug'и тем между пакетами легко повторяются),
 * либо не нашёлся бы вовсе, и жалоба молча терялась в проглоченном catch.
 * Чтение из played_questions этой партии устраняет обе проблемы разом: не
 * зависит от того, какой пакет активен сейчас, не трогает диск на каждую
 * отправку и переживает правку пакета после партии — в профиль попадает тот
 * текст, который люди реально видели на экране.
 */
export interface TagComplaintContext {
  packFilename: string;
  packTitle: string;
  themeName: string;
  price: number;
  text: string;
  answer: string;
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
  recordTag(gameId: number, tag: QuestionTagInput): void;
  clearTag(gameId: number, questionId: string, participantId: string): void;
  // true — только если строка реально обновилась (участник действительно
  // ставил палец вниз именно по этому вопросу). Вызывающий код обязан
  // проверять возврат, а не считать запись состоявшейся по факту вызова
  // (ревью задачи 4, Important 1).
  recordTagReason(
    gameId: number,
    questionId: string,
    participantId: string,
    reason: string | null,
    reasonText: string | null,
  ): boolean;
  downTagsForReview(
    gameId: number,
    participantId: string,
    limit: number,
  ): ReviewItem[];
  // null — вопрос не найден в played_questions этой партии (устаревший/
  // подложный questionId). См. докстринг TagComplaintContext.
  complaintContext(
    gameId: number,
    questionId: string,
  ): TagComplaintContext | null;
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
      // Удаляем оценки перед удалением игры — иначе FK-ограничение
      // (question_tags.game_id REFERENCES games.id) упадёт на DELETE FROM games.
      this.db
        .prepare(`DELETE FROM question_tags WHERE game_id = ?`)
        .run(gameId);
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

  recordTag(gameId: number, tag: QuestionTagInput): void {
    try {
      // Upsert по UNIQUE (game_id, question_id, participant_id) — это и есть
      // «передумал»: повторная оценка того же игрока по тому же вопросу
      // обновляет строку, а не заводит вторую.
      this.db
        .prepare(
          `INSERT INTO question_tags
             (game_id, question_id, participant_id, participant_name, thumb)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (game_id, question_id, participant_id)
           DO UPDATE SET thumb = excluded.thumb`,
        )
        .run(
          gameId,
          tag.questionId,
          tag.participantId,
          tag.participantName,
          tag.thumb === 'up' ? 1 : 0,
        );
    } catch (err) {
      console.error('История: не удалось записать оценку вопроса —', err);
    }
  }

  clearTag(gameId: number, questionId: string, participantId: string): void {
    try {
      this.db
        .prepare(
          `DELETE FROM question_tags
           WHERE game_id = ? AND question_id = ? AND participant_id = ?`,
        )
        .run(gameId, questionId, participantId);
    } catch (err) {
      console.error('История: не удалось снять оценку вопроса —', err);
    }
  }

  /**
   * Возвращает true, только если строка реально обновилась — то есть этот
   * участник действительно ставил палец ВНИЗ именно по этому вопросу
   * (`AND thumb = 0` в WHERE) И ещё не разбирал его (`AND reason IS NULL
   * AND reason_text IS NULL`). Без этой проверки и без проверки возврата
   * вызывающим кодом жалоба уходила бы в профиль генератора по одному
   * только присланному клиентом questionId, включая устаревший/подложный —
   * ревью задачи 4, Important 1.
   *
   * Второе условие — «разобрал — больше не спрашиваем» (правило уже описано
   * в докстринге downTagsForReview, но раньше не было в этом WHERE): без
   * него повторный тап по «Отправить» с тем же уже заполненным reason/text
   * снова матчил бы строку (SQLite засчитывает совпавший WHERE как
   * изменение, даже если новые значения совпадают со старыми), возвращал бы
   * true и дописывал бы в docs/pack-generator-profile.md вторую, возможно
   * противоречащую первой, претензию на один и тот же вопрос (финальное
   * ревью ветки, п. 3).
   */
  recordTagReason(
    gameId: number,
    questionId: string,
    participantId: string,
    reason: string | null,
    reasonText: string | null,
  ): boolean {
    try {
      // Пустые строки приводятся к null: по этим двум полям задача 4 отбирает
      // неразобранные вопросы через WHERE reason IS NULL AND reason_text IS NULL.
      // Пустая строка вместо NULL молча убрала бы вопрос из списка разбора.
      const result = this.db
        .prepare(
          `UPDATE question_tags SET reason = ?, reason_text = ?
           WHERE game_id = ? AND question_id = ? AND participant_id = ?
             AND thumb = 0 AND reason IS NULL AND reason_text IS NULL`,
        )
        .run(
          reason === null || reason === '' ? null : reason,
          reasonText === null || reasonText === '' ? null : reasonText,
          gameId,
          questionId,
          participantId,
        );
      return Number(result.changes) > 0;
    } catch (err) {
      console.error('История: не удалось записать причину оценки —', err);
      return false;
    }
  }

  /**
   * Помеченные вниз и ещё не разобранные вопросы одного игрока — материал
   * экрана разбора в конце партии.
   *
   * Условие «reason IS NULL AND reason_text IS NULL» и есть правило «разобрал
   * — больше не спрашиваем»: заполненная причина убирает вопрос из списка, и
   * второй раз то же самое человеку не покажут.
   */
  downTagsForReview(
    gameId: number,
    participantId: string,
    limit: number,
  ): ReviewItem[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT q.question_id, q.theme_name, q.price, q.text, q.answer
           FROM question_tags t
           JOIN played_questions q
             ON q.game_id = t.game_id AND q.question_id = t.question_id
           WHERE t.game_id = ? AND t.participant_id = ? AND t.thumb = 0
             AND t.reason IS NULL AND t.reason_text IS NULL
           ORDER BY q.id
           LIMIT ?`,
        )
        .all(gameId, participantId, limit) as Record<string, unknown>[];
      return rows.map((row) => ({
        questionId: row.question_id as string,
        themeName: row.theme_name as string,
        price: Number(row.price),
        text: row.text as string,
        answer: row.answer as string,
      }));
    } catch (err) {
      console.error('История: не удалось прочитать оценки для разбора —', err);
      return [];
    }
  }

  /**
   * Материал для жалобы в профиль генератора — см. докстринг
   * TagComplaintContext. Читает played_questions/games ЭТОЙ партии, а не
   * текущий активный пакет: questionId ищется среди вопросов, которые в этой
   * партии реально были сыграны (recordPlayedQuestion в room.ts пишет туда
   * каждый закрывшийся вопрос), поэтому подмена активного пакета между
   * game-end и отправкой разбора на него не влияет.
   */
  complaintContext(
    gameId: number,
    questionId: string,
  ): TagComplaintContext | null {
    try {
      const row = this.db
        .prepare(
          `SELECT g.pack_filename, g.pack_title, q.theme_name, q.price,
                  q.text, q.answer
           FROM played_questions q
           JOIN games g ON g.id = q.game_id
           WHERE q.game_id = ? AND q.question_id = ?
           LIMIT 1`,
        )
        .get(gameId, questionId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        packFilename: row.pack_filename as string,
        packTitle: row.pack_title as string,
        themeName: row.theme_name as string,
        price: Number(row.price),
        text: row.text as string,
        answer: row.answer as string,
      };
    } catch (err) {
      console.error('История: не удалось прочитать контекст жалобы —', err);
      return null;
    }
  }

  allTags(): QuestionTagRow[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM question_tags ORDER BY id`)
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        gameId: Number(row.game_id),
        questionId: row.question_id as string,
        participantId: row.participant_id as string,
        participantName: row.participant_name as string,
        thumb: Number(row.thumb) === 1 ? 'up' : 'down',
        reason: (row.reason as string | null) ?? null,
        reasonText: (row.reason_text as string | null) ?? null,
      }));
    } catch (err) {
      console.error('История: не удалось прочитать оценки —', err);
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
  // Есть ли у вопроса картинка или видео. Определяет, чем вопрос опознаётся
  // при сверке — см. findRepeats ниже.
  hasMedia: boolean;
}

// Все вопросы пакета одним списком — и сетка раундов, и финальные темы.
// Финал проверяется наравне с остальными: это самый памятный вопрос вечера,
// и повторить его было бы обиднее всего. У финальной темы медиа не бывает
// вовсе (pack.ts, FinalTheme.question) — отсюда hasMedia: false.
function eachQuestion(pack: Pack): PackQuestion[] {
  const questions: PackQuestion[] = [];
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        questions.push({
          id: question.id,
          text: question.text,
          answer: question.answer,
          hasMedia: Boolean(question.image ?? question.video),
        });
      }
    }
  }
  for (const theme of pack.final?.themes ?? []) {
    questions.push({
      id: theme.question.id,
      text: theme.question.text,
      answer: theme.question.answer,
      hasMedia: false,
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
 *
 * **Чем опознаётся «тот же вопрос» — зависит от того, есть ли у него медиа**
 * (живая проверка, 2026-08-21). Это не оптимизация, а про то, чем вопрос
 * вообще является:
 *
 * - **есть картинка или видео** → опознаётся парой «текст + ответ». У всех
 *   пяти вопросов фото-темы формулировка дословно одна и та же («Какое
 *   животное изображено на фотографии?»), потому что вся суть в картинке, а не
 *   в словах. Сравнивай их по тексту — и свежий вопрос про капибару оказался бы
 *   «повтором» сыгранного пингвина и был бы забракован намертво, и так каждый
 *   фото-вопрос в каждом будущем пакете. Различает их ответ;
 * - **медиа нет** → опознаётся одним текстом. Здесь личность вопроса как раз в
 *   формулировке, а ответ к ней записывают по-разному: «1939» и «В 1939» — это
 *   один и тот же сыгранный вопрос, и требовать совпадения ответа значило бы
 *   пропускать настоящие повторы из-за предлога.
 *
 * Переформулированный вопрос про тот же факт при этом не теряется ни в одной из
 * веток: у него совпадёт ответ, и он придёт мягким предупреждением — ровно как
 * задумано правилом выше.
 */
export function findRepeats(
  pack: Pack,
  history: PlayedQuestionRow[],
): RepeatReport {
  // Разделитель — \u0000, а не пробел: нормализованный текст сам состоит из
  // слов через пробелы, поэтому на пробеле склейка ("а б" + "в") совпала бы
  // с ("а" + "б в"). Нулевой байт нормализация не пропускает никогда — после
  // неё остаются только буквы, цифры и пробелы, — так что ложных совпадений
  // он не даёт.
  const questionKey = (text: string, answer: string): string =>
    `${normalizeForCompare(text)}\u0000${normalizeForCompare(answer)}`;
  // Две раскладки истории, потому что медиа-вопрос и текстовый опознаются
  // по-разному (см. комментарий к функции). История не помнит, была ли у
  // сыгранного вопроса картинка, — и это не нужно: ветку выбирает
  // проверяемый вопрос из нового пакета, а обе раскладки строятся по одним
  // и тем же строкам.
  const byTextAndAnswer = new Map<string, PlayedQuestionRow>();
  const byText = new Map<string, PlayedQuestionRow>();
  const byAnswer = new Map<string, PlayedQuestionRow>();
  for (const row of history) {
    const key = questionKey(row.text, row.answer);
    const text = normalizeForCompare(row.text);
    const answer = normalizeForCompare(row.answer);
    if (!byTextAndAnswer.has(key)) byTextAndAnswer.set(key, row);
    if (!byText.has(text)) byText.set(text, row);
    if (!byAnswer.has(answer)) byAnswer.set(answer, row);
  }
  const report: RepeatReport = { sameQuestion: [], sameAnswer: [] };
  for (const question of eachQuestion(pack)) {
    const previousByQuestion = question.hasMedia
      ? byTextAndAnswer.get(questionKey(question.text, question.answer))
      : byText.get(normalizeForCompare(question.text));
    if (previousByQuestion) {
      report.sameQuestion.push({
        questionId: question.id,
        text: question.text,
        answer: question.answer,
        previous: {
          text: previousByQuestion.text,
          answer: previousByQuestion.answer,
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
