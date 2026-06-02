import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const testEnv = parse(readFileSync('.env.test', 'utf8'));

const child = spawn('pnpm', ['dev'], {
  stdio: 'inherit',
  env: { ...process.env, ...testEnv },
  shell: false,
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
