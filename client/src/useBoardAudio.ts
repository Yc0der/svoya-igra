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
