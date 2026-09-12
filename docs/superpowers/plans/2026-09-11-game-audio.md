# Звук игры — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** табло получает голос — короткие сигналы на события партии и фоновая музыка в паузах, с пультом в `/admin` и на самом `/board`.

**Architecture:** сервер при старте сканирует папку `audio/` и отдаёт её как статику под `/audio/`; комната (не движок) выводит доменные сигналы `game-cue` из снимков состояния «до/после» в `Room.dispatch` и рассылает их всем сокетам; настройки звука живут в `Room`, едут в обычном `state` и переживают перезапуск в `audio-settings.local.json`. На клиенте воспроизведение вынесено из React в обычный класс `AudioEngine`, а хук `useBoardAudio` только связывает его с состоянием комнаты.

**Tech Stack:** TypeScript, Node + ws (server), React 19 + Vite (client), Vitest, sirv для статики.

Спека: `docs/superpowers/specs/2026-09-11-game-audio-design.md`. Читать её перед задачами 1, 4 и 6 — там причины, которых здесь нет.

## Global Constraints

- **Движок не трогается ни на строку.** `server/src/engine.ts` и `engine.test.ts` не меняются ни в одной задаче. Если кажется, что нужно, — остановиться и сказать.
- **Звук существует только на `/board`.** `Player.tsx` не меняется ни в одной задаче.
- **Отсутствие файлов — штатная ситуация.** Ни `pnpm test`, ни `pnpm build`, ни CI не должны зависеть от наличия папки `audio/` и чего-либо в ней. Ни одной строки в консоль при её отсутствии.
- **Имена файлов сигналов фиксированы:** `question`, `buzz`, `correct`, `wrong`, `timeout`, `round-end`, `game-end`. Расширения: `.mp3`, `.ogg`, `.wav`, `.m4a`.
- **Значения по умолчанию:** `effectsEnabled: true`, `effectsVolume: 0.7`, `musicEnabled: true`, `musicVolume: 0.35`. Затухание музыки — 800 мс в обе стороны.
- **Язык кода и комментариев** — как в проекте: код английский, комментарии и тексты интерфейса русские. Комментарий пишется там, где объясняет **почему**, а не что.
- **Каждая задача заканчивается** зелёными `pnpm --filter server test` (задачи 1–5) или `pnpm --filter client test` (задачи 6–9) и коммитом в ветке `feature/game-audio`.

---

### Task 1: Сканер папки `audio/`

**Files:**

- Create: `server/src/audioAssets.ts`
- Create: `server/src/audioAssets.test.ts`
- Create: `audio/README.md`
- Modify: `.gitignore` (в конец файла)

**Interfaces:**

- Consumes: ничего.
- Produces: `scanAudioAssets(dir: string): Promise<AudioAssets>` — единственная точка сканирования. Типы `GameCue`/`AudioAssets` в этой задаче объявляются **временно локально** в `audioAssets.ts` и в задаче 3 переезжают в `protocol.ts`; здесь они уже пишутся с теми же полями, что там.

- [ ] **Step 1: Написать падающий тест**

`server/src/audioAssets.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanAudioAssets } from './audioAssets.js';

async function makeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'audio-assets-'));
}

describe('scanAudioAssets', () => {
  it('находит все семь сигналов и треки, отдавая готовые URL', async () => {
    const dir = await makeDir();
    for (const name of [
      'question.mp3',
      'buzz.mp3',
      'correct.mp3',
      'wrong.mp3',
      'timeout.mp3',
      'round-end.mp3',
      'game-end.mp3',
    ]) {
      await writeFile(join(dir, name), '');
    }
    await mkdir(join(dir, 'music'));
    await writeFile(join(dir, 'music', 'b.mp3'), '');
    await writeFile(join(dir, 'music', 'a.ogg'), '');

    const assets = await scanAudioAssets(dir);

    expect(assets.cues).toEqual([
      { cue: 'question-opened', url: '/audio/question.mp3' },
      { cue: 'buzzed', url: '/audio/buzz.mp3' },
      { cue: 'answer-correct', url: '/audio/correct.mp3' },
      { cue: 'answer-wrong', url: '/audio/wrong.mp3' },
      { cue: 'question-timeout', url: '/audio/timeout.mp3' },
      { cue: 'round-ended', url: '/audio/round-end.mp3' },
      { cue: 'game-ended', url: '/audio/game-end.mp3' },
    ]);
    expect(assets.music).toEqual(['/audio/music/a.ogg', '/audio/music/b.mp3']);
  });

  it('пропускает отсутствующие сигналы, а не падает', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'buzz.wav'), '');

    const assets = await scanAudioAssets(dir);

    expect(assets.cues).toEqual([{ cue: 'buzzed', url: '/audio/buzz.wav' }]);
    expect(assets.music).toEqual([]);
  });

  it('пустая папка даёт пустой результат', async () => {
    const assets = await scanAudioAssets(await makeDir());
    expect(assets).toEqual({ cues: [], music: [] });
  });

  it('отсутствующая папка даёт пустой результат', async () => {
    const assets = await scanAudioAssets(join(await makeDir(), 'nope'));
    expect(assets).toEqual({ cues: [], music: [] });
  });

  it('игнорирует неподдерживаемое расширение и посторонние файлы', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'buzz.flac'), '');
    await writeFile(join(dir, 'README.md'), '');
    await writeFile(join(dir, 'question.mp3'), '');
    await mkdir(join(dir, 'music'));
    await writeFile(join(dir, 'music', 'notes.txt'), '');

    const assets = await scanAudioAssets(dir);

    expect(assets.cues).toEqual([
      { cue: 'question-opened', url: '/audio/question.mp3' },
    ]);
    expect(assets.music).toEqual([]);
  });

  it('узнаёт файл независимо от регистра имени', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'Buzz.MP3'), '');

    const assets = await scanAudioAssets(dir);

    expect(assets.cues).toEqual([{ cue: 'buzzed', url: '/audio/Buzz.MP3' }]);
  });

  it('экранирует пробелы и кириллицу в имени трека', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'music'));
    await writeFile(join(dir, 'music', 'тихий трек.mp3'), '');

    const assets = await scanAudioAssets(dir);

    expect(assets.music).toEqual([
      `/audio/music/${encodeURIComponent('тихий трек.mp3')}`,
    ]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
pnpm --filter server test -- -t "scanAudioAssets"
```

Ожидается: FAIL, `Cannot find module './audioAssets.js'`.

- [ ] **Step 3: Написать реализацию**

`server/src/audioAssets.ts`:

```ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// ВРЕМЕННО в этом файле: в задаче 3 оба типа переезжают в protocol.ts (они
// часть формата сообщения state), а здесь останется `import type`.
export type GameCue =
  | 'question-opened'
  | 'buzzed'
  | 'answer-correct'
  | 'answer-wrong'
  | 'question-timeout'
  | 'round-ended'
  | 'game-ended';

export interface AudioAssets {
  cues: { cue: GameCue; url: string }[];
  music: string[];
}

const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.m4a'];

// Порядок фиксирован намеренно: он же порядок списка в /admin, и список
// «что озвучено, что молчит» должен выглядеть одинаково между запусками.
const CUE_FILE_BASENAMES: { cue: GameCue; basename: string }[] = [
  { cue: 'question-opened', basename: 'question' },
  { cue: 'buzzed', basename: 'buzz' },
  { cue: 'answer-correct', basename: 'correct' },
  { cue: 'answer-wrong', basename: 'wrong' },
  { cue: 'question-timeout', basename: 'timeout' },
  { cue: 'round-ended', basename: 'round-end' },
  { cue: 'game-ended', basename: 'game-end' },
];

// Отсутствие папки — штатная тишина, а не поломка (design.md,
// 2026-09-11-game-audio-design.md, «Откуда берутся файлы»). Поэтому, в
// отличие от listAvailablePacks (packs.ts), здесь нет даже console.error: в
// CI звуковых файлов не будет никогда, и ругаться на это не на что.
async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

function hasAudioExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Имя файла приходит с диска и может содержать пробелы и кириллицу —
// кодируем каждый сегмент отдельно, чтобы `/` разделителя уцелел.
function audioUrl(...segments: string[]): string {
  return `/audio/${segments.map(encodeURIComponent).join('/')}`;
}

export async function scanAudioAssets(dir: string): Promise<AudioAssets> {
  const files = await listFiles(dir);
  const cues: AudioAssets['cues'] = [];
  for (const { cue, basename } of CUE_FILE_BASENAMES) {
    const file = files.find((name) =>
      AUDIO_EXTENSIONS.some(
        (ext) => name.toLowerCase() === `${basename}${ext}`,
      ),
    );
    if (file) cues.push({ cue, url: audioUrl(file) });
  }
  const music = (await listFiles(join(dir, 'music')))
    .filter(hasAudioExtension)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => audioUrl('music', name));
  return { cues, music };
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
pnpm --filter server test -- -t "scanAudioAssets"
```

Ожидается: PASS, 7 тестов.

- [ ] **Step 5: Завести `audio/README.md`**

```markdown
# Звуки игры

Папка не в git — здесь личные файлы с чужими лицензиями, ровно как в `packs/`.
В репозитории остаётся только этот README.

Сервер сканирует папку **один раз при старте**. Добавили файл — перезапустите
сервер, иначе он про него не узнает.

Отсутствие любого файла — нормально: нет `wrong.mp3` — неверный ответ просто
молчит, остальное звучит. Нет всей папки — игра идёт беззвучно.

## Имена

Имена фиксированы, расширение — любое из `.mp3`, `.ogg`, `.wav`, `.m4a`.

| Файл        | Когда звучит                  |
| ----------- | ----------------------------- |
| `question`  | вопрос выбран и открылся      |
| `buzz`      | игрок перехватил право ответа |
| `correct`   | ведущий засчитал ответ        |
| `wrong`     | ведущий не засчитал ответ     |
| `timeout`   | время вышло, никто не нажал   |
| `round-end` | раунд закончился              |
| `game-end`  | партия закончилась            |

`music/` — спокойные треки, любое число файлов, играют по кругу в
перемешанном порядке в паузах партии.

Что именно сервер нашёл, видно в `/admin`, секция «Звук».
```

- [ ] **Step 6: Добавить правила в `.gitignore`**

В конец файла:

```
# Звуки игры: чужие лицензии и личный подбор под компанию, не содержимое
# репозитория (docs/superpowers/specs/2026-09-11-game-audio-design.md).
# В гите остаётся только README со списком имён.
audio/*
!audio/README.md
```

Проверить, что README виден git, а звуки нет:

```bash
git status --short audio/
```

Ожидается: строка только про `audio/README.md`, ни одного `.mp3`.

- [ ] **Step 7: Коммит**

```bash
git add server/src/audioAssets.ts server/src/audioAssets.test.ts audio/README.md .gitignore
git commit -m "feat: сканер папки audio/ — сигналы и плейлист по фиксированным именам"
```

---

### Task 2: Настройки звука на диске

**Files:**

- Create: `server/src/audioSettings.ts`
- Create: `server/src/audioSettings.test.ts`
- Modify: `.gitignore` (рядом с блоком про `lan-host.local.json`)

**Interfaces:**

