import { NextResponse } from 'next/server';
import { resolveAccessibleServers } from '@/lib/authz/access';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { extError, extRateLimit } from '@/lib/plugins/respond';

export async function GET(req: Request) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = extRateLimit(ctx);
  if (limited) return limited;

  try {
    const servers = await resolveAccessibleServers(ctx.owner);
    return NextResponse.json({
      servers: servers.map((server) => ({
        identifier: server.identifier,
        uuid: server.uuid,
        name: server.name,
        node: server.node ?? null,
      })),
    });
  } catch (err) {
    return extError(err);
  }
}
