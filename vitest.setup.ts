import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { parse } from 'dotenv';

let mswServer: Awaited<typeof import('./src/test/msw/server')>['mswServer'];

function installMemoryLocalStorage() {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear() {
      items.clear();
    },
    getItem(key) {
      return items.get(String(key)) ?? null;
    },
    key(index) {
      return Array.from(items.keys())[index] ?? null;
    },
    removeItem(key) {
      items.delete(String(key));
    },
    setItem(key, value) {
      items.set(String(key), String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
if (!localStorageDescriptor || localStorageDescriptor.get) {
  installMemoryLocalStorage();
}

function readTestDatabaseUrl() {
  try {
    return parse(readFileSync('.env.test', 'utf8')).DATABASE_URL;
  } catch {
    return undefined;
  }
}

process.env.PANEL_URL ??= 'https://panel.test';
process.env.PTERO_APP_KEY ??= 'ptla_test';
process.env.PTERO_CLIENT_KEY ??= 'ptlc_test';
process.env.DATABASE_URL ??= readTestDatabaseUrl() ?? 'postgresql://u:p@localhost:5432/db';
process.env.SESSION_SECRET ??= 'test-session-secret-value';
process.env.APP_BASE_URL ??= 'http://localhost:3000';

beforeAll(async () => {
  ({ mswServer } = await import('./src/test/msw/server'));
  mswServer.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
