import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { requireServerPermission } from '@/lib/authz/guard';
import { sendCommand } from '@/lib/ptero/client';
import { emitEvent } from '@/lib/plugins/events';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { extError, extRateLimit } from '@/lib/plugins/respond';
import { pluginServer } from '@/lib/plugins/scope';

export async function POST(
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
    const body = await req.json().catch(() => ({}));
    const command = typeof body.command === 'string' ? body.command : '';
    if (!command.trim()) {
      return NextResponse.json({ error: 'invalid_command' }, { status: 400 });
    }

    await requireServerPermission(ctx.owner, sid, 'control.console');
    await sendCommand(sid, command);
    await audit('ext.command', {
      userId: ctx.owner.id,
      target: sid,
      metadata: { pluginId: ctx.pluginId },
    });
    void emitEvent('server.command', {
      serverIdentifier: sid,
      actorUserId: ctx.owner.id,
      data: { pluginId: ctx.pluginId },
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return extError(err);
  }
}
