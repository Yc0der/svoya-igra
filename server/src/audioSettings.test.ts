import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AudioSettings } from './audioSettings.js';
import {
  createAudioSettingsWriter,
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

// F2 (финальная волна): index.ts раньше запускал writeAudioSettings без
// ожидания на каждый set-audio-settings. writeFileAtomic пишет во временный
// файл с фиксированным именем `${path}.tmp` — при быстрой протяжке ползунка
// несколько одновременных записей делят один и тот же временный файл, и
// более ранний rename проигрывает гонку более позднему с ENOENT (не входит в
// RETRY_CODES). Замерено на этой машине живым writeFileAtomic: 132 ENOENT на
// 50 симулированных протяжек по 20 записей. Лечится не самим atomicWrite (он
// уже правильно решает свою куда более узкую задачу — не отдать читателю
// половину файла), а тем, чтобы вообще не пускать две записи одновременно.
describe('AudioSettings: запись без гонок (createAudioSettingsWriter)', () => {
  function settingsWith(musicVolume: number): AudioSettings {
    return { ...DEFAULT_AUDIO_SETTINGS, musicVolume };
  }

  it('пока идёт запись, копится только последнее значение — не одна запись на каждый вызов', async () => {
    const calls: AudioSettings[] = [];
    let resolveCurrent: (() => void) | null = null;
    const write = vi.fn((settings: AudioSettings) => {
      calls.push(settings);
      return new Promise<void>((resolve) => {
        resolveCurrent = resolve;
      });
    });
    const writer = createAudioSettingsWriter(write);

    // Четыре быстрых вызова, как четыре шага протяжки ползунка — запись
    // первого ещё не завершилась, когда приходят остальные три.
    writer(settingsWith(0.1));
    writer(settingsWith(0.2));
    writer(settingsWith(0.3));
    writer(settingsWith(0.4));

    expect(write).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual(settingsWith(0.1));

    resolveCurrent!();
    await Promise.resolve();
    await Promise.resolve();

    // Промежуточные 0.2 и 0.3 схлопнулись — записано только последнее.
    expect(write).toHaveBeenCalledTimes(2);
    expect(calls[1]).toEqual(settingsWith(0.4));

    resolveCurrent!();
    await Promise.resolve();
    await Promise.resolve();

    // В очереди больше ничего нет — третьей записи не появляется.
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('запись никогда не начинается, пока не завершилась предыдущая', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const write = vi.fn(async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
    });
    const writer = createAudioSettingsWriter(write);

    for (let i = 0; i < 20; i += 1) writer(settingsWith(i / 20));
    for (let i = 0; i < 60; i += 1) await Promise.resolve();

    expect(maxConcurrent).toBe(1);
  });
});
