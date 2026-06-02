import { execSync } from 'node:child_process';

export default function globalSetup() {
  const env = { ...process.env };

  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env });
  execSync('pnpm db:seed', { stdio: 'inherit', env });
}
