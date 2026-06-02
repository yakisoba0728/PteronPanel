'use server';

import type { User } from '@prisma/client';
import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import { resolveAccessibleServers, type ScopeUser } from '@/lib/authz/access';
import { getServer, powerServer } from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
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

export type PowerResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'failed' }
  | { ok: false; error: 'conflict'; detail?: string };

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
  } catch (err) {
    if (err instanceof ServerAccessDeniedError) {
      return { ok: false, error: 'not_found' };
    }

    // Wings returns 409 when the server is in a state that cannot accept the
    // requested power action (e.g. starting an already-running server). Surface
    // it as a distinct, non-error outcome instead of a generic failure.
    if (err instanceof PteroApiError && err.httpStatus === 409) {
      return { ok: false, error: 'conflict', detail: err.primary?.detail };
    }

    console.error('powerServerAction failed', err);
    return { ok: false, error: 'failed' };
  }
}
