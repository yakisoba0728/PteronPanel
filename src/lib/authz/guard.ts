import type { AccessibleServer } from '@/lib/ptero/types';
import { resolveAccessibleServers, type ScopeUser } from './access';

/** Thrown when a user requests a server outside their scope. Map to HTTP 404 (existence hiding). */
export class ServerAccessDeniedError extends Error {
  constructor(readonly identifier: string) {
    super('The requested server could not be found.');
    this.name = 'ServerAccessDeniedError';
  }
}

export class ServerPermissionDeniedError extends ServerAccessDeniedError {
  constructor(identifier: string, readonly permissions: string[]) {
    super(identifier);
    this.name = 'ServerPermissionDeniedError';
  }
}

export async function requireServerAccess(
  user: ScopeUser,
  identifier: string,
): Promise<AccessibleServer> {
  const servers = await resolveAccessibleServers(user);
  const match = servers.find((server) => server.identifier === identifier);
  if (!match) throw new ServerAccessDeniedError(identifier);
  return match;
}

export async function requireServerPermission(
  user: ScopeUser,
  identifier: string,
  permissions: string | string[],
): Promise<AccessibleServer> {
  const server = await requireServerAccess(user, identifier);
  if (server.accessKind !== 'subuser') return server;

  const required = Array.isArray(permissions) ? permissions : [permissions];
  const granted = new Set(server.permissions ?? []);
  if (required.every((permission) => granted.has(permission))) {
    return server;
  }

  throw new ServerPermissionDeniedError(identifier, required);
}
