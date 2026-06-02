import type { User } from '@prisma/client';

export class AdminRequiredError extends Error {
  constructor() {
    super('Administrator access required.');
    this.name = 'AdminRequiredError';
  }
}

export function assertAdmin(
  user: Pick<User, 'id' | 'role' | 'pteroUserId'>,
): void {
  if (user.role !== 'ADMIN') {
    throw new AdminRequiredError();
  }
}

/** For Server Actions: returns the user or throws AdminRequiredError. */
export async function requireAdminUser(): Promise<User> {
  const { requireUser } = await import('@/lib/auth/current-user');
  const user = await requireUser();
  assertAdmin(user);
  return user;
}