- Consumes: `writeFileAtomic(path, data)` из `server/src/atomicWrite.ts`.
- Produces: `AudioSettings` (временно здесь, в задаче 3 переезжает в `protocol.ts`), `DEFAULT_AUDIO_SETTINGS`, `mergeAudioSettings(base, patch): AudioSettings`, `readAudioSettings(path): Promise<AudioSettings>`, `writeAudioSettings(path, settings): Promise<void>`.

- [ ] **Step 1: Написать падающий тест**

`server/src/audioSettings.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_SETTINGS,
  mergeAudioSettings,
  readAudioSettings,
  writeAudioSettings,
} from './audioSettings.js';

async function makePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'audio-settings-'));
  return join(dir, 'audio-settings.local.json');
}

describe('AudioSettings: чтение с диска', () => {
  it('отсутствующий файл даёт значения по умолчанию', async () => {
    expect(await readAudioSettings(await makePath())).toEqual(
      DEFAULT_AUDIO_SETTINGS,
    );
  });

  it('битый файл даёт значения по умолчанию, а не исключение', async () => {
    const path = await makePath();
    await writeFile(path, '{ это не json');
    expect(await readAudioSettings(path)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('лишние и неверные по типу поля игнорируются по одному', async () => {
    const path = await makePath();
    await writeFile(
      path,
      JSON.stringify({ musicVolume: 0.1, effectsEnabled: 'да', что: 1 }),
    );
    expect(await readAudioSettings(path)).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      musicVolume: 0.1,
    });
  });
});

describe('AudioSettings: запись на диск', () => {
  it('записанное читается обратно', async () => {
    const path = await makePath();
    const settings = {
      effectsEnabled: false,
      effectsVolume: 0.4,
      musicEnabled: true,
      musicVolume: 0.2,
    };
    await writeAudioSettings(path, settings);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(settings);
    expect(await readAudioSettings(path)).toEqual(settings);
  });
});

describe('AudioSettings: частичное обновление', () => {
  it('не трогает остальные поля', () => {
    expect(
      mergeAudioSettings(DEFAULT_AUDIO_SETTINGS, { musicVolume: 0.5 }),
    ).toEqual({ ...DEFAULT_AUDIO_SETTINGS, musicVolume: 0.5 });
  });

  it('зажимает громкость в 0..1', () => {
    expect(
      mergeAudioSettings(DEFAULT_AUDIO_SETTINGS, {
        musicVolume: 5,
        effectsVolume: -1,
      }),
    ).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      musicVolume: 1,
      effectsVolume: 0,
    });
  });

  it('отбрасывает мусор в значении, оставляя поле прежним', () => {
    expect(
      mergeAudioSettings(DEFAULT_AUDIO_SETTINGS, {
        musicVolume: Number.NaN,
        effectsEnabled: 'нет' as unknown as boolean,
      }),
    ).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
pnpm --filter server test -- -t "AudioSettings"
```

Ожидается: FAIL, `Cannot find module './audioSettings.js'`.

- [ ] **Step 3: Написать реализацию**

`server/src/audioSettings.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomicWrite.js';

// ВРЕМЕННО в этом файле: в задаче 3 тип переезжает в protocol.ts (он часть
// формата сообщения state), здесь останется `import type` и реэкспорт.
export interface AudioSettings {
  effectsEnabled: boolean;
  effectsVolume: number;
  musicEnabled: boolean;
  musicVolume: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  effectsEnabled: true,
  effectsVolume: 0.7,
  musicEnabled: true,
  musicVolume: 0.35,
};

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Поля проверяются по одному: пришедшее частичным обновлением
 * (`set-audio-settings`) и прочитанное с диска проходят одну и ту же
 * проверку, и мусор в одном поле не должен обнулять остальные три. Тумблер и
 * ползунок живут на разных экранах и меняются независимо — один пульт не
 * имеет права переписать чужое поле (design.md, «Настройки»).
 */
export function mergeAudioSettings(
  base: AudioSettings,
  patch: Partial<AudioSettings>,
): AudioSettings {
  const next = { ...base };
  if (typeof patch.effectsEnabled === 'boolean') {
    next.effectsEnabled = patch.effectsEnabled;
  }
  if (typeof patch.musicEnabled === 'boolean') {
    next.musicEnabled = patch.musicEnabled;
  }
  if (
    typeof patch.effectsVolume === 'number' &&
    Number.isFinite(patch.effectsVolume)
  ) {
    next.effectsVolume = clampVolume(patch.effectsVolume);
  }
  if (
    typeof patch.musicVolume === 'number' &&
    Number.isFinite(patch.musicVolume)
  ) {
    next.musicVolume = clampVolume(patch.musicVolume);
  }
  return next;
}

/**
 * Битый или отсутствующий файл означает значения по умолчанию — здесь, в
 * отличие от readLanHostConfig (lan-host.ts), исключение наверх не идёт
 * вовсе: сервер без настроек звука обязан подниматься молча.
 */
export async function readAudioSettings(path: string): Promise<AudioSettings> {
  try {
    const raw = JSON.parse(
      await readFile(path, 'utf8'),
    ) as Partial<AudioSettings> | null;
    return mergeAudioSettings(DEFAULT_AUDIO_SETTINGS, raw ?? {});
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export async function writeAudioSettings(
  path: string,
  settings: AudioSettings,
): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(settings));
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
pnpm --filter server test -- -t "AudioSettings"
```

Ожидается: PASS.

- [ ] **Step 5: Добавить файл настроек в `.gitignore`**

Рядом с блоком про `lan-host.local.json`:

```
# Подобранная под комнату громкость (server/src/audioSettings.ts) — настройка
# машины, а не проекта, как и lan-host.local.json выше.
audio-settings.local.json
audio-settings.local.json.tmp
```

- [ ] **Step 6: Коммит**

```bash
git add server/src/audioSettings.ts server/src/audioSettings.test.ts .gitignore
git commit -m "feat: настройки звука в audio-settings.local.json"
```

---

### Task 3: Протокол и настройки звука в комнате

**Files:**

- Modify: `server/src/protocol.ts` (типы до `ClientMessage` ~130, `ClientMessage` ~132, `StateMessage` ~348, `ServerMessage` ~332)
- Modify: `server/src/audioAssets.ts` (убрать локальные типы)
- Modify: `server/src/audioSettings.ts` (убрать локальный тип)
- Modify: `server/src/room.ts` (поля рядом с `textRevealFadeMs` ~351, методы рядом с `getTextRevealFadeMs` ~1090, подписки рядом с `onTextRevealFadeChange` ~1473)
- Test: `server/src/room.test.ts` (новый `describe` в конце файла)

**Interfaces:**

- Consumes: `mergeAudioSettings`, `DEFAULT_AUDIO_SETTINGS` (задача 2); `scanAudioAssets` не нужен.
- Produces:
  - `protocol.ts`: `export type GameCue`, `export interface AudioSettings`, `export interface AudioAssets`; поля `audio: AudioSettings` и `audioAssets: AudioAssets` в `StateMessage`; `| { type: 'set-audio-settings'; settings: Partial<AudioSettings> }` в `ClientMessage`; `| { type: 'game-cue'; cue: GameCue }` в `ServerMessage`.
  - `Room`: `getAudioSettings(): AudioSettings`, `setAudioSettings(patch: Partial<AudioSettings>): void`, `onAudioSettingsChange(listener: (settings: AudioSettings) => void): () => void`, `onAudioCue(listener: (cue: GameCue) => void): () => void`, приватный `emitAudioCues(cues: GameCue[]): void`.

- [ ] **Step 1: Написать падающий тест**

Добавить в конец `server/src/room.test.ts`:

```ts
describe('Room: настройки звука', () => {
  it('по умолчанию звуки и музыка включены', () => {
    expect(new Room().getAudioSettings()).toEqual({
      effectsEnabled: true,
      effectsVolume: 0.7,
      musicEnabled: true,
      musicVolume: 0.35,
    });
  });

  it('частичное обновление меняет только своё поле', () => {
    const room = new Room();
    room.setAudioSettings({ musicVolume: 0.1 });
    room.setAudioSettings({ effectsEnabled: false });
    expect(room.getAudioSettings()).toEqual({
      effectsEnabled: false,
      effectsVolume: 0.7,
      musicEnabled: true,
      musicVolume: 0.1,
    });
  });

  it('зовёт подписчиков на каждое изменение и отписывает', () => {
    const room = new Room();
    const listener = vi.fn();
    const unsubscribe = room.onAudioSettingsChange(listener);
    room.setAudioSettings({ musicEnabled: false });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ musicEnabled: false }),
    );
    unsubscribe();
    room.setAudioSettings({ musicEnabled: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('отдаёт копию, а не своё внутреннее состояние', () => {
    const room = new Room();
    const settings = room.getAudioSettings();
    settings.musicVolume = 0.99;
    expect(room.getAudioSettings().musicVolume).toBe(0.35);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
pnpm --filter server test -- -t "Room: настройки звука"
```

Ожидается: FAIL, `room.getAudioSettings is not a function`.

- [ ] **Step 3: Перенести типы в `protocol.ts`**

В `server/src/protocol.ts`, до `ClientMessage`:

```ts
/**
 * Имена доменные, а не звуковые: комната сообщает, ЧТО произошло, а не какой
 * файл играть. Перевод сигнала в файл — дело табло (design.md,
 * 2026-09-11-game-audio-design.md, «Что звучит»). Тот же канал позже
 * понадобится для не-звуковых реакций (вспышка на экране, вибрация), и
 * переписывать его из звукового словаря в событийный не придётся.
 */
export type GameCue =
  | 'question-opened'
  | 'buzzed'
  | 'answer-correct'
  | 'answer-wrong'
  | 'question-timeout'
  | 'round-ended'
  | 'game-ended';

export interface AudioSettings {
  effectsEnabled: boolean;
  effectsVolume: number;
  musicEnabled: boolean;
  musicVolume: number;
}

/**
 * Что сервер нашёл в папке audio/ при старте. Готовые URL, а не имена
 * файлов: расширение подобрал сканер, и клиенту незачем его угадывать — тот
 * же принцип, что у GameStateView.image.
 */
export interface AudioAssets {
  cues: { cue: GameCue; url: string }[];
  music: string[];
}
```

В `ClientMessage`, после `admin-set-history-enabled`:

```ts
  // Пульт комнаты, а не действие участника: без admin-префикса и без
  // проверки отправителя, тем же принципом, что admin-set-lan-address, —
  // шлют и админка, и само табло. Partial: ползунок громкости музыки не
  // имеет права переписать тумблер звуков, который в этот же момент мог
  // переключить другой экран (design.md, «Настройки»).
  | { type: 'set-audio-settings'; settings: Partial<AudioSettings> }
```

В `StateMessage`, после `historyRecording`:

```ts
// Правда одна на всех: выключили с телефона — на табло тоже снялось.
audio: AudioSettings;
// Разовое сканирование при старте сервера, живым не пересчитывается —
// в игре файлы никто не добавляет (design.md, «Откуда берутся файлы»).
audioAssets: AudioAssets;
```

В `ServerMessage`:

```ts
  /**
   * Разовое сообщение, а не поле состояния: состояние рассылается целиком и
   * заново при каждом переподключении, и сигнал, положенный в него,
   * переиграется на табло, которое просто перезагрузили посреди партии
   * (design.md, «Как табло узнаёт, что произошло»).
   */
  | { type: 'game-cue'; cue: GameCue }
```

