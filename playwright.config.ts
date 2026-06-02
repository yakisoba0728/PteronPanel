import { defineConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.test', override: true });

const localLibPath = '/tmp/pteron-playwright-libs/extracted/usr/lib/x86_64-linux-gnu';
process.env.LD_LIBRARY_PATH = [localLibPath, process.env.LD_LIBRARY_PATH]
  .filter(Boolean)
  .join(':');
const webServerEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => {
    return typeof entry[1] === 'string';
  }),
);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:3000',
  },
  webServer: [
    {
      command: 'node e2e/mock-panel.mjs',
      port: 9099,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/start-dev.mjs',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      env: webServerEnv,
    },
  ],
});
