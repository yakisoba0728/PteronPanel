import { prisma } from '@/lib/db';
import { listServers, listSubusers } from '@/lib/ptero/client';

const DEFAULT_SYNC_PACE_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SyncResult {
  servers: number;
  subuserLinks: number;
}

/**
 * Rebuilds the ServerAccess subuser-link cache.
 * This is O(number of servers) on the single admin Client API key, so it is
 * deliberately sequential and lightly paced. Run it from admin-triggered or
 * scheduled jobs, not from ordinary request paths.
 */
export async function syncServerAccess(
  now: Date = new Date(),
  opts: { paceMs?: number } = {},
): Promise<SyncResult> {
  const paceMs = opts.paceMs ?? DEFAULT_SYNC_PACE_MS;
  const servers = await listServers('admin-all');
  let subuserLinks = 0;

  console.info('ServerAccess sync started', { servers: servers.length });

  for (const [index, server] of servers.entries()) {
    const subusers = await listSubusers(server.identifier);

    for (const subuser of subusers) {
      await prisma.serverAccess.upsert({
        where: {
          pteroUuid_serverIdentifier: {
            pteroUuid: subuser.uuid,
            serverIdentifier: server.identifier,
          },
        },
        update: {
          serverUuid: server.uuid,
          serverName: server.name,
          permissions: subuser.permissions,
          syncedAt: now,
        },
        create: {
          pteroUuid: subuser.uuid,
          serverIdentifier: server.identifier,
          serverUuid: server.uuid,
          serverName: server.name,
          permissions: subuser.permissions,
          syncedAt: now,
        },
      });
      subuserLinks += 1;
    }

    const current = index + 1;
    if (current === servers.length || current % 100 === 0) {
      console.info('ServerAccess sync progress', {
        current,
        total: servers.length,
        subuserLinks,
      });
    }

    if (paceMs > 0 && current < servers.length) {
      await sleep(paceMs);
    }
  }

  await prisma.serverAccess.deleteMany({ where: { syncedAt: { lt: now } } });
  console.info('ServerAccess sync finished', {
    servers: servers.length,
    subuserLinks,
  });

  return { servers: servers.length, subuserLinks };
}