В `server/src/audioAssets.ts` заменить локальные `GameCue`/`AudioAssets` (вместе с пометкой «ВРЕМЕННО в этом файле») на:

```ts
import type { AudioAssets, GameCue } from './protocol.js';
```

В `server/src/audioSettings.ts` заменить локальный `export interface AudioSettings {...}` на:

```ts
import type { AudioSettings } from './protocol.js';

export type { AudioSettings };
```

- [ ] **Step 4: Добавить настройки в `Room`**

В `server/src/room.ts`.

Импорты:

```ts
import type { AudioSettings, GameCue } from './protocol.js';
import { DEFAULT_AUDIO_SETTINGS, mergeAudioSettings } from './audioSettings.js';
```

Поля рядом с `private textRevealFadeMs = 270;`:

```ts
  // Не часть RoomState и не пишется в снапшот: это настройка машины, а не
  // состояние партии — переживает перезапуск через audio-settings.local.json
  // (index.ts), ровно как выбранный LAN-адрес.
  private audio: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private audioSettingsListeners = new Set<(settings: AudioSettings) => void>();
  private audioCueListeners = new Set<(cue: GameCue) => void>();
```

Методы рядом с `getTextRevealFadeMs`:

```ts
  getAudioSettings(): AudioSettings {
    return { ...this.audio };
  }

  // Без проверки отправителя, тем же паттерном, что setLanAddress: это пульт
  // комнаты, им пользуются и /admin, и /board (design.md, «Настройки»).
  setAudioSettings(patch: Partial<AudioSettings>): void {
    this.audio = mergeAudioSettings(this.audio, patch);
    for (const listener of this.audioSettingsListeners) {
      listener(this.getAudioSettings());
    }
  }

  onAudioSettingsChange(
    listener: (settings: AudioSettings) => void,
  ): () => void {
    this.audioSettingsListeners.add(listener);
    return () => this.audioSettingsListeners.delete(listener);
  }

  // Подписка на разовые сигналы партии. Наполняется в задаче 4 — заводится
  // здесь вместе с остальной проводкой звука, чтобы сервер мог подписаться
  // раньше, чем появятся сами сигналы.
  onAudioCue(listener: (cue: GameCue) => void): () => void {
    this.audioCueListeners.add(listener);
    return () => this.audioCueListeners.delete(listener);
  }

  private emitAudioCues(cues: GameCue[]): void {
    for (const cue of cues) {
      for (const listener of this.audioCueListeners) {
        listener(cue);
      }
    }
  }
```

- [ ] **Step 5: Убедиться, что тест проходит**

```bash
pnpm --filter server test -- -t "Room: настройки звука"
```

Ожидается: PASS.

```bash
pnpm --filter server typecheck
```

Ожидается: **ровно одна** ошибка — `stateMessageFor` в `server.ts` не отдаёт новые обязательные поля `audio`/`audioAssets`. Она чинится в задаче 5; других новых ошибок быть не должно.

- [ ] **Step 6: Коммит**

```bash
git add server/src/protocol.ts server/src/room.ts server/src/audioAssets.ts server/src/audioSettings.ts server/src/room.test.ts
git commit -m "feat: типы звука в протоколе и настройки звука в комнате"
```

---

### Task 4: Сигналы партии в `Room.dispatch`

**Files:**

- Modify: `server/src/room.ts` (`dispatch`, ~1484–1620)
- Test: `server/src/room.test.ts` (новый `describe` в конце)

**Interfaces:**

- Consumes: `this.emitAudioCues(cues)` и `onAudioCue` (задача 3); снимки `phaseBefore`, `buzzedBefore`, `scoresBefore`, `questionBefore`, уже захваченные в начале `dispatch`.
- Produces: сигналы, доходящие до подписчиков `room.onAudioCue`, по правилам таблицы из спеки.

**Перед началом прочитать** в спеке раздел «Как табло узнаёт, что произошло»: там причина, почему верно и неверно различаются по знаку дельты счёта, а не по конечной фазе.

Правила вывода (та же таблица, для сверки при реализации):

| Сигнал             | Условие                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `question-opened`  | `questionBefore === null` и `state.currentQuestion !== null`                                |
| `buzzed`           | `phaseBefore !== 'buzzed'` и `state.phase === 'buzzed'`                                     |
| `answer-correct`   | `phaseBefore === 'judging'` и счёт `buzzedBefore` вырос                                     |
| `answer-wrong`     | `phaseBefore === 'judging'` и счёт `buzzedBefore` упал                                      |
| `question-timeout` | событие `timer-expired` с таймером `question`, `buzzedBefore === null`, фаза стала `reveal` |
| `round-ended`      | `phaseBefore !== 'round-end'` и `state.phase === 'round-end'`                               |
| `game-ended`       | `phaseBefore !== 'game-end'` и `state.phase === 'game-end'`                                 |

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `server/src/room.test.ts`. **Подготовку партии брать из соседних тестов этого файла** — там уже есть партии, доведённые до `round-end` и `game-end`, и хелперы для комнаты с пакетом, двумя участниками и назначенным ведущим. Заглушки-комментарии ниже обязаны быть заменены настоящей подготовкой; тест с незаполненной подготовкой не считается написанным.

```ts
describe('Room: сигналы звука', () => {
  // Собирает всё, что вышло из комнаты, в порядке возникновения.
  function cuesOf(room: Room): GameCue[] {
    const cues: GameCue[] = [];
    room.onAudioCue((cue) => cues.push(cue));
    return cues;
  }

  it('открытие вопроса даёт question-opened', () => {
    // комната со стартованной партией, ход у игрока A
    const cues = cuesOf(room);
    room.selectQuestion(a, 0, 'q1');
    expect(cues).toEqual(['question-opened']);
  });

  it('нажатие кнопки даёт buzzed', () => {
    // вопрос открыт (phase question-open)
    const cues = cuesOf(room);
    room.buzz(b);
    expect(cues).toEqual(['buzzed']);
  });

  it('засчитанный ответ даёт answer-correct', () => {
    // phase judging, нажимал b, судит ведущий
    const cues = cuesOf(room);
    room.vote(host, true);
    expect(cues).toContain('answer-correct');
    expect(cues).not.toContain('answer-wrong');
  });

  it('неверный ответ, закрывший вопрос, даёт answer-wrong, а не answer-correct', () => {
    // Единственный оставшийся отвечающий отвечает неверно: judging → reveal,
    // то есть та же конечная фаза, что и у верного ответа. Различает только
    // знак дельты счёта — ради этого теста всё и делается.
    const cues = cuesOf(room);
    room.vote(host, false);
    expect(cues).toContain('answer-wrong');
    expect(cues).not.toContain('answer-correct');
  });

  it('неверный ответ с переоткрытием вопроса тоже даёт answer-wrong', () => {
    // judging → question-open: отвечать ещё есть кому.
    const cues = cuesOf(room);
    room.vote(host, false);
    expect(cues).toEqual(['answer-wrong']);
  });

  it('правка очков ведущим не даёт сигнала вообще', () => {
    const cues = cuesOf(room);
    room.adjustScore(host, b, 500);
    expect(cues).toEqual([]);
  });

  it('истёкший таймер вопроса без нажатий даёт question-timeout', () => {
    // вопрос открыт, никто не нажимал
    const cues = cuesOf(room);
    vi.advanceTimersByTime(QUESTION_TIMER_MS);
    expect(cues).toContain('question-timeout');
  });

  it('вопрос, переоткрытый после неверного ответа, по истечении времени тоже даёт question-timeout', () => {
    // Нажали, ответили неверно, вопрос переоткрылся остальным, время вышло.
    // Движок обнуляет buzzedCounterId при переоткрытии (engine.ts,
    // resolveVote), так что для dispatch этот тайм-аут неотличим от
    // обычного — и это верно по существу: вопрос умер на часах, его никто не
    // взял. Звук неверного ответа отзвучал за полминуты до этого, мешаться
    // им негде.
    const cues = cuesOf(room);
    vi.advanceTimersByTime(QUESTION_TIMER_MS);
    expect(cues).toContain('question-timeout');
  });

  it('конец раунда даёт round-ended', () => {
    // доиграть последний вопрос раунда и дать истечь reveal
    const cues = cuesOf(room);
    expect(cues).toContain('round-ended');
  });

  it('конец партии даёт game-ended', () => {
    // довести партию до game-end
    const cues = cuesOf(room);
    expect(cues).toContain('game-ended');
  });

  it('последний вопрос раунда даёт оба сигнала в порядке возникновения', () => {
    const cues = cuesOf(room);
    // засчитать ответ на последнем вопросе раунда, дать истечь reveal
    expect(cues).toEqual(['answer-correct', 'round-ended']);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
pnpm --filter server test -- -t "Room: сигналы звука"
```

Ожидается: FAIL — сигналов нет, массивы пустые.

- [ ] **Step 3: Написать реализацию**

В `server/src/room.ts`, в `dispatch`, **после** `this.applyEffects(...)` и блока `recordPlayedQuestion`, но **до** `this.notify()`:

```ts
// Сигналы звука выводятся здесь, а не в движке: новый вид Effect задел
// бы десятки сравнений `toEqual` в engine.test.ts ради косметики
// (design.md, «Почему комната, а не движок»). Снимки «до» — те же, по
// которым выше распознаётся честный реопен после «Незачёт».
const cues: GameCue[] = [];
if (questionBefore === null && state.currentQuestion !== null) {
  cues.push('question-opened');
}
if (phaseBefore !== 'buzzed' && state.phase === 'buzzed') {
  cues.push('buzzed');
}
if (phaseBefore === 'judging' && buzzedBefore !== null) {
  // Знак дельты, а не конечная фаза: judging кончается и 'reveal', и
  // возвратом в 'question-open', причём 'reveal' наступает в обоих
  // исходах — и при засчитанном ответе, и при незасчитанном, когда
  // отвечать больше некому. Правка очков ведущим (adjust-score) сюда не
  // попадает: она приходит не из judging.
  const before = scoresBefore[buzzedBefore] ?? 0;
  const after = state.scores[buzzedBefore] ?? 0;
  if (after > before) cues.push('answer-correct');
  else if (after < before) cues.push('answer-wrong');
}
if (
  event.type === 'timer-expired' &&
  event.timer === 'question' &&
  buzzedBefore === null &&
  state.phase === 'reveal'
) {
  cues.push('question-timeout');
}
if (phaseBefore !== 'round-end' && state.phase === 'round-end') {
  cues.push('round-ended');
}
if (phaseBefore !== 'game-end' && state.phase === 'game-end') {
  cues.push('game-ended');
}
// До notify(): рассылка состояния всё равно отложена в микротаск
// (server.ts, broadcastState), так что сигнал и картинка на табло
// приезжают в пределах одного тика.
this.emitAudioCues(cues);
```

- [ ] **Step 4: Убедиться, что тесты проходят**

```bash
pnpm --filter server test -- -t "Room: сигналы звука"
pnpm --filter server test
```

Ожидается: PASS новых тестов и ни одного упавшего старого — в `dispatch` не изменилось ничего, кроме добавленного блока.

