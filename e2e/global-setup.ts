import { execSync } from 'node:child_process';

export default function globalSetup() {
  const env = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' };

  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env });
  execSync('pnpm db:seed', { stdio: 'inherit', env });
}
