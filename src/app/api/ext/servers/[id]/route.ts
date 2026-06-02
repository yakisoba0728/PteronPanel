import { NextResponse } from 'next/server';
import { requireServerPermission } from '@/lib/authz/guard';
import { getServer } from '@/lib/ptero/client';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { extError, extRateLimit } from '@/lib/plugins/respond';
import { pluginServer } from '@/lib/plugins/scope';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = extRateLimit(ctx);
  if (limited) return limited;

  try {
    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    await requireServerPermission(ctx.owner, sid, 'control.console');
    const details = await getServer(sid);
    return NextResponse.json({
      server: {
        identifier: details.attributes.identifier,
        uuid: details.attributes.uuid,
        name: details.attributes.name,
        node: details.attributes.node ?? null,
      },
    });
  } catch (err) {
    return extError(err);
  }
}