- [ ] **Step 5: Коммит**

```bash
git add server/src/room.ts server/src/room.test.ts
git commit -m "feat: комната выводит доменные сигналы партии для звука"
```

---

### Task 5: Сервер — раздача `/audio/`, настройки в `state`, рассылка сигналов

**Files:**

- Modify: `server/src/server.ts` (`CreateServerOptions` ~39, sirv ~117, HTTP-обработчик ~119, `stateMessageFor` ~146, подписки ~197, обработчик сообщений ~663)
- Modify: `server/src/index.ts` (константы ~14, `main` ~180, вызов `createServer` ~203)
- Modify: `client/vite.config.ts` (`server.proxy`)
- Test: `server/src/server.test.ts`

**Interfaces:**

- Consumes: `scanAudioAssets` (задача 1), `readAudioSettings`/`writeAudioSettings` (задача 2), `room.getAudioSettings`/`setAudioSettings`/`onAudioSettingsChange`/`onAudioCue` (задача 3).
- Produces: `CreateServerOptions.audioDir?: string`, `CreateServerOptions.audioAssets?: AudioAssets`; поля `audio`/`audioAssets` в сообщении `state`; сообщение `game-cue` на проводе; обработка `set-audio-settings`.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/src/server.test.ts`, по образцу соседних тестов (`collectMessages`, поднятие сервера на `port: 0`, подключение `ws`):

```ts
it('отдаёт настройки звука и найденные файлы в state', async () => {
  const room = new Room(undefined, pack);
  server = createServer({
    room,
    clientDistPath,
    port: 0,
    packsDir,
    audioAssets: {
      cues: [{ cue: 'buzzed', url: '/audio/buzz.mp3' }],
      music: ['/audio/music/a.mp3'],
    },
  });
  // ...поднять сервер и подключить сокет, как в соседних тестах
  const message = await nextMessage();

  expect(message).toMatchObject({
    type: 'state',
    audio: {
      effectsEnabled: true,
      effectsVolume: 0.7,
      musicEnabled: true,
      musicVolume: 0.35,
    },
    audioAssets: {
      cues: [{ cue: 'buzzed', url: '/audio/buzz.mp3' }],
      music: ['/audio/music/a.mp3'],
    },
  });
});

it('поднимается без папки audio и без переданных audioAssets', async () => {
  server = createServer({ room, clientDistPath, port: 0, packsDir });
  // ...подключить сокет
  const message = await nextMessage();

  expect(message).toMatchObject({ audioAssets: { cues: [], music: [] } });
});

it('set-audio-settings меняет значения, и они приходят в новом state', async () => {
  // ...подключить сокет
  ws.send(
    JSON.stringify({
      type: 'set-audio-settings',
      settings: { musicVolume: 0.1, effectsEnabled: false },
    }),
  );
  // дождаться state, в котором audio.musicVolume === 0.1
  expect(state.audio).toEqual({
    effectsEnabled: false,
    effectsVolume: 0.7,
    musicEnabled: true,
    musicVolume: 0.1,
  });
});

it('game-cue доходит до подключённого сокета', async () => {
  // партия начата, ход у игрока; выбрать вопрос
  // дождаться сообщения с type === 'game-cue'
  expect(cueMessage).toEqual({ type: 'game-cue', cue: 'question-opened' });
});
```

Ожидание конкретного сообщения среди потока — существующим в файле способом (`collectMessages` + цикл до нужного типа); новых хелперов не заводить, если подходящий уже есть.

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
pnpm --filter server test -- -t "звук"
```

Ожидается: FAIL — полей `audio`/`audioAssets` в сообщении нет.

- [ ] **Step 3: Реализация в `server.ts`**

Импорт:

```ts
import type { AudioAssets } from './protocol.js';
```

В `CreateServerOptions`:

```ts
  // Папка со звуками и то, что в ней нашлось при старте (index.ts,
  // scanAudioAssets). Оба поля опциональны: тестам и CI звуки не нужны
  // вовсе, а отсутствие папки — штатная тишина (design.md,
  // 2026-09-11-game-audio-design.md).
  audioDir?: string;
  audioAssets?: AudioAssets;
```

В `createServer`, рядом с `media`:

```ts
const { audioDir, audioAssets = { cues: [], music: [] } } = options;
// Тем же приёмом, что media выше: sirv на папку, префикс снимается с
// req.url. dev: true — папки может не быть вовсе, и синхронный скан при
// создании уронил бы сервер там, где по дизайну должна быть тишина.
const audio = audioDir ? sirv(audioDir, { dev: true }) : null;
```

В HTTP-обработчике, **до** ветки `/media/`:

```ts
if (audio && req.url?.startsWith('/audio/')) {
  req.url = req.url.slice('/audio'.length);
  audio(req, res, () => {
    res.statusCode = 404;
    res.end('Not found');
  });
  return;
}
```

В `stateMessageFor`, после `historyRecording`:

```ts
      audio: room.getAudioSettings(),
      audioAssets,
```

Рядом с остальными подписками:

```ts
room.onAudioSettingsChange(broadcastState);
// Разовые сигналы идут всем открытым сокетам сразу, без микротаска: у них
// нет проблемы очерёдности с прямым ответом клиенту, ради которой отложен
// broadcastState. Табло их играет, остальные клиенты игнорируют (design.md,
// «Почему всем, а не только табло»).
room.onAudioCue((cue) => {
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      send(ws, { type: 'game-cue', cue });
    }
  }
});
```

В обработчике сообщений, рядом с `admin-set-history-enabled`:

```ts
// Без проверки отправителя — пульт комнаты, шлют и /admin, и /board
// (design.md, «Настройки»).
if (
  message.type === 'set-audio-settings' &&
  typeof message.settings === 'object' &&
  message.settings !== null
) {
  room.setAudioSettings(message.settings);
}
```

- [ ] **Step 4: Реализация в `index.ts`**

Импорты:

```ts
import { scanAudioAssets } from './audioAssets.js';
import { readAudioSettings, writeAudioSettings } from './audioSettings.js';
```

Константы рядом с `LAN_HOST_CONFIG_PATH`:

```ts
const AUDIO_DIR = process.env.AUDIO_DIR ?? './audio';
const AUDIO_SETTINGS_PATH =
  process.env.AUDIO_SETTINGS_PATH ?? './audio-settings.local.json';
```

В `main`, после `room.refreshAvailablePacks(...)`:

```ts
// Сканирование однократное: во время партии файлы никто не добавляет, а на
// этапе подбора звуков перезапуск дев-сервера стоит секунду (design.md,
// «Откуда берутся файлы»).
const audioAssets = await scanAudioAssets(AUDIO_DIR);
const silentCues = 7 - audioAssets.cues.length;
console.log(
  audioAssets.cues.length === 0 && audioAssets.music.length === 0
    ? `Звуки: в ${AUDIO_DIR} ничего не найдено — игра идёт беззвучно.`
    : `Звуки: ${audioAssets.cues.length} из 7 сигналов${
        silentCues > 0 ? ` (${silentCues} молчат)` : ''
      }, треков в плейлисте: ${audioAssets.music.length}.`,
);

// Порядок важен: сначала применяем сохранённое, и только потом
// подписываемся на запись — иначе первое же применение перезаписало бы
// файл тем, что мы из него только что прочитали.
room.setAudioSettings(await readAudioSettings(AUDIO_SETTINGS_PATH));
room.onAudioSettingsChange((settings) => {
  writeAudioSettings(AUDIO_SETTINGS_PATH, settings).catch((err: unknown) => {
    console.error(`Не удалось сохранить ${AUDIO_SETTINGS_PATH}:`, err);
  });
});
```

В вызов `createServer({ ... })` добавить:

```ts
    audioDir: AUDIO_DIR,
    audioAssets,
```

- [ ] **Step 5: Прокси для дев-режима**

В `client/vite.config.ts`, в `server.proxy`, рядом с `/media`:

```ts
      // Без этого звуки не открываются в дев-режиме: клиент на порту Vite,
      // файлы отдаёт сервер на 8080 — ровно та же причина, что у /media.
      '/audio': { target: 'http://localhost:8080' },
```

- [ ] **Step 6: Убедиться, что всё зелёное**

```bash
pnpm --filter server test
pnpm typecheck
```

Ожидается: PASS; `typecheck` зелёный в обеих областях (ошибка из задачи 3 закрыта).

- [ ] **Step 7: Коммит**

```bash
git add server/src/server.ts server/src/index.ts server/src/server.test.ts client/vite.config.ts
git commit -m "feat: сервер раздаёт /audio/, рассылает сигналы и хранит настройки звука"
```

---

### Task 6: Движок звука на клиенте

**Files:**

- Create: `client/src/audio.ts`
- Create: `client/src/audio.test.ts`

**Interfaces:**

- Consumes: ничего из проекта — модуль не знает ни про React, ни про сокеты.
- Produces:
  - типы-зеркала протокола `GameCue`, `AudioSettings`, `AudioAssets` (как `GameStateView` в `useRoomConnection.ts`);
  - `DEFAULT_AUDIO_SETTINGS: AudioSettings`;
  - `MUSIC_FADE_MS = 800`;
  - `interface SoundHandle { volume: number; currentTime: number; play(): Promise<void>; pause(): void; addEventListener(type: 'ended', listener: () => void): void }`;
  - `type SoundFactory = (url: string) => SoundHandle`;
  - `interface AudioEngineOptions { createSound?: SoundFactory; shuffle?: <T>(items: T[]) => T[] }`;
  - `class AudioEngine` с `setAssets(assets)`, `setSettings(settings)`, `playCue(cue)`, `setMusicWanted(wanted)`, `unlock()`, `onBlockedChange(listener): () => void`, `get blocked(): boolean`, `dispose()`.

**Перед началом прочитать** в спеке разделы «Музыка» и «Разблокировка звука».

- [ ] **Step 1: Написать падающие тесты**

