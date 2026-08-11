import { readFile, rename, writeFile } from 'node:fs/promises';

export interface LanHostConfig {
  address: string | null;
  hiddenInterfaces: string[];
}

interface LanHostFile {
  address?: string;
  hiddenInterfaces?: string[];
}

async function readFileStrict(path: string): Promise<LanHostFile> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as LanHostFile;
}

// Только для слияния перед записью: битый/отсутствующий файл не должен
// мешать сохранить то единственное поле, которое сейчас меняется, — в
// отличие от readLanHostConfig (чтение при старте сервера), где битый файл
// обязан быть заметен вызывающему, а не тихо проглочен.
async function readFileBestEffort(path: string): Promise<LanHostFile> {
  try {
    return await readFileStrict(path);
  } catch {
    return {};
  }
}

async function writeFileAtomic(path: string, data: LanHostFile): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data), 'utf8');
  await rename(tmpPath, path);
}

export async function readLanHostConfig(path: string): Promise<LanHostConfig> {
  let raw: LanHostFile;
  try {
    raw = await readFileStrict(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { address: null, hiddenInterfaces: [] };
    }
    throw err;
  }
  return {
    address: typeof raw.address === 'string' ? raw.address : null,
    hiddenInterfaces: Array.isArray(raw.hiddenInterfaces)
      ? raw.hiddenInterfaces.filter((x): x is string => typeof x === 'string')
      : [],
  };
}

// Сохраняет выбранный адрес (Admin.tsx, admin-set-lan-address), не трогая
// уже сохранённый hiddenInterfaces — тот пишется отдельно
// (writeLanHostHiddenInterfaces), сейчас только вручную человеком, без
// своей кнопки в интерфейсе.
export async function writeLanHostAddress(
  path: string,
  address: string,
): Promise<void> {
  const existing = await readFileBestEffort(path);
  await writeFileAtomic(path, { ...existing, address });
}

export async function writeLanHostHiddenInterfaces(
  path: string,
  hiddenInterfaces: string[],
): Promise<void> {
  const existing = await readFileBestEffort(path);
  await writeFileAtomic(path, { ...existing, hiddenInterfaces });
}
