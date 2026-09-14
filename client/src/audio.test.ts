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
  paused = true;
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
    if (this.rejectPlay) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  addEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.push(listener);
  }

  end(): void {
    this.paused = true;
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

function soundsFor(url: string): FakeSound[] {
  return FakeSound.created.filter((s) => s.url === url);
}

describe('AudioEngine: сигналы', () => {
  it('играет файл, сопоставленный имени сигнала', () => {
    engine().playCue('buzzed');
    expect(soundsFor('/audio/buzz.mp3')[0]?.playCalls).toBe(1);
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
    e.playCue('buzzed');
    expect(FakeSound.created.every((s) => s.playCalls === 0)).toBe(true);
  });

  it('ставит громкость сигнала из настроек', () => {
    const e = engine();
    e.setSettings({ ...DEFAULT_AUDIO_SETTINGS, effectsVolume: 0.25 });
    e.playCue('buzzed');
    expect(soundsFor('/audio/buzz.mp3')[0]?.volume).toBe(0.25);
  });

  // Живая проверка: сигнал, создаваемый в момент события, сначала качается
  // с сервера и только потом звучит — нажатие слышно с опозданием.
  it('готовит файлы сигналов заранее, как только пришёл список', () => {
    engine();
    expect(FakeSound.created.map((s) => s.url)).toEqual([
      '/audio/buzz.mp3',
      '/audio/correct.mp3',
    ]);
  });

  it('равный по значению список не пересоздаёт готовые сигналы', () => {
    const e = engine();
    e.setAssets({ ...assets, cues: [...assets.cues] });
    expect(soundsFor('/audio/buzz.mp3')).toHaveLength(1);
  });

  it('доигравший сигнал повторяется тем же файлом с начала', () => {
    const e = engine();
    e.playCue('buzzed');
    const [buzz] = soundsFor('/audio/buzz.mp3');
    buzz.currentTime = 0.4;
    buzz.end();
    e.playCue('buzzed');
    expect(soundsFor('/audio/buzz.mp3')).toHaveLength(1);
    expect(buzz.playCalls).toBe(2);
    expect(buzz.currentTime).toBe(0);
  });

  it('разные сигналы подряд звучат одновременно, а не в очередь', () => {
    const e = engine();
    e.playCue('answer-correct');
    e.playCue('buzzed');
    expect(soundsFor('/audio/correct.mp3')[0]?.playCalls).toBe(1);
    expect(soundsFor('/audio/buzz.mp3')[0]?.playCalls).toBe(1);
  });

  it('тот же сигнал, пока предыдущий ещё звучит, накладывается новым файлом', () => {
    const e = engine();
    e.playCue('buzzed');
    e.playCue('buzzed');
    const buzzes = soundsFor('/audio/buzz.mp3');
    expect(buzzes).toHaveLength(2);
    expect(buzzes.map((s) => s.playCalls)).toEqual([1, 1]);
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

  // F1 (финальная волна): при неидентичном перемешивании playlist хранит
  // shuffled-порядок, а сравнивался он с исходным (неперемешанным) списком —
  // почти никогда не совпадали, и музыка перезапускалась на каждый вызов
  // setAssets, то есть на каждое сообщение state. Тест с identity-шафлом
  // (как в engine() выше) эту разницу не ловит вообще — shuffled === исходный.
  it('повторный setAssets с равным по значению списком не перезапускает трек даже при неидентичном перемешивании', () => {
    const e = new AudioEngine({
      createSound: (url) => new FakeSound(url),
      shuffle: (items) => [...items].reverse(),
    });
    e.setAssets(assets);
    e.setSettings(DEFAULT_AUDIO_SETTINGS);
    e.setMusicWanted(true);
    vi.advanceTimersByTime(MUSIC_FADE_MS);
    const track = FakeSound.created.at(-1)!;
    const before = FakeSound.created.length;

    // Новый объект, то же содержимое — как приходит с каждым state с сервера.
    e.setAssets({ cues: [...assets.cues], music: [...assets.music] });

    expect(FakeSound.created.length).toBe(before);
    expect(track.pauseCalls).toBe(0);
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