`client/src/audio.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  DEFAULT_AUDIO_SETTINGS,
  MUSIC_FADE_MS,
  type SoundHandle,
} from './audio';

class FakeSound implements SoundHandle {
  static created: FakeSound[] = [];
  volume = 1;
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  rejectPlay = false;
  private listeners: (() => void)[] = [];

  constructor(readonly url: string) {
    FakeSound.created.push(this);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    return this.rejectPlay
      ? Promise.reject(new Error('NotAllowedError'))
      : Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
  }

  addEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.push(listener);
  }

  end(): void {
    for (const listener of this.listeners) listener();
  }
}

const assets = {
  cues: [
    { cue: 'buzzed' as const, url: '/audio/buzz.mp3' },
    { cue: 'answer-correct' as const, url: '/audio/correct.mp3' },
  ],
  music: ['/audio/music/a.mp3', '/audio/music/b.mp3'],
};

// Порядок плейлиста детерминирован: перемешивание — забота вызывающего, и
// проверять его случайностью нечестно.
function engine(rejectPlay = false): AudioEngine {
  const e = new AudioEngine({
    createSound: (url) => {
      const sound = new FakeSound(url);
      sound.rejectPlay = rejectPlay;
      return sound;
    },
    shuffle: (items) => [...items],
  });
  e.setAssets(assets);
  e.setSettings(DEFAULT_AUDIO_SETTINGS);
  return e;
}

beforeEach(() => {
  FakeSound.created = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AudioEngine: сигналы', () => {
  it('играет файл, сопоставленный имени сигнала', () => {
    engine().playCue('buzzed');
    expect(FakeSound.created.at(-1)?.url).toBe('/audio/buzz.mp3');
    expect(FakeSound.created.at(-1)?.playCalls).toBe(1);
  });

  it('молчит, когда файла для сигнала нет', () => {
    const e = engine();
    FakeSound.created = [];
    e.playCue('game-ended');
    expect(FakeSound.created).toEqual([]);
  });

  it('молчит при выключенных звуках', () => {
    const e = engine();
    e.setSettings({ ...DEFAULT_AUDIO_SETTINGS, effectsEnabled: false });
    FakeSound.created = [];
    e.playCue('buzzed');
    expect(FakeSound.created).toEqual([]);
  });

  it('ставит громкость сигнала из настроек', () => {
    const e = engine();
    e.setSettings({ ...DEFAULT_AUDIO_SETTINGS, effectsVolume: 0.25 });
    e.playCue('buzzed');
    expect(FakeSound.created.at(-1)?.volume).toBe(0.25);
  });

  it('два сигнала подряд звучат одновременно, а не в очередь', () => {
    const e = engine();
    FakeSound.created = [];
    e.playCue('answer-correct');
    e.playCue('buzzed');
    expect(FakeSound.created.map((s) => s.url)).toEqual([
      '/audio/correct.mp3',
      '/audio/buzz.mp3',
    ]);
  });
});

describe('AudioEngine: музыка', () => {
  it('плавно выводит громкость до целевой за MUSIC_FADE_MS', () => {
    const e = engine();
    e.setMusicWanted(true);
    const track = FakeSound.created.at(-1)!;
    expect(track.url).toBe('/audio/music/a.mp3');
    expect(track.volume).toBe(0);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    expect(track.volume).toBeCloseTo(0.35, 5);
  });

  it('пауза в игре затухает и ставит трек на паузу, не сбрасывая позицию', () => {
    const e = engine();
    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    const track = FakeSound.created.at(-1)!;
    track.currentTime = 42;

    e.setMusicWanted(false);
    vi.advanceTimersByTime(MUSIC_FADE_MS);

    expect(track.volume).toBeCloseTo(0, 5);
    expect(track.pauseCalls).toBe(1);
    expect(track.currentTime).toBe(42);

    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    expect(track.playCalls).toBe(2);
    expect(track.currentTime).toBe(42);
  });

  it('конец трека запускает следующий по кругу', () => {
    const e = engine();
    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    FakeSound.created.at(-1)!.end();
    expect(FakeSound.created.at(-1)?.url).toBe('/audio/music/b.mp3');
    FakeSound.created.at(-1)!.end();
    expect(FakeSound.created.at(-1)?.url).toBe('/audio/music/a.mp3');
  });

  it('выключенная музыка не начинает играть вовсе', () => {
    const e = engine();
    e.setSettings({ ...DEFAULT_AUDIO_SETTINGS, musicEnabled: false });
    FakeSound.created = [];
    e.setMusicWanted(true);
    expect(FakeSound.created).toEqual([]);
  });

  it('выключение музыки на ходу гасит играющий трек', () => {
    const e = engine();
    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    const track = FakeSound.created.at(-1)!;
    e.setSettings({ ...DEFAULT_AUDIO_SETTINGS, musicEnabled: false });
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    expect(track.pauseCalls).toBe(1);
  });

  it('смена громкости на ходу применяется к играющему треку сразу', () => {
    const e = engine();
    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    const track = FakeSound.created.at(-1)!;
    e.setSettings({ ...DEFAULT_AUDIO_SETTINGS, musicVolume: 0.1 });
    expect(track.volume).toBeCloseTo(0.1, 5);
  });

  it('повторный setAssets с тем же списком не перезапускает трек', () => {
    const e = engine();
    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    const before = FakeSound.created.length;
    e.setAssets({ cues: [...assets.cues], music: [...assets.music] });
    expect(FakeSound.created.length).toBe(before);
  });

  it('пустой плейлист не роняет движок', () => {
    const e = engine();
    e.setAssets({ cues: assets.cues, music: [] });
    FakeSound.created = [];
    e.setMusicWanted(true);
    expect(FakeSound.created).toEqual([]);
  });
});

describe('AudioEngine: блокировка браузером', () => {
  it('отклонённый промис воспроизведения поднимает флаг блокировки', async () => {
    const e = engine(true);
    const seen: boolean[] = [];
    e.onBlockedChange((blocked) => seen.push(blocked));

    e.setMusicWanted(true);
    await vi.waitFor(() => expect(e.blocked).toBe(true));
    expect(seen).toEqual([true]);
  });

  it('unlock() снимает флаг и пробует играть заново', async () => {
    let reject = true;
    const e = new AudioEngine({
      createSound: (url) => {
        const sound = new FakeSound(url);
        sound.rejectPlay = reject;
        return sound;
      },
      shuffle: (items) => [...items],
    });
    e.setAssets(assets);
    e.setSettings(DEFAULT_AUDIO_SETTINGS);
    e.setMusicWanted(true);
    await vi.waitFor(() => expect(e.blocked).toBe(true));
    const playsBefore = FakeSound.created.at(-1)!.playCalls;

    reject = false;
    e.unlock();

    expect(e.blocked).toBe(false);
    expect(FakeSound.created.at(-1)!.playCalls).toBeGreaterThan(playsBefore);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
pnpm --filter client test -- -t "AudioEngine"
```

Ожидается: FAIL, `Cannot find module './audio'`.

- [ ] **Step 3: Написать реализацию**

`client/src/audio.ts`:

```ts
// Зеркало серверного протокола (server/src/protocol.ts) — как GameStateView в
// useRoomConnection.ts. Модуль намеренно не знает про React: играющий трек
// переживает любую перерисовку, и попытка держать его в состоянии компонента
// кончается перезапуском музыки на каждом изменении счёта (design.md,
// 2026-09-11-game-audio-design.md, «Раскладка кода»).
export type GameCue =
  | 'question-opened'
  | 'buzzed'
  | 'answer-correct'
  | 'answer-wrong'
  | 'question-timeout'
  | 'round-ended'
  | 'game-ended';

export interface AudioSettings {
  effectsEnabled: boolean;
  effectsVolume: number;
  musicEnabled: boolean;
  musicVolume: number;
}

export interface AudioAssets {
  cues: { cue: GameCue; url: string }[];
  music: string[];
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  effectsEnabled: true,
  effectsVolume: 0.7,
  musicEnabled: true,
  musicVolume: 0.35,
};

// Резкий обрыв музыки в момент открытия вопроса звучит как сбой, а не как
// приём (design.md, «Музыка»).
export const MUSIC_FADE_MS = 800;
const FADE_STEP_MS = 50;

// Минимум от HTMLAudioElement, который движку реально нужен, — чтобы тест мог
// подставить свою реализацию: звукового устройства в тестовой среде нет, и
// проверяется решение, а не проигрывание.
export interface SoundHandle {
  volume: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended', listener: () => void): void;
}

export type SoundFactory = (url: string) => SoundHandle;

export interface AudioEngineOptions {
  createSound?: SoundFactory;
  shuffle?: <T>(items: T[]) => T[];
}

const defaultCreateSound: SoundFactory = (url) => new Audio(url);

function shuffleInPlaceCopy<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function sameCues(a: Map<GameCue, string>, b: Map<GameCue, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [cue, url] of a) {
    if (b.get(cue) !== url) return false;
  }
  return true;
}

export class AudioEngine {
  private readonly createSound: SoundFactory;
  private readonly shuffle: <T>(items: T[]) => T[];
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private cueUrls = new Map<GameCue, string>();
  private playlist: string[] = [];
  private trackIndex = 0;
  private music: SoundHandle | null = null;
  private musicWanted = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private blockedFlag = false;
  private blockedListeners = new Set<(blocked: boolean) => void>();

  constructor(options: AudioEngineOptions = {}) {
    this.createSound = options.createSound ?? defaultCreateSound;
    this.shuffle = options.shuffle ?? shuffleInPlaceCopy;
  }

  get blocked(): boolean {
    return this.blockedFlag;
  }

  onBlockedChange(listener: (blocked: boolean) => void): () => void {
    this.blockedListeners.add(listener);
    return () => this.blockedListeners.delete(listener);
  }

  /**
   * Список файлов приезжает в каждом сообщении state, то есть десятки раз за
   * партию новым объектом. Сравнение по значению здесь не оптимизация, а
   * условие работоспособности: без него плейлист перемешивался бы и музыка
   * начиналась заново на каждом изменении счёта.
   */
  setAssets(assets: AudioAssets): void {
    const nextCues = new Map(assets.cues.map(({ cue, url }) => [cue, url]));
    if (!sameCues(this.cueUrls, nextCues)) this.cueUrls = nextCues;
    if (sameList(this.playlist, assets.music)) return;
    this.stopMusic();
    // Порядок перемешивается при загрузке страницы — то есть ровно один раз,
    // здесь: список приходит с первым же state и дальше не меняется.
    this.playlist = this.shuffle(assets.music);
    this.trackIndex = 0;
    this.syncMusic();
  }

  setSettings(settings: AudioSettings): void {
    const musicWasEnabled = this.settings.musicEnabled;
    this.settings = settings;
    if (musicWasEnabled !== settings.musicEnabled) {
      this.syncMusic();
      return;
    }
    // Громкость применяется сразу, а не следующим затуханием: ползунок
    // подбирают на слух, и задержка в 800 мс делает подбор невозможным.
    if (this.music && this.fadeTimer === null) {
      this.music.volume = settings.musicVolume;
    }
  }

  playCue(cue: GameCue): void {
    if (!this.settings.effectsEnabled) return;
    const url = this.cueUrls.get(cue);
    if (!url) return;
    // Новый элемент на каждый сигнал: два коротких звука, пришедших одним
    // dispatch (верный ответ плюс конец раунда), должны наложиться, а не
    // встать в очередь (design.md, «Как табло узнаёт, что произошло»).
    const sound = this.createSound(url);
    sound.volume = this.settings.effectsVolume;
    void this.attempt(sound);
  }

  setMusicWanted(wanted: boolean): void {
    if (this.musicWanted === wanted) return;
    this.musicWanted = wanted;
    this.syncMusic();
  }

  /**
   * Жест пользователя на табло уже был — снимаем флаг и пробуем заново.
   * Оптимистично: если браузер всё ещё против, следующий отклонённый промис
   * вернёт кнопку на место (design.md, «Разблокировка звука»).
   */
  unlock(): void {
    this.setBlocked(false);
    this.syncMusic();
  }

  dispose(): void {
    this.stopMusic();
    this.blockedListeners.clear();
  }

  private syncMusic(): void {
    if (!this.musicWanted || !this.settings.musicEnabled) {
      if (this.music) {
        const sound = this.music;
        this.fadeTo(0, () => sound.pause());
      }
      return;
    }
    if (this.playlist.length === 0) return;
    if (this.music === null) {
      this.music = this.startTrack(this.playlist[this.trackIndex]);
    } else {
      // Трек продолжается с того места, где затих: партия состоит из
      // коротких пауз, и перезапуск с начала превратил бы любой трек в его
      // первые двадцать секунд (design.md, «Музыка»).
      void this.attempt(this.music);
    }
    this.fadeTo(this.settings.musicVolume);
  }

  private startTrack(url: string): SoundHandle {
    const sound = this.createSound(url);
    sound.volume = 0;
    sound.addEventListener('ended', () => {
      this.trackIndex = (this.trackIndex + 1) % this.playlist.length;
      // Гейт теми же флагами, что и syncMusic: трек может доиграть до конца
      // ровно в те 800 мс, пока музыка гаснет под выбранный вопрос, и без
      // этой проверки следующий трек завёлся бы и вышел на полную громкость
      // поверх вопроса — причём навсегда, потому что повторный
      // setMusicWanted(false) уже no-op.
      if (!this.musicWanted || !this.settings.musicEnabled) {
        this.music = null;
        return;
      }
      this.music = this.startTrack(this.playlist[this.trackIndex]);
      this.fadeTo(this.settings.musicVolume);
    });
    void this.attempt(sound);
    return sound;
  }

  private stopMusic(): void {
    this.clearFade();
    this.music?.pause();
    this.music = null;
  }

  private async attempt(sound: SoundHandle): Promise<void> {
    try {
      await sound.play();
    } catch {
      // Единственный честный признак блокировки — отклонённый промис
      // (design.md, «Разблокировка звука»), гадать по флагам браузера нечем.
      this.setBlocked(true);
    }
  }

  private setBlocked(blocked: boolean): void {
    if (this.blockedFlag === blocked) return;
    this.blockedFlag = blocked;
    for (const listener of this.blockedListeners) listener(blocked);
  }

  private fadeTo(target: number, done?: () => void): void {
    this.clearFade();
    const sound = this.music;
    if (!sound) return;
    const from = sound.volume;
    const steps = Math.max(1, Math.round(MUSIC_FADE_MS / FADE_STEP_MS));
    let step = 0;
    this.fadeTimer = setInterval(() => {
      step += 1;
      sound.volume = from + ((target - from) * step) / steps;
      if (step >= steps) {
        this.clearFade();
        done?.();
      }
    }, FADE_STEP_MS);
  }

  private clearFade(): void {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

```bash
pnpm --filter client test -- -t "AudioEngine"
```

Ожидается: PASS всех трёх групп.

- [ ] **Step 5: Коммит**

```bash
git add client/src/audio.ts client/src/audio.test.ts
git commit -m "feat: движок звука на клиенте — сигналы, плейлист, затухание, разблокировка"
```

---

### Task 7: Проводка звука в `useRoomConnection`

**Files:**

- Modify: `client/src/useRoomConnection.ts` (зеркала протокола ~1–130, `RoomConnection` ~221, состояние ~295, обработчик `state` ~439, возвращаемый объект ~523)
- Test: `client/src/useRoomConnection.test.ts`

**Interfaces:**

- Consumes: `DEFAULT_AUDIO_SETTINGS`, типы `AudioSettings`, `AudioAssets`, `GameCue` из `./audio` (задача 6).
- Produces в `RoomConnection`:
  - `audio: AudioSettings` — текущие настройки из `state`;
  - `audioAssets: AudioAssets` — что нашёл сервер;
  - `setAudioSettings(settings: Partial<AudioSettings>): void`;
  - `subscribeCue(listener: (cue: GameCue) => void): () => void` — **стабильная между рендерами** функция подписки на разовые `game-cue`.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `client/src/useRoomConnection.test.ts`. `baseState` — минимальное сообщение `state` по образцу соседних тестов этого файла; если такого хелпера нет, собрать объект по месту теми же полями, что уже используются рядом.

```ts
it('берёт настройки звука и найденные файлы из state', () => {
  const { result } = renderHook(() => useRoomConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());
  act(() =>
    socket.emitMessage({
      ...baseState,
      audio: {
        effectsEnabled: false,
        effectsVolume: 0.5,
        musicEnabled: true,
        musicVolume: 0.2,
      },
      audioAssets: { cues: [], music: ['/audio/music/a.mp3'] },
    }),
  );

  expect(result.current.audio.effectsEnabled).toBe(false);
  expect(result.current.audioAssets.music).toEqual(['/audio/music/a.mp3']);
});

