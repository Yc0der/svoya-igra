# Video Questions (YouTube Embed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `video` field to `Question` that references a public YouTube clip
(id + timestamp) instead of a downloaded file, play it live on the board through the official
YouTube IFrame Player API behind a "Играть" button, and support an `audioOnly` presentation
mode that plays the same clip with the video track hidden behind a static placeholder.

**Architecture:** Mirrors the existing photo-questions feature's shape (optional field on
`Question` → same-visibility field on `GameStateView.currentQuestion` → board-only rendering)
but nothing is ever downloaded or stored server-side — the pack carries a YouTube video id and
a timestamp, and the client loads/plays it directly from YouTube at play time.

**Tech Stack:** Same as the rest of the project — TypeScript, Vitest, React on the client. New:
the YouTube IFrame Player API (loaded client-side from `https://www.youtube.com/iframe_api`,
no npm dependency).

## Global Constraints

- Nothing is downloaded for video questions — the pack stores `{ youtubeId, startSeconds,
durationSeconds, audioOnly? }`; `packs/media/` is untouched by this plan.
- `audioOnly?: boolean` on `Question.video` — when true, the board never shows the actual
  video frame, only a static placeholder image, while the audio still plays.
- Video is shown only on the board (`Board.tsx`) — never on phones (`Player.tsx` needs zero
  changes in this plan), same reasoning as photo questions plus avoiding multi-device audio
  chatter.
- Playback starts only on an explicit "▶ Играть" click on the board, never automatically —
  browser autoplay policy requires a real user gesture to unlock sound.
- `video` visibility on `GameStateView.currentQuestion` follows the exact same rule as
  `image`/`text`: `null` during `cat-handoff`/`auction-bidding`, populated once the question is
  open.
- `validate-pack.ts`'s new YouTube-oEmbed check is a soft warning, never a hard failure — same
  pattern as the existing missing-image-file check.
- The search/corroboration workflow that decides _which_ video and _what_ timestamp to use is
  agentic (`pack-generator/SKILL.md`), not code — no unit tests for it, same as image sourcing.
- `client/src/assets/sound-wave.gif` already exists in the repo (manually placed, see
  `docs/superpowers/specs/2026-08-18-video-questions-design.md`, «Отказы») — this plan only
  wires it in, does not need to source it.

---

### Task 1: `server/src/pack.ts` — `Question.video` field + `findUnreachableVideos`

**Files:**

- Modify: `server/src/pack.ts`
- Test: `server/src/pack.test.ts`

**Interfaces:**

- Produces: `Question.video?: { youtubeId: string; startSeconds: number; durationSeconds:
number; audioOnly?: boolean }`, `UnreachableVideo { questionId: string; youtubeId: string }`,
  `findUnreachableVideos(pack: Pack): Promise<UnreachableVideo[]>`. Later tasks (2, 5) import
  these exact names from `./pack.js`.

- [ ] **Step 1: Add the `video` field to the `Question` interface**

In `server/src/pack.ts`, add to the `Question` interface, right after the existing `image?:
string;` line:

```ts
  // docs/superpowers/specs/2026-08-18-video-questions-design.md, «Формат пакета» —
  // ничего не скачивается, только ссылка на публичный YouTube-ролик и таймкод.
  // audioOnly — не показывать сам ролик на табло, только звук (Board.tsx/VideoPlayer.tsx).
  video?: {
    youtubeId: string;
    startSeconds: number;
    durationSeconds: number;
    audioOnly?: boolean;
  };
```

- [ ] **Step 2: Add the `UnreachableVideo` interface**

Right after the existing `MissingMedia` interface, add:

```ts
export interface UnreachableVideo {
  questionId: string;
  youtubeId: string;
}
```

- [ ] **Step 3: Write the failing validation tests**

In `server/src/pack.test.ts`, add a top-level helper right after the existing `validPackData()`
function:

```ts
function packDataWithVideo(video: unknown) {
  const data = validPackData();
  (data.rounds[0].themes[0].questions[0] as { video?: unknown }).video = video;
  return data;
}
```

Then add a new `describe` block, placed right after the existing `describe('validatePack —
final', ...)` block closes (before `describe('loadPack', ...)`):

