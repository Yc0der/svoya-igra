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
