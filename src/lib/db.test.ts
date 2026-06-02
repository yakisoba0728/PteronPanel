import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from './db';

describe('prisma client (integration)', () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'dbtest@example.com' } });
    await prisma.$disconnect();
  });

  it('creates and reads a user', async () => {
    const created = await prisma.user.create({
      data: {
        email: 'dbtest@example.com',
        username: 'dbtest',
        passwordHash: 'x',
        role: 'USER',
      },
    });

    const found = await prisma.user.findUnique({ where: { id: created.id } });

    expect(found?.email).toBe('dbtest@example.com');
    expect(found?.role).toBe('USER');
  });
});