```ts
describe('validatePack — video', () => {
  it('accepts a question with a full video object', () => {
    const data = packDataWithVideo({
      youtubeId: 'dQw4w9WgXcQ',
      startSeconds: 30,
      durationSeconds: 15,
      audioOnly: true,
    });
    expect(validatePack(data).rounds[0].themes[0].questions[0].video).toEqual({
      youtubeId: 'dQw4w9WgXcQ',
      startSeconds: 30,
      durationSeconds: 15,
      audioOnly: true,
    });
  });

  it('accepts a question with video but no audioOnly', () => {
    const data = packDataWithVideo({
      youtubeId: 'dQw4w9WgXcQ',
      startSeconds: 0,
      durationSeconds: 10,
    });
    expect(
      validatePack(data).rounds[0].themes[0].questions[0].video?.audioOnly,
    ).toBeUndefined();
  });

  it('accepts a question with no video at all', () => {
    expect(
      validatePack(validPackData()).rounds[0].themes[0].questions[0].video,
    ).toBeUndefined();
  });

  it('rejects a non-object video', () => {
    const data = packDataWithVideo('not an object');
    expect(() => validatePack(data)).toThrow(/video/);
  });

  it('rejects a missing youtubeId', () => {
    const data = packDataWithVideo({ startSeconds: 0, durationSeconds: 10 });
    expect(() => validatePack(data)).toThrow(/youtubeId/);
  });

  it('rejects an empty youtubeId', () => {
    const data = packDataWithVideo({
      youtubeId: '',
      startSeconds: 0,
      durationSeconds: 10,
    });
    expect(() => validatePack(data)).toThrow(/youtubeId/);
  });

  it('rejects a non-number startSeconds', () => {
    const data = packDataWithVideo({
      youtubeId: 'dQw4w9WgXcQ',
      startSeconds: '30',
      durationSeconds: 10,
    });
    expect(() => validatePack(data)).toThrow(/startSeconds/);
  });

  it('rejects a negative startSeconds', () => {
    const data = packDataWithVideo({
      youtubeId: 'dQw4w9WgXcQ',
      startSeconds: -1,
      durationSeconds: 10,
    });
    expect(() => validatePack(data)).toThrow(/startSeconds/);
  });

  it('rejects a zero durationSeconds', () => {
    const data = packDataWithVideo({
      youtubeId: 'dQw4w9WgXcQ',
      startSeconds: 0,
      durationSeconds: 0,
    });
    expect(() => validatePack(data)).toThrow(/durationSeconds/);
  });

  it('rejects a negative durationSeconds', () => {
    const data = packDataWithVideo({
      youtubeId: 'dQw4w9WgXcQ',
      startSeconds: 0,
      durationSeconds: -5,
    });
    expect(() => validatePack(data)).toThrow(/durationSeconds/);
  });

  it('rejects a non-boolean audioOnly', () => {
    const data = packDataWithVideo({
      youtubeId: 'dQw4w9WgXcQ',
      startSeconds: 0,
      durationSeconds: 10,
      audioOnly: 'yes',
    });
    expect(() => validatePack(data)).toThrow(/audioOnly/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C server exec vitest run pack.test.ts`
Expected: FAIL — `video` is not yet validated/returned by `validateQuestion`.

- [ ] **Step 3: Implement `video` validation in `validateQuestion`**

In `server/src/pack.ts`, inside `validateQuestion`, right after the existing `image` validation
block (after the `let image: string | undefined; ... }` block, before `const type = ...`), add:

```ts
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
    throw new Error(`${where}.video.audioOnly: если есть, должно быть булевым`);
  }
  video = {
    youtubeId,
    startSeconds,
    durationSeconds,
    audioOnly: videoData.audioOnly as boolean | undefined,
  };
}
```

Then add `video,` to the object returned at the end of `validateQuestion` (alongside the
existing `image,`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C server exec vitest run pack.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing `findUnreachableVideos` tests**

In `server/src/pack.test.ts`, change the import line at the top of the file from:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findMissingMedia, loadPack, validatePack } from './pack.js';
```

to:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findMissingMedia,
  findUnreachableVideos,
  loadPack,
  validatePack,
} from './pack.js';
```

Then add a new `describe` block right after the existing `describe('findMissingMedia', ...)`
block closes (before `describe('the real packs/current.json', ...)`):

```ts
describe('findUnreachableVideos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty list when no question has video', async () => {
    const pack = validatePack(validPackData());
    expect(await findUnreachableVideos(pack)).toEqual([]);
  });

  it('returns an empty list when the oEmbed lookup responds ok', async () => {
    const pack = validatePack(
      packDataWithVideo({
        youtubeId: 'dQw4w9WgXcQ',
        startSeconds: 0,
        durationSeconds: 10,
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
    expect(await findUnreachableVideos(pack)).toEqual([]);
  });

  it('reports a question whose oEmbed lookup responds not-ok', async () => {
    const pack = validatePack(
      packDataWithVideo({
        youtubeId: 'dQw4w9WgXcQ',
        startSeconds: 0,
        durationSeconds: 10,
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false } as Response),
    );
    expect(await findUnreachableVideos(pack)).toEqual([
      { questionId: 'q1', youtubeId: 'dQw4w9WgXcQ' },
    ]);
  });

  it('reports a question whose oEmbed request throws', async () => {
    const pack = validatePack(
      packDataWithVideo({
        youtubeId: 'dQw4w9WgXcQ',
        startSeconds: 0,
        durationSeconds: 10,
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await findUnreachableVideos(pack)).toEqual([
      { questionId: 'q1', youtubeId: 'dQw4w9WgXcQ' },
    ]);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm -C server exec vitest run pack.test.ts`
