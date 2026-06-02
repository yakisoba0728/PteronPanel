'use server';

import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess } from '@/lib/authz/guard';
import { getWebsocketCredentials } from '@/lib/ptero/client';
import { asIdentifier, type WebsocketCredentials } from '@/lib/ptero/types';

export async function getConsoleCredentials(
  identifier: string,
): Promise<WebsocketCredentials> {
  const user = await requireUser();
  const id = asIdentifier(identifier);

  try {
    await requireServerAccess(
      { id: user.id, role: user.role, pteroUserId: user.pteroUserId },
      id,
    );
  } catch {
    notFound();
    throw new Error('Console credentials are unavailable for this server.');
  }

  return getWebsocketCredentials(id);
}
