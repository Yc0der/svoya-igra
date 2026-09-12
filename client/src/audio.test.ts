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
  readonly url: string;

  // Раскрытая parameter property: erasableSyntaxOnly в tsconfig.app.json
  // запрещает сокращённую форму `constructor(readonly url: string)`.
  constructor(url: string) {
    this.url = url;
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

  it('трек, доигравший естественным концом во время затухания на паузе, не воскрешает музыку', () => {
    const e = engine();
    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    const before = FakeSound.created.length;

    e.setMusicWanted(false);
    // Затухание ещё не доиграно — трек кончается сам, не по fadeTo(0).
    FakeSound.created.at(-1)!.end();

    // Новый элемент на 'ended' не создаётся: музыка сейчас не нужна.
    expect(FakeSound.created.length).toBe(before);

    vi.advanceTimersByTime(MUSIC_FADE_MS);
    // После полного прокручивания таймеров ничего нового не заиграло.
    expect(FakeSound.created.length).toBe(before);

    // Следующее включение начинает со следующего трека, а не воскрешает
    // доигравший.
    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    expect(FakeSound.created.at(-1)?.url).toBe('/audio/music/b.mp3');
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