Expected: FAIL — `findUnreachableVideos` does not exist yet.

- [ ] **Step 7: Implement `findUnreachableVideos`**

In `server/src/pack.ts`, add this function right after `findMissingMedia`:

```ts
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
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm -C server exec vitest run pack.test.ts`
Expected: PASS — all `validatePack`/`findMissingMedia`/`findUnreachableVideos` tests green.

- [ ] **Step 9: Commit**

```bash
git add server/src/pack.ts server/src/pack.test.ts
git commit -m "feat: add optional video field to questions, sourced from YouTube"
```

---

### Task 2: `server/src/protocol.ts` + `server/src/room.ts` — expose `video` on `GameStateView`

**Files:**

- Modify: `server/src/protocol.ts`, `server/src/room.ts`
- Test: `server/src/room.test.ts`, `server/src/server.test.ts`

**Interfaces:**

- Consumes: `Question.video` from Task 1.
- Produces: `GameStateView.currentQuestion.video: { youtubeId: string; startSeconds: number;
durationSeconds: number; audioOnly: boolean } | null`. Task 3 (client) mirrors this shape
  locally.

- [ ] **Step 1: Add `video` to `GameStateView.currentQuestion`**

In `server/src/protocol.ts`, inside the `GameStateView.currentQuestion` object type, add right
after the existing `image: string | null;` line:

```ts
    // Тот же принцип видимости, что у image/text — null во время
    // cat-handoff/торгов аукциона, иначе объект с youtubeId/таймкодом или
    // null, если у вопроса нет video (design.md,
    // 2026-08-18-video-questions-design.md, «Сервер и клиент»). audioOnly
    // здесь уже разрешён (false, если в паке отсутствовал) — клиенту не
    // нужно самому обрабатывать undefined.
    video: {
      youtubeId: string;
      startSeconds: number;
      durationSeconds: number;
      audioOnly: boolean;
    } | null;
```

- [ ] **Step 2: Write the failing room.ts tests**

In `server/src/room.test.ts`, add `video: null,` right after each existing `image: null,` line
at these four locations (search for `image: null,` — there are exactly four in this file):

1. Inside `it('walks a question from selection through a correct answer', ...)`.
2. Inside `it('hides the question text but shows the price while cat-handoff is in progress,
and reveals the text once assigned', ...)` — there are two occurrences in this test (before
   and after `assignCat`), add `video: null,` to both.
3. Inside the auction-bidding test (search for `expect(room.toGameStateView()?.currentQuestion).toEqual({` followed by `text: null,` and `themeName: 'Тема',` inside the auction describe
   block).

Then add three new tests right after the existing `it('does not build a media URL for a
question without an image', ...)` test (which itself stays unchanged):

```ts
it('exposes video for a question with video, defaulting audioOnly to false when absent', () => {
  const packWithVideo: Pack = {
    ...TEST_PACK,
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                ...TEST_PACK.rounds[0].themes[0].questions[0],
                video: {
                  youtubeId: 'dQw4w9WgXcQ',
                  startSeconds: 30,
                  durationSeconds: 15,
                },
              },
              TEST_PACK.rounds[0].themes[0].questions[1],
            ],
          },
        ],
      },
    ],
  };
  const room = new Room(undefined, packWithVideo);
  joinedId(room, 'Ваня');
  joinedId(room, 'Катя');
  room.startGame('requester');
  const picker = room.toGameStateView()!.turnParticipantId;
  room.selectQuestion(picker, 0, 'q1');
  expect(room.toGameStateView()?.currentQuestion?.video).toEqual({
    youtubeId: 'dQw4w9WgXcQ',
    startSeconds: 30,
    durationSeconds: 15,
    audioOnly: false,
  });
});

it('exposes audioOnly: true when the pack sets it', () => {
  const packWithVideo: Pack = {
    ...TEST_PACK,
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                ...TEST_PACK.rounds[0].themes[0].questions[0],
                video: {
                  youtubeId: 'dQw4w9WgXcQ',
                  startSeconds: 30,
                  durationSeconds: 15,
                  audioOnly: true,
                },
              },
              TEST_PACK.rounds[0].themes[0].questions[1],
            ],
          },
        ],
      },
    ],
  };
  const room = new Room(undefined, packWithVideo);
  joinedId(room, 'Ваня');
  joinedId(room, 'Катя');
  room.startGame('requester');
  const picker = room.toGameStateView()!.turnParticipantId;
  room.selectQuestion(picker, 0, 'q1');
  expect(room.toGameStateView()?.currentQuestion?.video?.audioOnly).toBe(true);
});

it('does not expose video for a question without video', () => {
  const { room, picker } = startedRoom();
  room.selectQuestion(picker, 0, 'q1');
  expect(room.toGameStateView()?.currentQuestion?.video).toBeNull();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm -C server exec vitest run room.test.ts`
