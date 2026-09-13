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

  /**
   * StrictMode в деве прогоняет монтирование → очистку → повторное
   * монтирование эффектов на одном и том же рендере, без перерисовки между
   * ними: вызовы setAssets/setSettings/setMusicWanted из хука не повторяются
   * сами по себе, а срабатывают только на изменение значения. Без сброса
   * сравнительного состояния здесь повторная синхронизация после такой
   * очистки ничего не увидела бы — settings/playlist/musicWanted совпали бы
   * с уже применёнными — и музыка осталась бы молчать до первой настоящей
   * смены фазы или настроек. Сброс к пустому состоянию гарантирует, что
   * следующий вызов setAssets/setSettings/setMusicWanted (тем же значением,
   * что и раньше) снова дойдёт до syncMusic().
   */
  dispose(): void {
    this.stopMusic();
    this.blockedListeners.clear();
    this.settings = { ...DEFAULT_AUDIO_SETTINGS };
    this.cueUrls = new Map();
    this.playlist = [];
    this.trackIndex = 0;
    this.musicWanted = false;
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
      // Настоящий 'ended' может прийти, пока музыка уже гасится или выключена
      // (fadeTo(0) после setMusicWanted(false) ещё не доиграл затухание): без
      // этой проверки следующий трек всё равно стартовал бы на полной
      // громкости поверх вопроса, а musicWanted уже false, так что само не
      // исправится (следующий setMusicWanted(false) — no-op при неизменном
      // флаге). trackIndex при этом всё равно продвигается: при следующем
      // включении логично начать со следующего трека, а не воскрешать
      // доигравший.
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
