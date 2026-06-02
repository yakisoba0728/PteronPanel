import { execSync } from 'node:child_process';
import { prisma } from '../src/lib/db';

export default async function globalSetup() {
  const env = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' };

  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env });
  execSync('pnpm db:seed', { stdio: 'inherit', env });
  await prisma.serverAccess.deleteMany();
  await prisma.$disconnect();
}