Expected: FAIL — `currentQuestion` does not have a `video` key yet, so the `toEqual` assertions
mismatch and the three new tests get `undefined` instead of the expected values.

- [ ] **Step 4: Implement `video` in `Room.toGameStateView`**

In `server/src/room.ts`, inside the `currentQuestion` object literal in `toGameStateView`, add
a `video` field right after the existing `image:` field (which ends with the line
`` `/media/${this.activePackFilename.replace(/\.json$/, '')}/${currentQuestionData.image}`, ``
followed by `}`):

```ts
            video:
              game.phase === 'cat-handoff' ||
              game.phase === 'auction-bidding' ||
              !currentQuestionData.video
                ? null
                : {
                    youtubeId: currentQuestionData.video.youtubeId,
                    startSeconds: currentQuestionData.video.startSeconds,
                    durationSeconds: currentQuestionData.video.durationSeconds,
                    audioOnly: currentQuestionData.video.audioOnly ?? false,
                  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C server exec vitest run room.test.ts`
Expected: PASS

- [ ] **Step 6: Update `server.test.ts`**

In `server/src/server.test.ts`, add `video: null,` right after each of the two existing `image:
null,` lines (both inside the `describe('createServer cat-in-the-bag', ...)` block, one before
and one after the `assign-cat` message in the same test).

- [ ] **Step 7: Run the full server test suite**

Run: `pnpm -C server exec vitest run`
Expected: PASS — all server tests green, including `server.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add server/src/protocol.ts server/src/room.ts server/src/room.test.ts server/src/server.test.ts
git commit -m "feat: expose currentQuestion.video with the same cat/auction visibility as image"
```

---

### Task 3: `client/src/useRoomConnection.ts` — mirror `video` in the client's local type

**Files:**

- Modify: `client/src/useRoomConnection.ts`

**Interfaces:**

- Consumes: the wire shape from Task 2 (`GameStateView.currentQuestion.video`).
- Produces: `GameStateView.currentQuestion.video?: { youtubeId: string; startSeconds: number;
durationSeconds: number; audioOnly: boolean } | null` in the client's local mirror type. Task
  4 (`Board.tsx`) reads this field.

No test file — this task only changes a type declaration, mirroring exactly how `image?:
string | null` was added to this same local type for photo questions (no behavior, nothing to
unit test).

- [ ] **Step 1: Add `video` to the local `GameStateView.currentQuestion` type**

In `client/src/useRoomConnection.ts`, inside the `GameStateView.currentQuestion` object type,
add right after the existing `image?: string | null;` line:

```ts
    // Тот же приём, что и у image выше — необязательное поле в этом
    // локальном типе ради тестовых фикстур, которые собирают
    // currentQuestion вручную (Board.test.tsx). Реальные сообщения с
    // сервера всегда содержат video (Task 2, server/src/protocol.ts).
    video?: {
      youtubeId: string;
      startSeconds: number;
      durationSeconds: number;
      audioOnly: boolean;
    } | null;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C client exec tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/useRoomConnection.ts
git commit -m "feat: mirror currentQuestion.video in the client connection type"
```

---

### Task 4: `client/src/VideoPlayer.tsx` (new) + `Board.tsx` wiring + CSS

**Files:**

- Create: `client/src/VideoPlayer.tsx`
- Test: `client/src/VideoPlayer.test.tsx`
- Modify: `client/src/Board.tsx`, `client/src/Board.test.tsx`, `client/src/index.css`

**Interfaces:**

- Consumes: `game.currentQuestion.video` from Task 3 (already-narrowed non-null shape when
  rendered), `client/src/assets/sound-wave.gif` (already in the repo).
- Produces: `VideoPlayer` component, exported from `client/src/VideoPlayer.tsx`, taking a
  `video: { youtubeId: string; startSeconds: number; durationSeconds: number; audioOnly:
boolean }` prop.

- [ ] **Step 1: Write the failing `VideoPlayer` tests**