it('до первого state отдаёт значения по умолчанию', () => {
  const { result } = renderHook(() => useRoomConnection(factory));
  expect(result.current.audio).toEqual({
    effectsEnabled: true,
    effectsVolume: 0.7,
    musicEnabled: true,
    musicVolume: 0.35,
  });
  expect(result.current.audioAssets).toEqual({ cues: [], music: [] });
});

it('setAudioSettings шлёт частичное обновление', () => {
  const { result } = renderHook(() => useRoomConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());
  act(() => result.current.setAudioSettings({ musicVolume: 0.1 }));

  expect(socket.sent).toContainEqual(
    JSON.stringify({
      type: 'set-audio-settings',
      settings: { musicVolume: 0.1 },
    }),
  );
});

it('game-cue доходит до подписчика, в том числе дважды подряд', () => {
  const { result } = renderHook(() => useRoomConnection(factory));
  const socket = FakeWebSocket.instances[0];
  const seen: string[] = [];
  act(() => {
    result.current.subscribeCue((cue) => seen.push(cue));
  });
  act(() => socket.emitOpen());
  act(() => socket.emitMessage({ type: 'game-cue', cue: 'buzzed' }));
  act(() => socket.emitMessage({ type: 'game-cue', cue: 'buzzed' }));

  expect(seen).toEqual(['buzzed', 'buzzed']);
});

it('subscribeCue не меняется между рендерами', () => {
  const { result, rerender } = renderHook(() => useRoomConnection(factory));
  const first = result.current.subscribeCue;
  rerender();
  expect(result.current.subscribeCue).toBe(first);
});

