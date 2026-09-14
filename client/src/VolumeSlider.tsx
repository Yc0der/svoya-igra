import { useEffect, useState } from 'react';

/**
 * Общий ползунок громкости для Board.tsx и Admin.tsx — раньше одна и та же
 * разметка (aria-label, min/max/step, обработчик) была продублирована в обоих
 * местах дословно.
 *
 * Управляется значением с сервера (`value`), но не напрямую: между `input` и
 * приходом эха с сервера (`state`) проходит время, и синхронизация локального
 * значения из пропа на каждое изменение `value` откатывала бы ползунок назад
 * посреди протяжки — эхо более раннего шага, пришедшее после более позднего
 * локального шага, обязано быть проигнорировано (найдено финальной волной
 * ревью, F5: «ползунки дёргаются — значение двигается только по эху
 * сервера»). Синхронизация с сервером происходит, только когда пользователь
 * сейчас не тянет ползунок сам — тогда правку с другого экрана видно как
 * обычно.
 */
export function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const [interacting, setInteracting] = useState(false);

  useEffect(() => {
    if (!interacting) setDisplayValue(value);
  }, [value, interacting]);

  const stopInteracting = (): void => setInteracting(false);

  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={1}
      step={0.05}
      value={displayValue}
      onChange={(e) => {
        // Отправка идёт на каждый шаг, не только на отпускание: громкость
        // подбирают на слух, звук должен следовать за ползунком живьём
        // (design.md, «Настройки»).
        const next = Number(e.target.value);
        setInteracting(true);
        setDisplayValue(next);
        onChange(next);
      }}
      onPointerUp={stopInteracting}
      // Касание, прерванное системой (скролл, жест), приходит без pointerup.
      onPointerCancel={stopInteracting}
      onKeyUp={stopInteracting}
      onBlur={stopInteracting}
    />
  );
}
