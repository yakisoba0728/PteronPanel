import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess } from '@/lib/authz/guard';
import { asIdentifier } from '@/lib/ptero/types';

export async function pluginServer(owner: ScopeUser, identifier: string) {
  const id = asIdentifier(identifier);
  await requireServerAccess(owner, id);
  return id;
}
