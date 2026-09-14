import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomicWrite.js';
import type { AudioSettings } from './protocol.js';

export type { AudioSettings };

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

/**
 * Сериализует запись и схлопывает к последнему значению: пока предыдущая
 * запись ещё не завершилась, копится только самое свежее — не одна запись на
 * каждый вызов. `set-audio-settings` шлётся на каждый шаг протяжки ползунка,
 * а `writeFileAtomic` (atomicWrite.ts) пишет во временный файл с фиксированным
 * именем `${path}.tmp`: несколько незавершённых записей на один путь делят
 * этот временный файл, и более ранний rename проигрывает гонку более
 * позднему с ENOENT (не входит в RETRY_CODES). Живьём на этой машине — 132
 * таких отказа на 50 симулированных протяжек по 20 записей.
 *
 * `write` внедряется, чтобы тест мог управлять порядком завершения промисов
 * напрямую, без гонки с реальным временем/диском (то же соображение, что у
 * SoundFactory в client/src/audio.ts).
 */
export function createAudioSettingsWriter(
  write: (settings: AudioSettings) => Promise<void>,
): (settings: AudioSettings) => void {
  let writing = false;
  let queued: AudioSettings | null = null;

  const run = (settings: AudioSettings): void => {
    writing = true;
    void write(settings).finally(() => {
      writing = false;
      if (queued !== null) {
        const next = queued;
        queued = null;
        run(next);
      }
    });
  };

  return (settings: AudioSettings): void => {
    if (writing) {
      queued = settings;
      return;
    }
    run(settings);
  };
}
