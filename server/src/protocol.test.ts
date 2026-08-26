import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TAG_REASONS } from './protocol.js';

// Клиент не импортирует из server/ (инвариант «веб-часть не знает, что она
// внутри Tauri», и общее правило проекта: общий пакет между ними не заводится).
// Поэтому список причин продублирован в client/src/useRoomConnection.ts вручную
// — а раз копия ручная, её расхождение с оригиналом нужно ловить тестом.
//
// Цена расхождения выросла со слайсом B (2026-08-25). Раньше разошедшийся
// вариант просто отбрасывался валидацией сервера, и игрок видел, что причина не
// сохранилась. Теперь по причине «Неинтересная тема» строится целый блок
// профиля генератора («Темы, названные неинтересными», history.ts,
// REASON_BORING_THEME): разойдись именно эта строка — сервер молча отбросит
// сообщение, блок навсегда останется пустым, и ни в логе, ни на экране не
// появится ни одной ошибки. Пустой блок неотличим от «никто не жаловался».
const CLIENT_SOURCE = new URL(
  '../../client/src/useRoomConnection.ts',
  import.meta.url,
);

describe('TAG_REASONS', () => {
  it('дословно совпадает с копией на клиенте, включая порядок', () => {
    const source = readFileSync(CLIENT_SOURCE, 'utf8');
    const block = /export const TAG_REASONS = \[([^\]]*)\] as const;/.exec(
      source,
    );
    // Отдельная проверка, а не `block!`: если константу на клиенте
    // переименуют или перепишут в другой форме, регулярка перестанет
    // совпадать — и тест обязан упасть с внятным сообщением, а не
    // молча пройти на пустом списке.
    expect(
      block,
      'не нашёл TAG_REASONS в client/src/useRoomConnection.ts',
    ).not.toBeNull();

    const clientReasons = [...block![1].matchAll(/'([^']*)'/g)].map(
      (match) => match[1],
    );
    expect(clientReasons).toEqual([...TAG_REASONS]);
  });
});
