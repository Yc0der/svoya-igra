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
