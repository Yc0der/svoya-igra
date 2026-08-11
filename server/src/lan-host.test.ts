import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readLanHostConfig,
  writeLanHostAddress,
  writeLanHostHiddenInterfaces,
} from './lan-host.js';

describe('readLanHostConfig / writeLanHostAddress / writeLanHostHiddenInterfaces', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-lan-host-'));
    path = join(dir, 'lan-host.local.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty config when the file does not exist yet', async () => {
    expect(await readLanHostConfig(path)).toEqual({
      address: null,
      hiddenInterfaces: [],
    });
  });

  it('writes and reads back the same address', async () => {
    await writeLanHostAddress(path, '192.168.31.179');
    expect(await readLanHostConfig(path)).toEqual({
      address: '192.168.31.179',
      hiddenInterfaces: [],
    });
  });

  it('overwrites a previously saved address', async () => {
    await writeLanHostAddress(path, '192.168.31.179');
    await writeLanHostAddress(path, '10.0.0.5');
    expect((await readLanHostConfig(path)).address).toBe('10.0.0.5');
  });

  it('writes and reads back hidden interfaces', async () => {
    await writeLanHostHiddenInterfaces(path, ['A-Artyom-Laptop']);
    expect(await readLanHostConfig(path)).toEqual({
      address: null,
      hiddenInterfaces: ['A-Artyom-Laptop'],
    });
  });

  // Регрессия: два поля живут в одном файле, но пишутся отдельными
  // функциями (адрес — из Admin.tsx, скрытые интерфейсы — пока только
  // вручную) — одна не должна затирать то, что сохранила другая.
  it('writing the address preserves already-saved hidden interfaces, and vice versa', async () => {
    await writeLanHostHiddenInterfaces(path, ['A-Artyom-Laptop']);
    await writeLanHostAddress(path, '192.168.31.179');
    expect(await readLanHostConfig(path)).toEqual({
      address: '192.168.31.179',
      hiddenInterfaces: ['A-Artyom-Laptop'],
    });

    await writeLanHostHiddenInterfaces(path, ['A-Artyom-Laptop', 'vEthernet']);
    expect(await readLanHostConfig(path)).toEqual({
      address: '192.168.31.179',
      hiddenInterfaces: ['A-Artyom-Laptop', 'vEthernet'],
    });
  });

  it('throws on a truncated file instead of silently returning an empty config', async () => {
    await writeFile(path, '{"addr', 'utf8');
    await expect(readLanHostConfig(path)).rejects.toThrow();
  });

  it('treats a well-formed file missing both fields as an empty config, not an error', async () => {
    // Раньше отсутствие address само по себе было ошибкой — с появлением
    // hiddenInterfaces как независимого поля файл, где заполнено только
    // оно (или вообще ничего), больше не значит «повреждён».
    await writeFile(path, '{"nope": true}', 'utf8');
    expect(await readLanHostConfig(path)).toEqual({
      address: null,
      hiddenInterfaces: [],
    });
  });

  it('recovers from a corrupt existing file when writing a new value, instead of failing the write', async () => {
    await writeFile(path, '{"addr', 'utf8');
    await writeLanHostAddress(path, '192.168.31.179');
    expect(await readLanHostConfig(path)).toEqual({
      address: '192.168.31.179',
      hiddenInterfaces: [],
    });
  });
});
