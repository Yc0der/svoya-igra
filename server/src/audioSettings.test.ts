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
