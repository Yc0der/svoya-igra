import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATE_TTL_MS, loadState, saveState } from './state.mjs';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'checkpoint-state-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Делает файл «старым», сдвигая mtime на заданный возраст назад. */
async function age(path, ms) {
  const when = new Date(Date.now() - ms);
  await utimes(path, when, when);
}

const statePath = (dir, session) => join(dir, `checkpoint-${session}.json`);

test('loadState на пустом месте отдаёт состояние по умолчанию', async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await loadState(statePath(dir, 'нет-такой')), {
      checks: 'unknown',
      remindedSha: null,
      remindedArtifacts: [],
    });
  });
});

test('saveState записывает состояние, которое читает loadState', async () => {
  await withTempDir(async (dir) => {
    const path = statePath(dir, 'session-a');
    await saveState(dir, path, { checks: 'green', remindedSha: 'abc' });

    const state = await loadState(path);
    assert.equal(state.checks, 'green');
    assert.equal(state.remindedSha, 'abc');
  });
});

test('saveState не оставляет временного файла рядом с состоянием', async () => {
  await withTempDir(async (dir) => {
    const path = statePath(dir, 'session-a');
    await saveState(dir, path, { checks: 'green' });

    // Обрезанный JSON loadState примет за отсутствующее состояние и потеряет дедуп,
    // поэтому пишем во временный файл и переименовываем. Но временный файл — деталь
    // записи: после неё в каталоге не должно остаться ничего лишнего.
    assert.deepEqual(await readdir(dir), ['checkpoint-session-a.json']);
  });
});

test('saveState подметает файлы состояния чужих сессий старше TTL', async () => {
  await withTempDir(async (dir) => {
    const stale = statePath(dir, 'позапрошлая');
    writeFileSync(stale, '{}', 'utf8');
    await age(stale, STATE_TTL_MS + 60_000);

    await saveState(dir, statePath(dir, 'нынешняя'), { checks: 'green' });

    assert.equal(existsSync(stale), false);
  });
});

test('saveState не трогает свежие файлы состояния и собственный файл', async () => {
  await withTempDir(async (dir) => {
    const fresh = statePath(dir, 'вчерашняя');
    writeFileSync(fresh, '{}', 'utf8');
    await age(fresh, STATE_TTL_MS / 2);

    const own = statePath(dir, 'нынешняя');
    await saveState(dir, own, { checks: 'green' });

    assert.equal(existsSync(fresh), true);
    assert.equal(existsSync(own), true);
  });
});

test('saveState подметает только свои файлы, а не всё подряд в каталоге', async () => {
  await withTempDir(async (dir) => {
    // Каталог может быть не только нашим: удалять по возрасту всё, что там лежит, —
    // это удалять чужое. Подметаем строго то, что сами и пишем.
    const alien = join(dir, 'важное.txt');
    writeFileSync(alien, 'не наше', 'utf8');
    await age(alien, STATE_TTL_MS * 10);

    await saveState(dir, statePath(dir, 'нынешняя'), { checks: 'green' });

    assert.equal(existsSync(alien), true);
  });
});

test('saveState создаёт каталог состояния, если его ещё нет', async () => {
  await withTempDir(async (dir) => {
    const nested = join(dir, '.claude', 'state');
    const path = statePath(nested, 'session-a');

    await saveState(nested, path, { checks: 'green' });

    assert.equal(JSON.parse(await readFile(path, 'utf8')).checks, 'green');
  });
});

test('состояние переживает сорвавшуюся запись: остаётся прежнее, а не обрезанное', async () => {
  await withTempDir(async (dir) => {
    const path = statePath(dir, 'session-a');
    await saveState(dir, path, { checks: 'green', remindedSha: 'прежний' });

    // Запись срывается: на месте временного файла — каталог, писать туда нельзя.
    // Прямая запись в сам файл состояния в этот момент оставила бы его обрезанным;
    // запись через временный файл с переименованием — не трогает его вовсе.
    mkdirSync(`${path}.tmp`, { recursive: true });
    await saveState(dir, path, { checks: 'red', remindedSha: 'новый' });

    assert.equal((await loadState(path)).remindedSha, 'прежний');
  });
});

test('saveState подметает временный файл, оставшийся от убитой записи', async () => {
  await withTempDir(async (dir) => {
    const leftover = `${statePath(dir, 'убитая')}.tmp`;
    writeFileSync(leftover, '{"обрез', 'utf8');
    await age(leftover, STATE_TTL_MS + 60_000);

    await saveState(dir, statePath(dir, 'нынешняя'), { checks: 'green' });

    assert.equal(existsSync(leftover), false);
  });
});
