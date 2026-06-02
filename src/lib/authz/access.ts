import { TtlCache } from '@/lib/cache';
import { getOwnedServers } from '@/lib/ptero/application';
import { listServers } from '@/lib/ptero/client';
import type { AccessibleServer } from '@/lib/ptero/types';

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
    servers = await getOwnedServers(user.pteroUserId);
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
