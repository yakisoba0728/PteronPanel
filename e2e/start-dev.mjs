import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parse } from 'dotenv';

const repoEnv = '.env';
const backupEnv = '.env.playwright-backup';
const testEnv = '.env.test';

if (existsSync(backupEnv)) {
  unlinkSync(backupEnv);
}

if (existsSync(repoEnv)) {
  copyFileSync(repoEnv, backupEnv);
}

copyFileSync(testEnv, repoEnv);

const testEnvVars = parse(readFileSync(testEnv, 'utf8'));

const child = spawn('pnpm', ['dev'], {
  stdio: 'inherit',
  env: { ...process.env, ...testEnvVars },
  shell: false,
});

const restore = () => {
  try {
    if (existsSync(backupEnv)) {
      copyFileSync(backupEnv, repoEnv);
      unlinkSync(backupEnv);
    }
  } catch {
    // best effort restore for local e2e runs
  }
};

process.on('SIGINT', () => {
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});

child.on('exit', (code, signal) => {
  restore();
  process.exit(code ?? (signal ? 1 : 0));
});
