import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AudioAssets, GameCue } from './protocol.js';

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