Create `client/src/VideoPlayer.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

const VIDEO = {
  youtubeId: 'dQw4w9WgXcQ',
  startSeconds: 30,
  durationSeconds: 15,
  audioOnly: false,
};

describe('VideoPlayer', () => {
  afterEach(() => {
    delete (window as { YT?: unknown }).YT;
    delete (window as { onYouTubeIframeAPIReady?: unknown })
      .onYouTubeIframeAPIReady;
  });

  it('shows a "Играть" button before the video is started', () => {
    render(<VideoPlayer video={VIDEO} />);
    expect(screen.getByRole('button', { name: /играть/i })).toBeInTheDocument();
  });

  it('creates a YT.Player with the right video/timing when the API is already loaded, and hides the button', async () => {
    const playerConstructor = vi.fn();
    window.YT = { Player: playerConstructor } as unknown as Window['YT'];

    render(<VideoPlayer video={VIDEO} />);
    fireEvent.click(screen.getByRole('button', { name: /играть/i }));

    await vi.waitFor(() => expect(playerConstructor).toHaveBeenCalled());
    expect(playerConstructor.mock.calls[0][1]).toMatchObject({
      host: 'https://www.youtube-nocookie.com',
      videoId: 'dQw4w9WgXcQ',
      playerVars: {
        start: 30,
        end: 45,
        rel: 0,
        modestbranding: 1,
        autoplay: 1,
      },
    });
    expect(
      screen.queryByRole('button', { name: /играть/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the sound-wave placeholder instead of the visible player when audioOnly is true', async () => {
    window.YT = { Player: vi.fn() } as unknown as Window['YT'];

    render(<VideoPlayer video={{ ...VIDEO, audioOnly: true }} />);
    fireEvent.click(screen.getByRole('button', { name: /играть/i }));

    expect(await screen.findByAltText(/играет аудио/i)).toBeInTheDocument();
  });

  it('shows an error message when the player reports onError', async () => {
    let capturedEvents: { onError?: (e: { data: number }) => void } = {};
    window.YT = {
      Player: vi.fn((_container: HTMLElement, options: unknown) => {
        capturedEvents =
          (options as { events?: typeof capturedEvents }).events ?? {};
        return { destroy: vi.fn() };
      }),
    } as unknown as Window['YT'];

    render(<VideoPlayer video={VIDEO} />);
    fireEvent.click(screen.getByRole('button', { name: /играть/i }));
    await vi.waitFor(() =>
      expect(capturedEvents.onError).toBeTypeOf('function'),
    );
    capturedEvents.onError!({ data: 100 });

    expect(await screen.findByText(/видео недоступно/i)).toBeInTheDocument();
  });

  it('injects the IFrame API script when YT is not yet loaded, then creates the player once ready', async () => {
    vi.resetModules();
    const { VideoPlayer: FreshVideoPlayer } = await import('./VideoPlayer');
    render(<FreshVideoPlayer video={VIDEO} />);
    fireEvent.click(screen.getByRole('button', { name: /играть/i }));

    await vi.waitFor(() =>
      expect(
        document.querySelector(
          'script[src="https://www.youtube.com/iframe_api"]',
        ),
      ).toBeInTheDocument(),
    );

    const playerConstructor = vi.fn();
    window.YT = { Player: playerConstructor } as unknown as Window['YT'];
    window.onYouTubeIframeAPIReady?.();

    await vi.waitFor(() => expect(playerConstructor).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C client exec vitest run VideoPlayer.test.tsx`
Expected: FAIL — `./VideoPlayer` does not exist yet.

- [ ] **Step 3: Implement `VideoPlayer.tsx`**

