import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import { asIdentifier } from '@/lib/ptero/types';

export async function pluginServer(owner: ScopeUser, identifier: string) {
  // A malformed identifier must look like "not found" (existence hiding),
  // matching the action layer — never a 500. asIdentifier throws a plain Error
  // on a bad-length id, which extError would otherwise map to 500.
  let id;
  try {
    id = asIdentifier(identifier);
  } catch {
    throw new ServerAccessDeniedError(identifier);
  }
  await requireServerAccess(owner, id);
  return id;
}
