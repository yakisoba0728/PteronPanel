import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth/password';
import { findUserByEmail } from '../src/lib/ptero/application';

function req(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required seed env: ${name}`);
  return value;
}

async function upsertAdmin() {
  const email = req('SEED_ADMIN_EMAIL');
  const passwordHash = await hashPassword(req('SEED_ADMIN_PASSWORD'));
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', passwordHash, isActive: true },
    create: { email, username: req('SEED_ADMIN_USERNAME'), passwordHash, role: 'ADMIN' },
  });
  console.log(`✓ admin ready: ${admin.email}`);
}

async function upsertMappedUser() {
  const email = req('SEED_USER_EMAIL');
  const passwordHash = await hashPassword(req('SEED_USER_PASSWORD'));

  let mapping: Awaited<ReturnType<typeof findUserByEmail>> = null;
  try {
    mapping = await findUserByEmail(email);
  } catch (error) {
    console.warn(`! Failed to map ${email} via Pterodactyl; creating USER without mapping.`);
    console.warn(error);
  }

  if (!mapping) {
    console.warn(`! No Pterodactyl user found for ${email}; creating USER without mapping (will see no servers).`);
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      role: 'USER',
      passwordHash,
      isActive: true,
      pteroUserId: mapping?.id,
      pteroUuid: mapping?.uuid,
    },
    create: {
      email,
      username: req('SEED_USER_USERNAME'),
      passwordHash,
      role: 'USER',
      pteroUserId: mapping?.id,
      pteroUuid: mapping?.uuid,
    },
  });

  console.log(`✓ user ready: ${user.email} (pteroUserId=${user.pteroUserId ?? 'unmapped'})`);
}

async function main() {
  await upsertAdmin();
  await upsertMappedUser();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