Create `client/src/VideoPlayer.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import soundWave from './assets/sound-wave.gif';

interface YouTubePlayerInstance {
  destroy(): void;
}

interface YouTubePlayerOptions {
  host: string;
  width: string;
  height: string;
  videoId: string;
  playerVars: {
    start: number;
    end: number;
    rel: 0;
    modestbranding: 1;
    autoplay: 1;
  };
  events?: {
    onError?: (event: { data: number }) => void;
  };
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        container: HTMLElement,
        options: YouTubePlayerOptions,
      ) => YouTubePlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Один <script> на всё табло за всю сессию — вопросов с видео за партию
// обычно несколько, повторная вставка/загрузка API на каждый была бы лишней
// (design.md, 2026-08-18-video-questions-design.md, «Сервер и клиент»).
let apiLoadingPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiLoadingPromise) {
    apiLoadingPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = resolve;
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(script);
    });
  }
  return apiLoadingPromise;
}

export function VideoPlayer({
  video,
}: {
  video: {
    youtubeId: string;
    startSeconds: number;
    durationSeconds: number;
    audioOnly: boolean;
  };
}) {
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        host: 'https://www.youtube-nocookie.com',
        width: '960',
        height: '540',
        videoId: video.youtubeId,
        playerVars: {
          start: video.startSeconds,
          end: video.startSeconds + video.durationSeconds,
          rel: 0,
          modestbranding: 1,
          autoplay: 1,
        },
        events: {
          onError: () => setFailed(true),
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // Зависимости — конкретные поля video, не сам объект: он пересоздаётся
    // на каждой рассылке состояния (в т.ч. пока этот же вопрос ещё открыт),
    // а зависимость от ссылки на весь объект пересоздавала бы плеер и
    // прерывала воспроизведение на каждой такой рассылке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, video.youtubeId, video.startSeconds, video.durationSeconds]);

  if (failed) {
    return <p className="board-video-error">Видео недоступно</p>;
  }

  if (!started) {
    return (
      <button
        className="button button--primary"
        onClick={() => setStarted(true)}
      >
        ▶ Играть
      </button>
    );
  }

  return (
    <div className={video.audioOnly ? 'board-video-audio-only' : 'board-video'}>
      {video.audioOnly && (
        <img
          src={soundWave}
          className="board-video-audio-placeholder"
          alt="Играет аудио"
        />
      )}
      <div
        ref={containerRef}
        className={video.audioOnly ? 'board-video-hidden' : undefined}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C client exec vitest run VideoPlayer.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire `VideoPlayer` into `Board.tsx`**

In `client/src/Board.tsx`, add the import at the top:

```tsx
import { VideoPlayer } from './VideoPlayer';
```

Then, inside the `{game.currentQuestion && (...)}` block, change the existing image block from:

```tsx
{
  game.currentQuestion.image && (
    <img
      className="board-question-image"
      src={game.currentQuestion.image}
      alt="Картинка к вопросу"
    />
  );
}
```

to (adding `&& !game.currentQuestion.video`, so a question with both fields set — not expected
by design, see design.md «Сервер и клиент» — never renders both at once):

```tsx
{
  game.currentQuestion.image && !game.currentQuestion.video && (
    <img
      className="board-question-image"
      src={game.currentQuestion.image}
      alt="Картинка к вопросу"
    />
  );
}
```

Then add the video block right after it:

```tsx
{
  game.currentQuestion.video && (
    <VideoPlayer video={game.currentQuestion.video} />
  );
}
```

- [ ] **Step 6: Write the failing `Board.tsx` wiring tests**

In `client/src/Board.test.tsx`, add two tests right after the existing `it('does not show an
image when the question has none', ...)` test:

```tsx
it('shows a "Играть" button when the question has video', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({
        phase: 'question-open',
        currentQuestion: {
          text: 'Что за фильм?',
          price: 100,
          themeName: 'Тема',
          video: {
            youtubeId: 'dQw4w9WgXcQ',
            startSeconds: 30,
            durationSeconds: 15,
            audioOnly: false,
          },
        },
      }),
    }),
  );
  render(<Board />);
  expect(screen.getByRole('button', { name: /играть/i })).toBeInTheDocument();
});

it('does not show a video button when the question has no video', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({
        phase: 'question-open',
        currentQuestion: {
          text: 'Столица Франции?',
          price: 100,
          themeName: 'Тема',
        },
      }),
    }),
  );
  render(<Board />);
  expect(
    screen.queryByRole('button', { name: /играть/i }),
  ).not.toBeInTheDocument();
});

it('shows only video, not the image, when a question somehow has both', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({
        phase: 'question-open',
        currentQuestion: {
          text: 'Что за фильм?',
          price: 100,
          themeName: 'Тема',
          image: '/media/sport/flower.jpg',
          video: {
            youtubeId: 'dQw4w9WgXcQ',
            startSeconds: 30,
            durationSeconds: 15,
            audioOnly: false,
          },
        },
      }),
    }),
  );
  render(<Board />);
  expect(screen.getByRole('button', { name: /играть/i })).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm -C client exec vitest run Board.test.tsx`
Expected: FAIL — `Board.tsx` does not render `VideoPlayer` yet.

- [ ] **Step 8: Run tests to verify they pass**

(Step 5 already implemented the wiring — this step just confirms it.)

Run: `pnpm -C client exec vitest run Board.test.tsx`
Expected: PASS

- [ ] **Step 9: Add CSS**

In `client/src/index.css`, add right after the existing `.board-question-image { ... }` block:

```css
.board-video,
.board-video-audio-only {
  display: flex;
  justify-content: center;
}

.board-video iframe {
  max-width: min(95vw, 960px);
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  border: none;
}

.board-video-audio-placeholder {
  max-width: min(95vw, 500px);
  max-height: 40vh;
  object-fit: contain;
  border-radius: 8px;
}

/* Не display: none — некоторые браузеры приостанавливают медиа в полностью
   исключённых из раскладки элементах. Нулевые размеры + overflow: hidden
   держат iframe «живым», но невидимым (design.md, «Сервер и клиент»). */
.board-video-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.board-video-error {
  font-size: 28px;
  color: var(--text);
}
```

- [ ] **Step 10: Run the full client test suite**

Run: `pnpm -C client exec vitest run`
Expected: PASS — all client tests green.

- [ ] **Step 11: Typecheck and lint**

Run: `pnpm -C client exec tsc -b && pnpm -C client run lint`
Expected: no new errors (the pre-existing `react-hooks/exhaustive-deps` warnings in
`Admin.tsx`/`Player.tsx` are unrelated and already tolerated in this codebase; a third one from
`VideoPlayer.tsx`'s deliberately-narrowed effect dependencies is expected and consistent with
that existing pattern).

- [ ] **Step 12: Commit**

```bash
git add client/src/VideoPlayer.tsx client/src/VideoPlayer.test.tsx client/src/Board.tsx client/src/Board.test.tsx client/src/index.css
git commit -m "feat: play video questions on the board via the YouTube IFrame Player API"
```

---

### Task 5: `server/scripts/validate-pack.ts` — warn on unreachable videos

**Files:**

- Modify: `server/scripts/validate-pack.ts`

**Interfaces:**

- Consumes: `findUnreachableVideos` from Task 1.

No new test file — this script has no dedicated test file today (see the existing top-of-file
comment: it is a thin CLI wrapper over already-tested `pack.ts` functions), same convention
applies here.

- [ ] **Step 1: Wire in `findUnreachableVideos`**

In `server/scripts/validate-pack.ts`, change the import line:

```ts
import { findMissingMedia, validatePack } from '../src/pack.js';
```

to:

```ts
import {
  findMissingMedia,
  findUnreachableVideos,
  validatePack,
} from '../src/pack.js';
```

Then, right after the existing `for (const m of missing) { ... }` loop that warns about missing
image files, add:

```ts
const unreachableVideos = await findUnreachableVideos(pack);
for (const v of unreachableVideos) {
  console.warn(
    `⚠ ${path}: вопрос "${v.questionId}" ссылается на видео "${v.youtubeId}", ` +
      `но оно недоступно (проверка через YouTube oEmbed)`,
  );
}
```

- [ ] **Step 2: Manually verify against a real pack**

Run (from repo root): `pnpm -C server exec tsx scripts/validate-pack.ts ../packs/current.json`
Expected: `OK: ...` line, no new warnings (the current pack has no `video` fields yet).

- [ ] **Step 3: Typecheck**

Run: `pnpm -C server exec tsc --noEmit -p tsconfig.scripts.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/validate-pack.ts
git commit -m "feat: warn on unreachable YouTube videos in validate-pack"
```

---

### Task 6: `.claude/skills/pack-generator/SKILL.md` — teach the generator to source video

**Files:**

- Modify: `.claude/skills/pack-generator/SKILL.md`

No code, no tests — this is prose instructions for the agentic generator, same as Task 5 in the
photo-questions plan.

- [ ] **Step 1: Rewrite invariant 3**

Replace:

```
3. **Картинки — можно, при соблюдении Шага 3а. Аудио и видео — по-прежнему нельзя.** Ни
   аудио, ни видео, ни ссылок на файлы, которые сами не скачали и не проверили (см. Шаг 3а).
```

with:

```
3. **Картинки — можно, при соблюдении Шага 3а. Видео (и то, что раньше было бы «аудио») —
   можно, при соблюдении Шага 3б.** Никакого скачивания медиафайлов, кроме уже описанного
   способа для картинок — видео проигрывается прямой ссылкой на YouTube, файл никогда не
   попадает на диск.
```

- [ ] **Step 2: Insert a new «Шаг 3б» section**

Insert this new section right after the existing «## Шаг 3а. Картинка к вопросу — когда и как»
section ends (right before «## Шаг 4. Содержательные правила»):

```markdown
## Шаг 3б. Видео/аудио к вопросу — когда и как

Видео допускается только в одном из двух случаев — та же дисциплина, что у картинок (Шаг 3а):

1. **Целый раунд/тема видео-вопросов.** Ролик — само содержание вопроса: «что за фильм?»,
   «что за песня?», «что за сцена?». Текст вопроса минимален.
2. **Точечное видео в обычном раунде — только если без него вопрос нельзя нормально
   задать.** Видео оправдано только там, где важно именно движение или звук во времени
   (сыгранная мелодия, узнаваемая интонация реплики, движение) — не украшение и не подсказка.

Отдельно от «нужно ли вообще видео» — решить, **виден ли сам ролик** (`video.audioOnly` не
ставится) или только звук (`video.audioOnly: true`). Вопрос «что за фильм?» по кадру — видео
целиком. Вопрос «что за песня?» — почти всегда `audioOnly: true`: если показать видеоклип,
узнавание идёт по картинке, а не по музыке.

**Ничего не скачивается.** Вместо файла в паке хранится ссылка на публичный YouTube-ролик и
таймкод — воспроизведение происходит прямо во время партии через встроенный плеер. Это
касается и музыки: специального «аудио»-пути нет, музыкальный вопрос — тот же YouTube-ролик с
`audioOnly: true`.

**Проверка через независимую корроборацию, не просмотром.** В отличие от картинок (Шаг 3а, где
скачанное смотрится напрямую), видео не скачивается и не может быть просмотрено/прослушано
генератором — вместо этого:

1. Сформулировать поисковый запрос по предмету вопроса (не по формулировке целиком), как и для
   картинок.
2. Найти подходящий публичный YouTube-ролик через веб-поиск.
3. Подтвердить нужный момент **независимым источником** — таймкоды/главы в самом описании
   видео (прочитать страницу видео обычным веб-запросом — не скачивание потока), статья,
   фан-вики, официальное описание. Собственное описание/название ролика само по себе не
   считается независимым подтверждением — нужен второй, отдельный источник, называющий именно
   этот момент.
4. Проверить через `oEmbed` YouTube:
   `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json` (без
   API-ключа) — ролик существует, публичный, встраиваемый.
5. Если независимой корроборации не нашлось — не гадать. Вопрос переписывается в чисто
   текстовый вариант (то же содержание, без `video`), запомнить для Шага 7 («не нашлось видео
   для …»).

Это заметно медленнее, чем поиск картинки — ожидаемо меньшая доля вопросов раунда реально
получит видео по сравнению с тем, как почти все получали картинки в картиночном раунде. Не
пытаться компенсировать это менее строгой проверкой — недостоверный видео-вопрос хуже
отсутствующего.

**Формат:** `question.video = { youtubeId, startSeconds, durationSeconds, audioOnly? }` —
`youtubeId` из ссылки на найденный ролик, `startSeconds`/`durationSeconds` — из
подтверждённого таймкода (разумная длина клипа — обычно 10–20 секунд, ровно то, что нужно для
узнавания, не весь фрагмент целиком).

**Первый живой пак с видео-вопросами — начинать с одного вопроса, не с полного пака.** Поиск с
независимой корроборацией заметно дороже, чем поиск картинки; прежде чем собирать полный
раунд, стоит подтвердить, что один вопрос получился так, как задумано.
```

- [ ] **Step 3: Add a video-oEmbed warning bullet to Шаг 6**

In the existing Шаг 6, п.3 bullet list (right after the bullet that starts with «Валидатор (Шаг
6, п.3 выше) теперь дополнительно печатает `⚠` для каждого вопроса, чья `image` указана...»),
add a new bullet:

```markdown
- Валидатор точно так же печатает `⚠` для каждого вопроса, чья `video` ссылается на ролик,
  недоступный через YouTube oEmbed (удалён, стал приватным, не встраивается) — то же самое
  действие: убрать `video` у вопроса (заменить на чисто текстовый) или найти другой ролик
  (Шаг 3б) и прогнать валидатор снова.
```

- [ ] **Step 4: Add video to the Шаг 7 report**

Replace the existing final sentence of «## Шаг 7. Отчёт»:

```
Если для каких-то вопросов картинка задумывалась (Шаг 3а), но подходящая не нашлась — явно
перечислить эти вопросы отдельным списком в этом же отчёте.
```

with:

```
Если для каких-то вопросов картинка (Шаг 3а) или видео (Шаг 3б) задумывались, но подходящих не
нашлось — явно перечислить эти вопросы отдельными списками в этом же отчёте.
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/pack-generator/SKILL.md
git commit -m "docs: teach pack-generator to source video questions from YouTube"
```

---

## Final Verification

After all six tasks:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green, no new warnings beyond the two pre-existing `react-hooks/exhaustive-deps`
ones plus the one new, equally-justified one in `VideoPlayer.tsx` (Task 4, Step 11).

`pnpm test:e2e` — run once before closing the milestone (svoya-igra-dev/SKILL.md, Шаг 4), not
after every task.

Live test: follow `docs/superpowers/specs/2026-08-18-video-questions-design.md`'s
«Тестирование» note — generate a pack with exactly one video question first, play it through
on a real board, confirm the "Играть" button, playback, and (if `audioOnly`) the sound-wave
placeholder all work as intended before generating a larger pack.
