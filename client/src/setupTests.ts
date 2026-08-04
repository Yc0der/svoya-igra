import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest's `globals` option is left off (tests import describe/it/expect
// explicitly), so @testing-library/react's automatic afterEach(cleanup)
// detection never finds a global `afterEach` to hook into. Register it
// manually so the DOM is unmounted between tests in the same file.
afterEach(() => {
  cleanup();
});

// Node's built-in Web Storage API (stable since Node 22, active by default in
// this environment's Node runtime) registers a global `localStorage` getter
// before jsdom starts up. Because vitest's jsdom environment shares its
// `window` object with `globalThis`, jsdom sees `localStorage` already
// defined and skips installing its own working implementation, leaving the
// non-functional Node one (it requires a `--localstorage-file` path) in
// place. Replace it with a minimal in-memory Storage implementation so
// tests get a working localStorage/sessionStorage.
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

if (typeof window !== 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}