it('отписка перестаёт получать сигналы', () => {
  const { result } = renderHook(() => useRoomConnection(factory));
  const socket = FakeWebSocket.instances[0];
  const seen: string[] = [];
  let off = () => {};
  act(() => {
    off = result.current.subscribeCue((cue) => seen.push(cue));
  });
  act(() => socket.emitOpen());
  act(() => off());
  act(() => socket.emitMessage({ type: 'game-cue', cue: 'buzzed' }));

  expect(seen).toEqual([]);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
pnpm --filter client test -- -t "useRoomConnection"
```

Ожидается: FAIL — `result.current.audio` undefined, `subscribeCue is not a function`.

- [ ] **Step 3: Написать реализацию**

В `client/src/useRoomConnection.ts`.

Импорт:

```ts
import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioAssets,
  type AudioSettings,
  type GameCue,
} from './audio';
```

В зеркала протокола этого файла добавить те же ветки и поля, что на сервере: `| { type: 'set-audio-settings'; settings: Partial<AudioSettings> }` в `ClientMessage`, `| { type: 'game-cue'; cue: GameCue }` в `ServerMessage`, `audio: AudioSettings` и `audioAssets: AudioAssets` в зеркало `state`.

В `RoomConnection`:

```ts
  // Настройки звука — правда одна на всех (server/src/protocol.ts,
  // StateMessage.audio): выключили с телефона, и табло замолчало.
  audio: AudioSettings;
  audioAssets: AudioAssets;
  setAudioSettings(settings: Partial<AudioSettings>): void;
  /**
   * Подписка на разовые сигналы партии. Не состояние: сигнал, положенный в
   * состояние, переиграется на табло при перезагрузке страницы, а два
   * одинаковых сигнала подряд («нажал» дважды за вопрос) не отличались бы
   * друг от друга. Функция стабильна между рендерами — её кладут в useEffect
   * с пустым списком зависимостей.
   */
  subscribeCue(listener: (cue: GameCue) => void): () => void;
```

В теле хука, рядом с остальным состоянием:

```ts
const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
const [audioAssets, setAudioAssets] = useState<AudioAssets>({
  cues: [],
  music: [],
});
const cueListenersRef = useRef(new Set<(cue: GameCue) => void>());
// Через useRef, а не useCallback: функция обязана быть одной и той же всю
// жизнь хука — useBoardAudio подписывается ей один раз при монтировании.
const subscribeCue = useRef((listener: (cue: GameCue) => void) => {
  cueListenersRef.current.add(listener);
  return () => {
    cueListenersRef.current.delete(listener);
  };
}).current;
```

В обработчике `state`, рядом с `setActivePackFilename`:

```ts
setAudio(message.audio);
setAudioAssets(message.audioAssets);
```

Отдельной веткой рядом с обработкой `falsestart`:

```ts
if (message.type === 'game-cue') {
  for (const listener of cueListenersRef.current) {
    listener(message.cue);
  }
}
```

В возвращаемый объект:

```ts
    audio,
    audioAssets,
    setAudioSettings: (settings) =>
      send({ type: 'set-audio-settings', settings }),
    subscribeCue,
```

- [ ] **Step 4: Убедиться, что тесты проходят**

```bash
pnpm --filter client test -- -t "useRoomConnection"
```

Ожидается: PASS.

```bash
pnpm --filter client typecheck
```

Ожидается: ошибки **только** про неполный объект `connection()` в `Board.test.tsx` — они закрываются в задаче 8.

- [ ] **Step 5: Коммит**

```bash
git add client/src/useRoomConnection.ts client/src/useRoomConnection.test.ts
git commit -m "feat: настройки звука и сигналы партии в подключении комнаты"
```

---

### Task 8: Табло — музыка по фазам, панель и разблокировка

**Files:**

- Create: `client/src/useBoardAudio.ts`
- Create: `client/src/useBoardAudio.test.ts`
- Modify: `client/src/Board.tsx`
- Modify: `client/src/Board.test.tsx`
- Modify: `client/src/index.css`

**Interfaces:**

- Consumes: `AudioEngine`, `AudioEngineOptions`, `AudioSettings` (задача 6); `RoomConnection.audio/audioAssets/setAudioSettings/subscribeCue/game` (задача 7).
- Produces: `musicWantedFor(game: GameStateView | null): boolean`, `useBoardAudio(connection: RoomConnection, options?: AudioEngineOptions): { blocked: boolean; unlock: () => void }`.

- [ ] **Step 1: Написать падающий тест правил музыки**

`client/src/useBoardAudio.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { musicWantedFor } from './useBoardAudio';
import type { GameStateView } from './useRoomConnection';

// Каркас: из всего состояния правилу важны только phase и currentQuestion.
function game(
  phase: GameStateView['phase'],
  currentQuestion: GameStateView['currentQuestion'] = null,
): GameStateView {
  return { phase, currentQuestion } as GameStateView;
}

const someQuestion = {
  id: 'q1',
  text: 'Вопрос',
  price: 100,
  themeName: 'Тема',
  image: null,
  video: null,
  revealMs: null,
  fadeMs: 270,
};

describe('musicWantedFor', () => {
  it('в лобби музыка играет', () => {
    expect(musicWantedFor(null)).toBe(true);
  });

  it('играет там, где никто не отвечает на вопрос', () => {
    expect(musicWantedFor(game('selecting'))).toBe(true);
    expect(musicWantedFor(game('round-end'))).toBe(true);
    expect(musicWantedFor(game('final-elim'))).toBe(true);
    expect(musicWantedFor(game('game-end'))).toBe(true);
  });

  it('молчит с момента выбора вопроса — включая «кота» и торги', () => {
    expect(musicWantedFor(game('cat-handoff', someQuestion))).toBe(false);
    expect(musicWantedFor(game('auction-bidding', someQuestion))).toBe(false);
    expect(musicWantedFor(game('question-media', someQuestion))).toBe(false);
    expect(musicWantedFor(game('question-reveal', someQuestion))).toBe(false);
    expect(musicWantedFor(game('question-open', someQuestion))).toBe(false);
    expect(musicWantedFor(game('buzzed', someQuestion))).toBe(false);
    expect(musicWantedFor(game('judging', someQuestion))).toBe(false);
  });

  it('молчит на экране правильного ответа — там идёт разговор', () => {
    expect(musicWantedFor(game('reveal', someQuestion))).toBe(false);
  });

  it('молчит весь финал, кроме вычёркивания тем', () => {
    expect(musicWantedFor(game('final-wager'))).toBe(false);
    expect(musicWantedFor(game('final-answer'))).toBe(false);
    expect(musicWantedFor(game('final-judging'))).toBe(false);
    expect(musicWantedFor(game('final-reveal'))).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
pnpm --filter client test -- -t "musicWantedFor"
```

Ожидается: FAIL, `Cannot find module './useBoardAudio'`.

- [ ] **Step 3: Написать `useBoardAudio.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import { AudioEngine, type AudioEngineOptions } from './audio';
import type { GameStateView, RoomConnection } from './useRoomConnection';

// Фазы, в которых никто не отвечает на вопрос (design.md,
// 2026-09-11-game-audio-design.md, «Музыка»).
const MUSIC_PHASES = new Set<GameStateView['phase']>([
  'selecting',
  'round-end',
  'final-elim',
  'game-end',
]);

/**
 * Тишина начинается с момента выбора вопроса, а не с показа его текста:
 * передача «кота» и торги аукциона — это уже не пауза, хотя текста ещё нет на
 * экране. Поэтому первым проверяется currentQuestion, а не фаза: список фаз
 * растёт от вехи к вехе, а «вопрос выбран» — одно условие, которое от этого
 * роста не зависит.
 */
export function musicWantedFor(game: GameStateView | null): boolean {
  if (!game) return true;
  if (game.currentQuestion !== null) return false;
  return MUSIC_PHASES.has(game.phase);
}

export function useBoardAudio(
  connection: RoomConnection,
  options?: AudioEngineOptions,
): { blocked: boolean; unlock: () => void } {
  const engineRef = useRef<AudioEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new AudioEngine(options);
  }
  const engine = engineRef.current;
  const [blocked, setBlocked] = useState(false);

  useEffect(() => engine.onBlockedChange(setBlocked), [engine]);
  useEffect(() => () => engine.dispose(), [engine]);
  // Подписка ровно одна на всю жизнь табло: subscribeCue стабилен
  // (useRoomConnection), движок живёт в ref.
  useEffect(
    () => connection.subscribeCue((cue) => engine.playCue(cue)),
    [connection.subscribeCue, engine],
  );

  // Прямо в теле рендера, а не в useEffect: audio/audioAssets приезжают новым
  // объектом в каждом сообщении state, и эффект с ними в зависимостях
  // срабатывал бы на каждое изменение счёта. Повторы движок отбрасывает сам,
  // по значению (AudioEngine.setAssets/setSettings/setMusicWanted).
  engine.setAssets(connection.audioAssets);
  engine.setSettings(connection.audio);
  engine.setMusicWanted(musicWantedFor(connection.game));

  return { blocked, unlock: () => engine.unlock() };
}
```

- [ ] **Step 4: Убедиться, что тест правил проходит**

```bash
pnpm --filter client test -- -t "musicWantedFor"
```

Ожидается: PASS.

- [ ] **Step 5: Написать падающий тест блокировки**

Добавить в `client/src/useBoardAudio.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_AUDIO_SETTINGS } from './audio';
import { useBoardAudio } from './useBoardAudio';
import type { RoomConnection } from './useRoomConnection';

describe('useBoardAudio: блокировка', () => {
  function connection(): RoomConnection {
    return {
      audio: DEFAULT_AUDIO_SETTINGS,
      audioAssets: { cues: [], music: ['/audio/music/a.mp3'] },
      game: null,
      subscribeCue: () => () => {},
    } as unknown as RoomConnection;
  }

  it('поднимает blocked, когда браузер отказал в воспроизведении', async () => {
    const { result } = renderHook(() =>
      useBoardAudio(connection(), {
        createSound: () => ({
          volume: 1,
          currentTime: 0,
          play: () => Promise.reject(new Error('NotAllowedError')),
          pause: () => {},
          addEventListener: () => {},
        }),
        shuffle: (items) => [...items],
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.blocked).toBe(true);

    act(() => result.current.unlock());
    expect(result.current.blocked).toBe(false);
  });
});
```

- [ ] **Step 6: Написать падающий тест панели**

В `client/src/Board.test.tsx` дополнить хелпер `connection()` новыми полями: `audio: DEFAULT_AUDIO_SETTINGS`, `audioAssets: { cues: [], music: [] }`, `setAudioSettings: vi.fn()`, `subscribeCue: vi.fn(() => () => {})`. Затем добавить:

```tsx
import userEvent from '@testing-library/user-event';

describe('Board: панель звука', () => {
  it('в свёрнутом виде показывает только иконку', () => {
    mockedUseRoomConnection.mockReturnValue(connection());
    render(<Board />);

    expect(screen.getByRole('button', { name: 'Звук' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Громкость музыки')).not.toBeInTheDocument();
  });

  it('по клику раскрывает четыре ручки с текущими значениями', async () => {
    mockedUseRoomConnection.mockReturnValue(connection());
    render(<Board />);
    await userEvent.click(screen.getByRole('button', { name: 'Звук' }));

    expect(screen.getByLabelText('Звуки событий')).toBeChecked();
    expect(screen.getByLabelText('Громкость звуков')).toHaveValue('0.7');
    expect(screen.getByLabelText('Музыка')).toBeChecked();
    expect(screen.getByLabelText('Громкость музыки')).toHaveValue('0.35');
  });

  it('тумблер шлёт частичное обновление, не трогая остальное', async () => {
    const setAudioSettings = vi.fn();
    mockedUseRoomConnection.mockReturnValue(connection({ setAudioSettings }));
    render(<Board />);
    await userEvent.click(screen.getByRole('button', { name: 'Звук' }));
    await userEvent.click(screen.getByLabelText('Музыка'));

    expect(setAudioSettings).toHaveBeenCalledWith({ musicEnabled: false });
  });

  it('панель закрывается кликом вне её', async () => {
    mockedUseRoomConnection.mockReturnValue(connection());
    render(<Board />);
    await userEvent.click(screen.getByRole('button', { name: 'Звук' }));
    expect(screen.getByLabelText('Музыка')).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByLabelText('Музыка')).not.toBeInTheDocument();
  });

  it('панель есть и в лобби, и на экране итогов', () => {
    mockedUseRoomConnection.mockReturnValue(connection());
    const { unmount } = render(<Board />);
    expect(screen.getByRole('button', { name: 'Звук' })).toBeInTheDocument();
    unmount();

    mockedUseRoomConnection.mockReturnValue(
      connection({ game: baseGame({ phase: 'game-end' }) }),
    );
    render(<Board />);
    expect(screen.getByRole('button', { name: 'Звук' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Убедиться, что тесты падают**

```bash
pnpm --filter client test -- -t "панель звука"
pnpm --filter client test -- -t "useBoardAudio"
```

Ожидается: FAIL — кнопки «Звук» нет, хук не подключён.

- [ ] **Step 8: Перестроить `Board.tsx` и добавить панель**

Нынешнее тело компонента переименовывается в `BoardScreen` и принимает подключение пропсом; `Board` становится оболочкой, в которой живёт звук. Иначе панель пришлось бы вставлять в каждый из шести `return`.

```tsx
export function Board() {
  const connection = useRoomConnection();
  const { blocked, unlock } = useBoardAudio(connection);
  return (
    <>
      <BoardScreen connection={connection} />
      <BoardAudioControls
        settings={connection.audio}
        onChange={connection.setAudioSettings}
        blocked={blocked}
        onUnlock={unlock}
      />
    </>
  );
}

function BoardScreen({ connection }: { connection: RoomConnection }) {
  const { participants, lanUrl, game, mediaFinished } = connection;
  // ...всё нынешнее тело Board без изменений
}
```

Панель — там же, в `Board.tsx`:

```tsx
function BoardAudioControls({
  settings,
  onChange,
  blocked,
  onUnlock,
}: {
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  blocked: boolean;
  onUnlock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Клик вне панели закрывает её: на телевизоре мышью не пользуются, панель
  // открывают редко и с чужого устройства — оставлять её раскрытой поверх
  // игры хуже, чем открыть лишний раз.
  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, [open]);

  return (
    <div className="board-audio" ref={rootRef}>
      {/* Браузер не играет ничего до жеста на странице, а табло — экран, на
          котором никто не кликает. Тот же приём, что у кнопки «▶ Играть» в
          VideoPlayer.tsx (design.md, «Разблокировка звука»). */}
      {blocked && (
        <button className="button button--primary" onClick={onUnlock}>
          🔊 Включить звук
        </button>
      )}
      <button
        className="button board-audio-toggle"
        aria-label="Звук"
        onClick={() => setOpen((value) => !value)}
      >
        🔊
      </button>
      {open && (
        <div className="board-audio-panel">
          <label>
            <input
              type="checkbox"
              checked={settings.effectsEnabled}
              onChange={(e) => onChange({ effectsEnabled: e.target.checked })}
            />{' '}
            Звуки событий
          </label>
          <input
            type="range"
            aria-label="Громкость звуков"
            min={0}
            max={1}
            step={0.05}
            value={settings.effectsVolume}
            onChange={(e) =>
              onChange({ effectsVolume: Number(e.target.value) })
            }
          />
          <label>
            <input
              type="checkbox"
              checked={settings.musicEnabled}
              onChange={(e) => onChange({ musicEnabled: e.target.checked })}
            />{' '}
            Музыка
          </label>
          <input
            type="range"
            aria-label="Громкость музыки"
            min={0}
            max={1}
            step={0.05}
            value={settings.musicVolume}
            onChange={(e) => onChange({ musicVolume: Number(e.target.value) })}
          />
        </div>
      )}
    </div>
  );
}
```

Оформление в `client/src/index.css`, рядом с остальными `.board-*`. Имена CSS-переменных сверить с уже существующими в файле (палитра — `docs/superpowers/specs/2026-09-11-visual-language-design.md`), новых цветов не заводить:

```css
/* Угол табло: с трёх метров панель управления не должна спорить с игрой,
   поэтому в свёрнутом виде это одна иконка. */
.board-audio {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 10;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.board-audio-toggle {
  opacity: 0.35;
}

.board-audio-toggle:hover,
.board-audio-toggle:focus-visible {
  opacity: 1;
}

.board-audio-panel {
  position: absolute;
  right: 0;
  bottom: 3rem;
  display: grid;
  gap: 0.5rem;
  min-width: 16rem;
  padding: 1rem;
  border-radius: 0.75rem;
  background: var(--surface-raised);
  box-shadow: 0 0.5rem 2rem rgb(0 0 0 / 0.45);
}
```

- [ ] **Step 9: Убедиться, что всё зелёное**

```bash
pnpm --filter client test
pnpm --filter client typecheck
```

Ожидается: PASS, включая все старые тесты `Board.test.tsx`.

- [ ] **Step 10: Коммит**

```bash
git add client/src/useBoardAudio.ts client/src/useBoardAudio.test.ts client/src/Board.tsx client/src/Board.test.tsx client/src/index.css
git commit -m "feat: табло играет сигналы и музыку, панель звука и кнопка разблокировки"
```

---

### Task 9: Админка — секция «Звук»

**Files:**

- Modify: `client/src/useAdminConnection.ts` (зеркало `state` ~67, `AdminConnection` ~188, состояние ~299, обработчик ~369, возврат ~469)
- Modify: `client/src/Admin.tsx` (новая секция после «Проявление буквы на табло»)
- Test: `client/src/useAdminConnection.test.ts`, `client/src/Admin.test.tsx`

**Interfaces:**

- Consumes: `DEFAULT_AUDIO_SETTINGS`, типы `AudioSettings`, `AudioAssets`, `GameCue` из `./audio`.
- Produces в `AdminConnection`: `audio: AudioSettings`, `audioAssets: AudioAssets`, `setAudioSettings(settings: Partial<AudioSettings>): void`.

- [ ] **Step 1: Написать падающие тесты**

В `client/src/useAdminConnection.test.ts`, по образцу теста про `textRevealFadeMs`:

```ts
it('берёт настройки звука и найденные файлы из state', () => {
  // ...emitMessage со state, где audio.musicVolume === 0.2 и
  // audioAssets.cues === [{ cue: 'buzzed', url: '/audio/buzz.mp3' }]
  expect(result.current.audio.musicVolume).toBe(0.2);
  expect(result.current.audioAssets.cues).toEqual([
    { cue: 'buzzed', url: '/audio/buzz.mp3' },
  ]);
});

it('setAudioSettings шлёт set-audio-settings', () => {
  act(() => result.current.setAudioSettings({ effectsVolume: 0.9 }));
  expect(socket.sent).toContainEqual(
    JSON.stringify({
      type: 'set-audio-settings',
      settings: { effectsVolume: 0.9 },
    }),
  );
});
```

В `client/src/Admin.test.tsx` дополнить хелпер подключения полями `audio`, `audioAssets`, `setAudioSettings: vi.fn()` и добавить:

```tsx
describe('Admin: секция «Звук»', () => {
  it('показывает четыре ручки с текущими значениями', () => {
    renderAdmin({
      audio: {
        effectsEnabled: true,
        effectsVolume: 0.7,
        musicEnabled: false,
        musicVolume: 0.35,
      },
    });

    expect(screen.getByLabelText('Звуки событий')).toBeChecked();
    expect(screen.getByLabelText('Музыка')).not.toBeChecked();
    expect(screen.getByLabelText('Громкость музыки')).toHaveValue('0.35');
  });

  it('показывает, какие сигналы озвучены, а какие молчат', () => {
    renderAdmin({
      audioAssets: {
        cues: [{ cue: 'buzzed', url: '/audio/buzz.mp3' }],
        music: ['/audio/music/a.mp3', '/audio/music/b.mp3'],
      },
    });

    expect(screen.getByText(/Игрок нажал кнопку — звучит/)).toBeInTheDocument();
    expect(
      screen.getByText(/Ответ засчитан — молчит, файла нет/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Треков в плейлисте: 2/)).toBeInTheDocument();
  });

  it('пустая папка объясняется словами, а не пустым списком', () => {
    renderAdmin({ audioAssets: { cues: [], music: [] } });

    expect(
      screen.getByText(/Файлов не найдено — игра идёт беззвучно/),
    ).toBeInTheDocument();
  });

  it('ползунок громкости шлёт частичное обновление', () => {
    const setAudioSettings = vi.fn();
    renderAdmin({ setAudioSettings });

    fireEvent.change(screen.getByLabelText('Громкость музыки'), {
      target: { value: '0.5' },
    });

    expect(setAudioSettings).toHaveBeenCalledWith({ musicVolume: 0.5 });
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
pnpm --filter client test -- -t "Звук"
```

Ожидается: FAIL.

- [ ] **Step 3: Проводка в `useAdminConnection.ts`**

Тем же паттерном, что `textRevealFadeMs`. Состояние:

```ts
const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
const [audioAssets, setAudioAssets] = useState<AudioAssets>({
  cues: [],
  music: [],
});
```

В обработчике `state`:

```ts
setAudio(message.audio);
setAudioAssets(message.audioAssets);
```

В возвращаемый объект:

```ts
    audio,
    audioAssets,
    setAudioSettings: (settings) =>
      send({ type: 'set-audio-settings', settings }),
```

Плюс те же поля в зеркало `state` этого файла и в интерфейс `AdminConnection`.

- [ ] **Step 4: Секция в `Admin.tsx`**

Рядом с другими константами файла:

```tsx
// Порядок — как в сканере (server/src/audioAssets.ts): список читают глазами
// и сверяют с папкой, он не должен прыгать между запусками.
const CUE_LABELS: { cue: GameCue; label: string }[] = [
  { cue: 'question-opened', label: 'Вопрос открылся' },
  { cue: 'buzzed', label: 'Игрок нажал кнопку' },
  { cue: 'answer-correct', label: 'Ответ засчитан' },
  { cue: 'answer-wrong', label: 'Ответ не засчитан' },
  { cue: 'question-timeout', label: 'Время вышло, никто не нажал' },
  { cue: 'round-ended', label: 'Раунд закончился' },
  { cue: 'game-ended', label: 'Партия закончилась' },
];
```

Секция — после «Проявление буквы на табло (временно)»:

```tsx
<section className="admin-section">
  <h2>Звук</h2>
  <p>
    Звучит только табло: шесть телефонов, играющих один сигнал с разной
    задержкой по Wi-Fi, — это не атмосфера, а каша.
  </p>
  <p>
    <label>
      <input
        type="checkbox"
        checked={audio.effectsEnabled}
        onChange={(e) => setAudioSettings({ effectsEnabled: e.target.checked })}
      />{' '}
      Звуки событий
    </label>
  </p>
  <p>
    <input
      type="range"
      aria-label="Громкость звуков"
      min={0}
      max={1}
      step={0.05}
      value={audio.effectsVolume}
      onChange={(e) =>
        setAudioSettings({ effectsVolume: Number(e.target.value) })
      }
    />
  </p>
  <p>
    <label>
      <input
        type="checkbox"
        checked={audio.musicEnabled}
        onChange={(e) => setAudioSettings({ musicEnabled: e.target.checked })}
      />{' '}
      Музыка
    </label>
  </p>
  <p>
    <input
      type="range"
      aria-label="Громкость музыки"
      min={0}
      max={1}
      step={0.05}
      value={audio.musicVolume}
      onChange={(e) =>
        setAudioSettings({ musicVolume: Number(e.target.value) })
      }
    />
  </p>
  {/* Список нужен ровно затем, чтобы вопрос «почему не звучит» решался
            взглядом: это либо «файла нет», либо «звук выключен», и третьего
            варианта быть не должно (design.md, «Интерфейс»). */}
  {audioAssets.cues.length === 0 && audioAssets.music.length === 0 ? (
    <p>
      Файлов не найдено — игра идёт беззвучно. Положите файлы в папку{' '}
      <code>audio/</code> (список имён — в <code>audio/README.md</code>) и
      перезапустите сервер.
    </p>
  ) : (
    <>
      <ul className="admin-audio-cues">
        {CUE_LABELS.map(({ cue, label }) => (
          <li key={cue}>
            {label} —{' '}
            {audioAssets.cues.some((a) => a.cue === cue)
              ? 'звучит'
              : 'молчит, файла нет'}
          </li>
        ))}
      </ul>
      <p>Треков в плейлисте: {audioAssets.music.length}</p>
    </>
  )}
</section>
```

- [ ] **Step 5: Убедиться, что тесты проходят**

```bash
pnpm --filter client test
```

Ожидается: PASS.

- [ ] **Step 6: Коммит**

```bash
git add client/src/useAdminConnection.ts client/src/useAdminConnection.test.ts client/src/Admin.tsx client/src/Admin.test.tsx
git commit -m "feat: секция «Звук» в /admin — ручки и список найденных файлов"
```

---

### Task 10: Проверка вехи целиком

**Files:** изменений кода не предполагается; всё, что вскроется, чинится здесь же.

- [ ] **Step 1: Прогнать все проверки и посмотреть вывод**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Ожидается: все четыре зелёные. Упало — чинить причину; три попытки без результата — остановиться и рассказать, что происходит, а не крутить цикл.

- [ ] **Step 2: Убедиться, что всё работает без папки `audio/`**

Переименовать папку, прогнать серверные тесты и сборку, вернуть обратно:

```bash
mv audio audio.off && pnpm --filter server test && pnpm build; mv audio.off audio
```

Ожидается: PASS. Смысл — ровно та ситуация, в которой живёт CI: звуковых файлов нет вообще.

- [ ] **Step 3: Проверить звук в живом сервере**

```bash
pnpm build && pnpm --filter server start
```

Открыть `/board`, убедиться: в консоли сервера напечатано, сколько сигналов найдено (сейчас в папке нет `round-end` и `game-end` — должно быть «5 из 7 сигналов (2 молчат)»); на табло появилась кнопка «🔊 Включить звук»; после клика играет музыка; в `/admin` секция «Звук» показывает те же два молчащих сигнала.

- [ ] **Step 4: E2E**

```bash
pnpm test:e2e
```

Ожидается: не хуже, чем до ветки. Известное состояние на 2026-09-11: сценарии входа игрока падают из-за устаревшего `join` в самих спеках — это не поломка этой вехи. Новых падений быть не должно; появились — чинить.

- [ ] **Step 5: Ревью**

Skill `superpowers:requesting-code-review`. Отдельно попросить проверить инвариант 1: движок не изменён ни на строку, сигналы выведены в комнате из снимков «до/после», в новом коде нет ни `Date.now()`, ни таймеров внутри движка.

- [ ] **Step 6: PR**

Skill `superpowers:finishing-a-development-branch`. Заголовок PR — строка changelog: `feat: звук игры — сигналы событий и фоновая музыка на табло`.

- [ ] **Step 7: Живая игра**

Веха не закрыта, пока по ней не сыграна настоящая партия с живыми людьми. Смотреть и записать в раздел «Проверено вживую» в `.claude/skills/svoya-igra-dev/SKILL.md`:

- нашлась ли кнопка разблокировки на табло — или звук молча не заиграл весь вечер;
- 0.35 для музыки и 0.7 для сигналов — те ли это числа в настоящей комнате на настоящем телевизоре;
- не раздражает ли сигнал нажатия при частых перехватах;
- 800 мс затухания — успевает ли музыка уйти до того, как вопрос появился на экране;
- не наложилась ли музыка на звук видео-вопроса (по общему правилу не должна — проверить отдельно).
