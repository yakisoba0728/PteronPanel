import { TtlCache } from '@/lib/cache';
import { prisma } from '@/lib/db';
import { getOwnedServers } from '@/lib/ptero/application';
import { listServers } from '@/lib/ptero/client';
import {
  asIdentifier,
  asUuid,
  type AccessibleServer,
} from '@/lib/ptero/types';

export interface ScopeUser {
  id: string;
  role: 'ADMIN' | 'USER';
  pteroUserId: number | null;
}

// Per-user accessible-server lists. Bound the cache so a long-lived process
// with many distinct users cannot grow it without limit (TTL + LRU eviction).
const cache = new TtlCache<string, AccessibleServer[]>(45_000, 5_000);

export async function resolveAccessibleServers(user: ScopeUser): Promise<AccessibleServer[]> {
  const hit = cache.get(user.id);
  if (hit) return hit;

  let servers: AccessibleServer[];
  if (user.role === 'ADMIN') {
    servers = await listServers('admin-all');
  } else if (user.pteroUserId != null) {
    const owned = await getOwnedServers(user.pteroUserId);
    const ownedIds = new Set(owned.map((server) => String(server.identifier)));
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { pteroUuid: true },
    });

    let subuser: AccessibleServer[] = [];
    if (dbUser?.pteroUuid) {
      const rows = await prisma.serverAccess.findMany({
        where: { pteroUuid: dbUser.pteroUuid },
      });
      subuser = rows
        .filter((row) => !ownedIds.has(row.serverIdentifier))
        .flatMap((row) => {
          try {
            return [
              {
                identifier: asIdentifier(row.serverIdentifier),
                uuid: asUuid(row.serverUuid),
                name: row.serverName,
              },
            ];
          } catch (error) {
            console.warn(
              `Skipping invalid ServerAccess row (identifier=${row.serverIdentifier}):`,
              error,
            );
            return [];
          }
        });
    }

    servers = [...owned, ...subuser];
  } else {
    servers = [];
  }

  cache.set(user.id, servers);
  return servers;
}

export function invalidateAccessCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
