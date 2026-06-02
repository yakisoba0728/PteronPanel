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

export type DashboardResult =
  | {
      ok: true;
      totalServers: number;
      servers: AccessibleServer[];
      isAdmin: boolean;
      username: string;
    }
  | { ok: false; error: 'failed' };

export async function getDashboardAction(): Promise<DashboardResult> {
  // Resolve the user outside the try so an unauthenticated redirect('/login')
  // (NEXT_REDIRECT) propagates instead of being swallowed by the catch.
  const user = await requireUser();

  try {
    const servers = await resolveAccessibleServers(scope(user));

    return {
      ok: true,
      totalServers: servers.length,
      servers: servers.slice(0, 8),
      isAdmin: user.role === 'ADMIN',
      username: user.username,
    };
  } catch (err) {
    console.error('getDashboardAction failed', err);
    return { ok: false, error: 'failed' };
  }
}
