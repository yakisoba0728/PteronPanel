'use server';

import type { User } from '@prisma/client';
import { requireUser } from '@/lib/auth/current-user';
import { resolveAccessibleServers, type ScopeUser } from '@/lib/authz/access';
import type { AccessibleServer } from '@/lib/ptero/types';

function scope(user: User): ScopeUser {
  return {
    id: user.id,
    role: user.role,
    pteroUserId: user.pteroUserId,
  };
}

export async function listMyServers(): Promise<AccessibleServer[]> {
  const user = await requireUser();
  return resolveAccessibleServers(scope(user));
}
