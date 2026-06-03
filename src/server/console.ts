'use server';

import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { AccessKind } from '@/lib/authz/visible-tabs';
import { asIdentifier } from '@/lib/ptero/types';

/**
 * Resolve the viewer's access kind and permissions for a server, used to gate
 * the console power/command controls in the UI. Hides the server (404) if the
 * viewer has no access at all.
 */
export async function getConsoleAccess(
  identifier: string,
): Promise<{ accessKind: AccessKind; permissions: string[] }> {
  const user = await requireUser();
  const id = asIdentifier(identifier);

  try {
    const server = await requireServerAccess(
      { id: user.id, role: user.role, pteroUserId: user.pteroUserId },
      id,
    );
    return {
      accessKind: server.accessKind ?? 'subuser',
      permissions: server.permissions ?? [],
    };
  } catch (error) {
    if (error instanceof ServerAccessDeniedError) notFound();
    throw error;
  }
}
