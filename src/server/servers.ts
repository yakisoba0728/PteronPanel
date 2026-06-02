'use server';

import type { User } from '@prisma/client';
import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import { resolveAccessibleServers, type ScopeUser } from '@/lib/authz/access';
import { getServer, powerServer } from '@/lib/ptero/client';
import type { AccessibleServer } from '@/lib/ptero/types';
import { asIdentifier, type PowerSignal } from '@/lib/ptero/types';

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

export async function getServerOverview(identifier: string): Promise<{
  server: AccessibleServer;
  attributes: Record<string, unknown>;
}> {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  const server = await requireServerAccess(scope(user), id);
  const details = await getServer(id);

  return {
    server,
    attributes: details.attributes,
  };
}

export type PowerResult = { ok: true } | { ok: false; error: 'not_found' | 'failed' };

export async function powerServerAction(
  identifier: string,
  signal: PowerSignal,
): Promise<PowerResult> {
  const user = await requireUser();

  try {
    const id = asIdentifier(identifier);
    await requireServerAccess(scope(user), id);
    await powerServer(id, signal);
    await audit('server.power', {
      userId: user.id,
      target: id,
      metadata: { signal },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ServerAccessDeniedError) {
      return { ok: false, error: 'not_found' };
    }

    console.error('powerServerAction failed', error);
    return { ok: false, error: 'failed' };
  }
}
