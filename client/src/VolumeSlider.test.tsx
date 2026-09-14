import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VolumeSlider } from './VolumeSlider';

// F5 (финальная волна): ползунки на Board и Admin были управляемы только
// пропом с сервера — между собственным input и приходом эха state тумблер
// откатывался на старое значение, видимый джиттер на телефоне ведущего по
// Wi-Fi. Тест ловит именно это: значение обязано остаться тем, что ввёл
// человек, до следующей синхронизации с сервером.
describe('VolumeSlider', () => {
  it('после change показывает новое значение, даже когда проп ещё не поменялся', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VolumeSlider
        label="Громкость музыки"
        value={0.35}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Громкость музыки'), {
      target: { value: '0.6' },
    });

    expect(screen.getByLabelText('Громкость музыки')).toHaveValue('0.6');
    expect(onChange).toHaveBeenCalledWith(0.6);

    // Эхо ещё не пришло — проп у компонента тот же, что при монтировании.
    rerender(
      <VolumeSlider
        label="Громкость музыки"
        value={0.35}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('Громкость музыки')).toHaveValue('0.6');
  });

  it('пока пользователь не взаимодействует, значение следует за пропом', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VolumeSlider
        label="Громкость музыки"
        value={0.35}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('Громкость музыки')).toHaveValue('0.35');

    // Правка пришла с другого экрана — сам ползунок никто не трогал.
    rerender(
      <VolumeSlider label="Громкость музыки" value={0.7} onChange={onChange} />,
    );
    expect(screen.getByLabelText('Громкость музыки')).toHaveValue('0.7');
  });

  it('эхо более раннего шага, пришедшее после более позднего локального, не откатывает ползунок', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VolumeSlider
        label="Громкость музыки"
        value={0.35}
        onChange={onChange}
      />,
    );

    // Пользователь тянет ползунок: 0.4, потом 0.45.
    fireEvent.change(screen.getByLabelText('Громкость музыки'), {
      target: { value: '0.4' },
    });
    fireEvent.change(screen.getByLabelText('Громкость музыки'), {
      target: { value: '0.45' },
    });

    // Сервер эхает первый шаг (0.4) с опозданием, пока драг ещё идёт —
    // проп меняется на устаревшее значение.
    rerender(
      <VolumeSlider label="Громкость музыки" value={0.4} onChange={onChange} />,
    );

    expect(screen.getByLabelText('Громкость музыки')).toHaveValue('0.45');
  });
});
